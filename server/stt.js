// Optional server-side transcription through an OpenAI-compatible /audio/transcriptions endpoint
// (OpenAI whisper-1 / gpt-4o-transcribe, Groq whisper-large-v3, a local faster-whisper server...).
// Unlike the browser's speech recognition it keeps hesitations ("ehm") when prompted to, which makes the
// filler count more faithful.
'use strict';
const config = require('./config');
const { HttpError } = require('./http');

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };

// A short prompt in the same style nudges Whisper-like models to write fillers instead of cleaning them up.
const HINT = {
  it: 'Ehm, allora... cioè, praticamente, eh, diciamo che il progetto, tipo, è andato bene.',
  en: 'Um, so... uh, I mean, basically, the project, you know, went well.',
};

async function transcribe(audio, mime, lang) {
  const S = config.stt;
  if (!S.enabled) throw new HttpError(404, 'Trascrizione sul server non configurata.');
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([audio], { type: base || 'audio/webm' }), `registrazione.${EXT[base] || 'webm'}`);
  form.append('model', S.model);
  form.append('language', lang === 'en' ? 'en' : 'it');
  form.append('prompt', HINT[lang] || HINT.it);
  form.append('response_format', 'json');
  let r;
  try {
    r = await fetch(S.baseUrl + '/audio/transcriptions', {
      method: 'POST',
      headers: S.apiKey ? { authorization: 'Bearer ' + S.apiKey } : {},
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    console.error('[stt] rete:', e.message);
    throw new HttpError(502, 'Impossibile contattare il servizio di trascrizione.');
  }
  const text = await r.text();
  if (!r.ok) {
    console.error(`[stt] HTTP ${r.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new HttpError(502, 'Il servizio di trascrizione ha risposto con un errore.');
  }
  let json; try { json = JSON.parse(text); } catch (e) { json = { text }; }
  return String(json.text || '').trim().slice(0, 20000);
}

module.exports = { transcribe, enabled: () => config.stt.enabled };
