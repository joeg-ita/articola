// Model access: one function, generate(), that returns a validated object whatever the provider.
//
//  LLM_PROVIDER=anthropic (default): official Anthropic SDK, structured outputs (output_config.format built from the
//                                    Zod schema), explicit effort and the server-side refusal fallback.
//  LLM_PROVIDER=openai:              any OpenAI-compatible chat-completions API via OPENAI_BASE_URL (OpenAI, OpenRouter,
//                                    DeepSeek, Groq, Ollama, LM Studio, vLLM...), JSON mode + the same schema, validated
//                                    with Zod and retried once with the validation errors.
//
// What a provider says on failure (billing, keys, quotas) goes to the server log; the browser only gets a status.
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const config = require('./config');
const { HttpError } = require('./http');

const C = config.llm;
const MODEL = C.provider === 'openai' ? C.openaiModel : C.anthropicModel;

let anthropicClient = null;
function anthropic() {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw unavailable('ANTHROPIC_API_KEY non configurata (vedi .env.example)');
    anthropicClient = new Anthropic({ timeout: C.timeoutMs, maxRetries: 2 });
  }
  return anthropicClient;
}

function unavailable(logMsg) {
  console.error(`[llm] ${logMsg}`);
  return new HttpError(503, 'Il servizio AI non è disponibile al momento.');
}

async function viaAnthropic({ system, user, schema, maxTokens }) {
  const format = zodOutputFormat(schema);
  const params = {
    model: C.anthropicModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: C.anthropicEffort, format: { type: format.type, schema: format.schema } },
  };
  if (C.anthropicFallbacks) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  let msg;
  try {
    msg = await anthropic().beta.messages.create(params);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw unavailable(`Anthropic: credenziali rifiutate (${e.status})`);
    if (e instanceof Anthropic.RateLimitError) { console.error('[llm] Anthropic 429:', e.message); throw new HttpError(503, 'Il servizio AI è sovraccarico: riprova tra poco.'); }
    if (e instanceof Anthropic.BadRequestError) { console.error('[llm] Anthropic 400:', e.message); throw new HttpError(502, 'Richiesta al servizio AI non valida.'); }
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'Il modello non ha risposto in tempo.');
    if (e instanceof Anthropic.APIError) { console.error(`[llm] Anthropic ${e.status}:`, e.message); throw new HttpError(502, 'Il servizio AI ha risposto con un errore.'); }
    throw e;
  }
  if (msg.stop_reason === 'refusal') {
    console.error('[llm] richiesta rifiutata:', msg.stop_details && msg.stop_details.category);
    throw new HttpError(422, 'Il modello non ha potuto generare questo contenuto. Prova a riformulare le preferenze.');
  }
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'La risposta del modello è stata troncata.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return format.parse(text); }
  catch (e) { console.error('[llm] output non valido:', e.message.slice(0, 300)); throw new HttpError(502, 'Il modello ha restituito dati non validi.'); }
}

async function openaiChat(messages, schema, maxTokens) {
  const key = process.env.OPENAI_API_KEY;
  if (!key && !/localhost|127\.0\.0\.1|host\.docker\.internal/.test(C.openaiBaseUrl)) throw unavailable('OPENAI_API_KEY non configurata (vedi .env.example)');
  const body = { model: C.openaiModel, max_tokens: maxTokens, messages };
  body.response_format = C.openaiJsonMode === 'json_schema'
    ? { type: 'json_schema', json_schema: { name: 'output', schema: z.toJSONSchema(schema), strict: false } }
    : { type: 'json_object' };
  let r;
  try {
    r = await fetch(C.openaiBaseUrl + '/chat/completions', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, key ? { authorization: 'Bearer ' + key } : {}),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(C.timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new HttpError(504, 'Il modello non ha risposto in tempo.');
    console.error('[llm] rete:', e.message);
    throw new HttpError(502, 'Impossibile contattare il servizio AI.');
  }
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!r.ok) {
    const m = json && json.error && (json.error.message || json.error);
    console.error(`[llm] ${new URL(C.openaiBaseUrl).hostname} HTTP ${r.status}: ${String(typeof m === 'string' ? m : text).replace(/\s+/g, ' ').slice(0, 300)}`);
    if (r.status === 401 || r.status === 403) throw unavailable('credenziali rifiutate dal provider OpenAI-compatibile');
    throw new HttpError(r.status === 429 ? 503 : 502, r.status === 429 ? 'Il servizio AI è sovraccarico: riprova tra poco.' : 'Il servizio AI ha risposto con un errore.');
  }
  const choice = json && json.choices && json.choices[0];
  if (!choice) throw new HttpError(502, 'Risposta non valida dal servizio AI.');
  if (choice.finish_reason === 'length') throw new HttpError(502, 'La risposta del modello è stata troncata.');
  return String((choice.message && choice.message.content) || '');
}

function extractJson(text) {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (err) { return null; }
}

async function viaOpenAI({ system, user, schema, maxTokens }) {
  const schemaText = JSON.stringify(z.toJSONSchema(schema));
  const messages = [
    { role: 'system', content: `${system}\n\nRispondi SOLO con un oggetto JSON valido conforme a questo JSON Schema:\n${schemaText}` },
    { role: 'user', content: user },
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await openaiChat(messages, schema, maxTokens);
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return parsed.data;
    if (attempt === 2) { console.error('[llm] output non valido:', parsed.error.message.slice(0, 300)); break; }
    const issues = parsed.error.issues.slice(0, 8).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Il JSON non rispetta lo schema:\n${issues}\nRestituisci di nuovo l'oggetto completo e corretto, solo JSON.` });
  }
  throw new HttpError(502, 'Il modello ha restituito dati non validi.');
}

function generate(opts) {
  return C.provider === 'openai' ? viaOpenAI(opts) : viaAnthropic(opts);
}

module.exports = { generate, PROVIDER: C.provider, MODEL };
