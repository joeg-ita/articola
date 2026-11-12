# Articola

Multi-user web app (desktop and mobile, installable as a PWA) for training **clear voice, structured thinking and presence**, based on the method of the *Articulation Skills Program*.

- **Onboarding**: goals, context (role, situations where you speak), baseline self-assessment, available time, style, topics of interest and feedback tone.
- **AI-generated path**: based on your answers, the model writes a 4-12 week plan. Each week has a focus, an extra exercise, a real-world challenge in your own situations, a recording prompt and a single correction to concentrate on. There is also a daily routine of the length you choose.
- **Daily exercises, written for you**: tongue twisters, a passage to read aloud with marked pauses (on your topics), words for improvisation and a question to answer using BLUF, PREP or SCQA. There are also timers and a 4-2-6 breathing guide.
- **Voice recording**: baseline (three clips), weekly recording, free practice and final comparison. Each recording measures speaking rate (words/min), filler words ("eh", "cioè", "praticamente"…), pauses and pitch variation. The AI coach rates clarity, structure and closing and gives you **one** correction. You rate tone and diction yourself by listening back, using the 1-5 rubric.
- **Progress over time**: charts with the target band, a week-by-week table (like the program's tracking sheet), baseline vs. final comparison with audio, and an AI reading of your progress.
- **Login** with Google and Facebook (OAuth 2.0), data in PostgreSQL, light/dark theme.

## Running with Docker

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, BASE_URL, OAuth and AI key
docker compose up -d --build
```

Open <http://localhost:3000>. Using the microphone from other devices requires HTTPS: `docker compose --profile https up -d --build` with `DOMAIN`, `BASE_URL=https://…` and `APP_BIND=127.0.0.1` in `.env` (Caddy obtains certificates automatically).

### Login

The redirect URIs to register with the providers are `BASE_URL` + `/auth/google/callback` and `/auth/facebook/callback`, character for character. Only buttons for configured providers are shown. A second provider can be linked from Settings: accounts are never merged by email.

### AI models

| `LLM_PROVIDER` | How |
|---|---|
| `anthropic` (default) | Official `@anthropic-ai/sdk`, model `claude-opus-5-5` (`ANTHROPIC_MODEL`), *structured outputs* from the Zod schemas, explicit `effort` (`ANTHROPIC_EFFORT`, default `medium`) and server-side *fallback* on refusal (`ANTHROPIC_FALLBACKS`). |
| `openai` | Any OpenAI chat-completions compatible API (`OPENAI_BASE_URL`): OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio, vLLM… JSON mode with the same schema, validated with Zod and retried once if it doesn't conform. |

Schemas for everything the model writes are in [server/schemas.js](server/schemas.js), prompts in [server/coach.js](server/coach.js), the reference method in [server/program.js](server/program.js).

**Transcription**: by default it's done by the browser (Web Speech API in Chrome, Edge and Safari) and the user can correct it. With `STT_BASE_URL`/`STT_API_KEY`, recordings are transcribed on the server by an OpenAI-compatible `/audio/transcriptions` endpoint (Whisper, gpt-4o-transcribe, Groq…). This also keeps the "ehm"s, so the filler-word count is more accurate.

**What the AI receives**: text only, i.e. preferences, transcript and measured numbers. Audio stays in the app's database and is never sent to the model (nor to the transcription service, unless one is configured).

## How recordings are measured

- **Rate and filler words**: from the transcript, on the server ([server/metrics.js](server/metrics.js)), with a separate list for Italian ("eh", "cioè", "praticamente"…) and English ("um", "like", "you know", "basically"…) depending on the language the user practises in. Context rules skip words used with their real meaning: "che tipo di", "I like", "what kind of", "do you know" are not counted. Only the occurrences actually counted are highlighted in the transcript.
- **Pauses, speaking time, pitch**: in the browser, on the recorded audio ([public/audio.js](public/audio.js)). Energy per 20 ms frame; pauses of 350 ms or more between the first and last word (long ones from 2 s); pitch variation as the standard deviation in semitones of voice pitch (autocorrelation at 8 kHz).

These are estimates meant to show **change over time**, not lab measurements. Rate, fillers and pauses get a 1-5 score computed from the numbers; clarity, structure and closing from the coach; tone and diction from the user.

## Development without Docker

Requires Node ≥ 20 and a reachable PostgreSQL.

```bash
npm ci
# .env: DATABASE_URL=postgres://…  ENABLE_DEV_LOGIN=true  NODE_ENV=development
npm start
```

`ENABLE_DEV_LOGIN` (sign in with any name) only works with `NODE_ENV=development`.

### End-to-end tests

[test/e2e.js](test/e2e.js) exercises the whole API: onboarding, path, exercises, recording, audio with Range requests, evaluation, progress, isolation between users and account deletion. It runs against a server with dev login and a fake OpenAI-compatible LLM ([test/mock-llm.js](test/mock-llm.js)), so no key is needed:

```bash
node test/mock-llm.js 4011 &
LLM_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:4011/v1 OPENAI_MODEL=mock \
  ENABLE_DEV_LOGIN=true NODE_ENV=development PORT=3100 BASE_URL=http://127.0.0.1:3100 DATABASE_URL=postgres://… npm start &
BASE=http://127.0.0.1:3100 node test/e2e.js
```

## Architecture

Framework-free Node (dependencies: `pg`, `@anthropic-ai/sdk`, `zod`) and a build-free vanilla JS frontend.

| File | Role |
|---|---|
| [server.js](server.js) | HTTP, static files, health check, security headers |
| [server/auth.js](server/auth.js) | OAuth 2.0 (Google with PKCE, Facebook with `appsecret_proof`) and cookie sessions |
| [server/api.js](server/api.js) | REST API: preferences, path, today, recordings, progress |
| [server/coach.js](server/coach.js) · [server/llm.js](server/llm.js) | Prompts and AI providers |
| [server/metrics.js](server/metrics.js) · [server/stt.js](server/stt.js) | Speech metrics and optional transcription |
| [migrations/](migrations) | PostgreSQL schema: `users`, `identities`, `auth_sessions`, `paths`, `daily_content`, `day_progress`, `recordings`, `insights` |
| [public/](public) | SPA: `app.js` (views), `audio.js` (audio analysis), `charts.js` (SVG charts) |

The path and daily exercises are generated in the background while the page refreshes itself. Exercises are generated once per day and stored, so they stay the same across all devices.

## Security and data

- Opaque session cookie, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. The database only stores the SHA-256 hash of the token.
- OAuth with `state`; the `redirect_uri` is built from `BASE_URL`, never from the `Host` header.
- CSRF: every write requires the `X-Articola` header.
- Every query is filtered by `user_id`, and ids are validated UUIDs.
- Per-user limits: AI calls per hour, path regenerations per day, number of recordings and audio storage.
- Preferences, which end up in prompts, are validated against allowlists and sanitized.
- Deleting the account cascades to paths, recordings, audio and progress.
