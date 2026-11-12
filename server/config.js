// Central configuration, read once from the environment (and a local .env for convenience).
'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader for local runs. In Docker, variables come from compose instead and
// real environment variables always win over the file.
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env file */ }

const env = process.env;
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

const port = int(env.PORT, 3000);
// The public URL users reach the app on. OAuth redirect URIs are built from this — never
// from the request's Host header, which a client can forge.
const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const isProd = env.NODE_ENV === 'production';

function oauthProvider(id, name, defaults, idVar, secretVar) {
  const clientId = env[idVar] || '';
  const clientSecret = env[secretVar] || '';
  const up = id.toUpperCase();
  return {
    id, name, clientId, clientSecret,
    enabled: !!(clientId && clientSecret),
    // Endpoints can be overridden (e.g. to point at a mock identity provider in tests).
    authUrl: env[`${up}_AUTH_URL`] || defaults.authUrl,
    tokenUrl: env[`${up}_TOKEN_URL`] || defaults.tokenUrl,
    userinfoUrl: env[`${up}_USERINFO_URL`] || defaults.userinfoUrl,
    scope: defaults.scope,
    pkce: defaults.pkce,
  };
}

const fbVersion = env.FACEBOOK_API_VERSION || 'v23.0';
const llmProvider = (env.LLM_PROVIDER || 'anthropic').toLowerCase() === 'openai' ? 'openai' : 'anthropic';

module.exports = {
  port, baseUrl, isProd,
  secureCookies: baseUrl.startsWith('https://'),
  databaseUrl: env.DATABASE_URL || '', // empty -> pg falls back to the standard PG* variables
  // Dev login skips real OAuth. It is refused outright in production, whatever the flag says.
  devLoginRequested: env.ENABLE_DEV_LOGIN === 'true',
  devLogin: env.ENABLE_DEV_LOGIN === 'true' && !isProd,
  sessionDays: int(env.SESSION_DAYS, 30),

  // --- AI models ---
  // anthropic: official SDK. openai: any OpenAI-compatible chat-completions API (OpenAI, Azure-compatible
  // gateways, OpenRouter, DeepSeek, Groq, Ollama, LM Studio, vLLM...) through OPENAI_BASE_URL.
  llm: {
    provider: llmProvider,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    // Opus 5.5 defaults to "medium": set explicitly so behaviour does not change with the model default.
    anthropicEffort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.ANTHROPIC_EFFORT) ? env.ANTHROPIC_EFFORT : 'medium',
    // Server-side refusal fallback (routes a declined request to another model inside the same call).
    anthropicFallbacks: env.ANTHROPIC_FALLBACKS !== 'false',
    openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    openaiModel: env.OPENAI_MODEL || 'gpt-4o',
    // Some OpenAI-compatible servers support strict json_schema outputs, others only json_object.
    openaiJsonMode: env.OPENAI_JSON_MODE === 'json_schema' ? 'json_schema' : 'json_object',
    timeoutMs: Math.max(20000, int(env.LLM_TIMEOUT_MS, 180000)),
  },
  // --- Speech-to-text on the server (optional) ---
  // When set, recordings are transcribed by an OpenAI-compatible /audio/transcriptions endpoint
  // (OpenAI Whisper / gpt-4o-transcribe, Groq, a local faster-whisper server...). Otherwise the browser's
  // speech recognition provides the transcript and the user can correct it.
  stt: {
    enabled: !!(env.STT_BASE_URL || env.STT_API_KEY),
    baseUrl: (env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: env.STT_API_KEY || '',
    model: env.STT_MODEL || 'whisper-1',
  },

  llmRatePerHour: int(env.LLM_RATE_PER_HOUR, 40),
  // Per-user ceilings, so one account cannot run up bills or fill the database.
  userMaxRecordings: Math.max(20, int(env.USER_MAX_RECORDINGS, 1000)),
  userMaxAudioMb: Math.max(10, int(env.USER_MAX_AUDIO_MB, 400)),
  pathRegenPerDay: Math.max(1, int(env.PATH_REGEN_PER_DAY, 5)),

  oauth: {
    google: oauthProvider('google', 'Google', {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile', pkce: true,
    }, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    facebook: oauthProvider('facebook', 'Facebook', {
      authUrl: `https://www.facebook.com/${fbVersion}/dialog/oauth`,
      tokenUrl: `https://graph.facebook.com/${fbVersion}/oauth/access_token`,
      userinfoUrl: `https://graph.facebook.com/${fbVersion}/me?fields=id,name,email,picture.type(large)`,
      scope: 'email,public_profile', pkce: false,
    }, 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'),
  },
};
