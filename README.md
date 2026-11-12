# Articola

Web app multi-utente (desktop e mobile, installabile come PWA) per allenare **voce chiara, pensiero strutturato e presenza** con il metodo del *Programma di Articulation Skills*.

- **Onboarding**: obiettivi, contesto (ruolo, situazioni in cui parli), autovalutazione di partenza, tempo disponibile, stile, temi di interesse e tono del feedback.
- **Percorso generato dall'AI**: in base alle risposte il modello scrive un piano di 4-12 settimane. Ogni settimana ha un focus, un esercizio aggiuntivo, una sfida reale nelle tue situazioni, una traccia di registrazione e una sola correzione su cui concentrarti. C'è anche una routine quotidiana della durata scelta.
- **Esercizi del giorno, scritti per te**: scioglilingua, un brano da leggere con le pause segnate (sui tuoi temi), parole per l'improvvisazione e una domanda da impostare con BLUF, PREP o SCQA. Ci sono anche timer e una guida al respiro 4-2-6.
- **Registrazione della voce**: punto zero (tre clip), registrazione settimanale, pratica libera e confronto finale. Ogni registrazione misura velocità (parole/min), intercalari ("eh", "cioè", "praticamente"…), pause e variazione dell'intonazione. Il coach AI valuta chiarezza, struttura e chiusura e ti dà **una** correzione. Tono e dizione li valuti tu riascoltandoti, con la griglia 1-5.
- **Progressi nel tempo**: grafici con la fascia obiettivo, tabella settimana per settimana (come la scheda di tracciamento del programma), punto zero e fine a confronto con gli audio, e una lettura AI dei progressi.
- **Login** con Google e Facebook (OAuth 2.0), dati su PostgreSQL, tema chiaro/scuro.

## Avvio con Docker

```bash
cp .env.example .env          # imposta POSTGRES_PASSWORD, BASE_URL, OAuth e chiave AI
docker compose up -d --build
```

Apri <http://localhost:3000>. Per usare il microfono da altri dispositivi serve HTTPS: `docker compose --profile https up -d --build` con `DOMAIN`, `BASE_URL=https://…` e `APP_BIND=127.0.0.1` nel `.env` (Caddy ottiene i certificati da solo).

### Login

Gli URI di reindirizzamento da registrare presso i provider sono `BASE_URL` + `/auth/google/callback` e `/auth/facebook/callback`, carattere per carattere. Compare solo il pulsante dei provider configurati. Un secondo provider si collega da Impostazioni: gli account non vengono mai fusi per email.

### Modelli AI

| `LLM_PROVIDER` | Come |
|---|---|
| `anthropic` (default) | SDK ufficiale `@anthropic-ai/sdk`, modello `claude-opus-5-5` (`ANTHROPIC_MODEL`), *structured outputs* dagli schemi Zod, `effort` esplicito (`ANTHROPIC_EFFORT`, default `medium`) e il *fallback* lato server in caso di rifiuto (`ANTHROPIC_FALLBACKS`). |
| `openai` | Qualunque API compatibile con OpenAI chat-completions (`OPENAI_BASE_URL`): OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio, vLLM… JSON mode con lo stesso schema, validato con Zod e corretto con un secondo tentativo se non è conforme. |

Gli schemi di tutto ciò che il modello scrive sono in [server/schemas.js](server/schemas.js), i prompt in [server/coach.js](server/coach.js), il metodo di riferimento in [server/program.js](server/program.js).

**Trascrizione**: di default la fa il browser (Web Speech API in Chrome, Edge e Safari) e l'utente può correggerla. Con `STT_BASE_URL`/`STT_API_KEY` le registrazioni vengono trascritte sul server da un endpoint `/audio/transcriptions` compatibile OpenAI (Whisper, gpt-4o-transcribe, Groq…). Così vengono conservati anche gli "ehm" e il conteggio degli intercalari è più fedele.

**Cosa riceve l'AI**: solo testo, cioè preferenze, trascrizione e numeri misurati. L'audio resta nel database dell'app e non viene mai inviato al modello (né al servizio di trascrizione, se non è configurato).

## Come vengono misurate le registrazioni

- **Velocità e intercalari**: dalla trascrizione, sul server ([server/metrics.js](server/metrics.js)). "Tipo di…" non conta come intercalare.
- **Pause, parlato effettivo, intonazione**: nel browser, sull'audio registrato ([public/audio.js](public/audio.js)). Energia per frame da 20 ms; pause da 350 ms in su tra la prima e l'ultima parola (lunghe da 2 s); intonazione come deviazione standard in semitoni dell'altezza della voce (autocorrelazione a 8 kHz).

Sono stime pensate per vedere **il cambiamento nel tempo**, non misure di laboratorio. Velocità, intercalari e pause ricevono un voto 1-5 calcolato dai numeri; chiarezza, struttura e chiusura dal coach; tono e dizione dall'utente.

## Sviluppo senza Docker

Servono Node ≥ 20 e un PostgreSQL raggiungibile.

```bash
npm ci
# .env: DATABASE_URL=postgres://…  ENABLE_DEV_LOGIN=true  NODE_ENV=development
npm start
```

`ENABLE_DEV_LOGIN` (accesso con un nome qualsiasi) funziona solo con `NODE_ENV=development`.

### Test end-to-end

[test/e2e.js](test/e2e.js) percorre tutta l'API: onboarding, percorso, esercizi, registrazione, audio con richieste Range, valutazione, progressi, isolamento tra utenti ed eliminazione dell'account. Lo fa contro un server con dev login e un finto LLM compatibile OpenAI ([test/mock-llm.js](test/mock-llm.js)), quindi non serve nessuna chiave:

```bash
node test/mock-llm.js 4011 &
LLM_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:4011/v1 OPENAI_MODEL=mock \
  ENABLE_DEV_LOGIN=true NODE_ENV=development PORT=3100 BASE_URL=http://127.0.0.1:3100 DATABASE_URL=postgres://… npm start &
BASE=http://127.0.0.1:3100 node test/e2e.js
```

## Architettura

Stessa impostazione di [langStar](https://github.com/joeg-ita/langstar): Node senza framework (dipendenze: `pg`, `@anthropic-ai/sdk`, `zod`) e frontend vanilla JS senza build.

| File | Ruolo |
|---|---|
| [server.js](server.js) | HTTP, file statici, health check, intestazioni di sicurezza |
| [server/auth.js](server/auth.js) | OAuth 2.0 (Google con PKCE, Facebook con `appsecret_proof`) e sessioni via cookie |
| [server/api.js](server/api.js) | API REST: preferenze, percorso, oggi, registrazioni, progressi |
| [server/coach.js](server/coach.js) · [server/llm.js](server/llm.js) | Prompt e provider AI |
| [server/metrics.js](server/metrics.js) · [server/stt.js](server/stt.js) | Metriche del parlato e trascrizione opzionale |
| [migrations/](migrations) | Schema PostgreSQL: `users`, `identities`, `auth_sessions`, `paths`, `daily_content`, `day_progress`, `recordings`, `insights` |
| [public/](public) | SPA: `app.js` (viste), `audio.js` (analisi audio), `charts.js` (grafici SVG) |

Il percorso e gli esercizi del giorno vengono generati in background, mentre la pagina aggiorna da sola. Gli esercizi sono generati una volta per giorno e salvati, così restano uguali su tutti i dispositivi.

## Sicurezza e dati

- Cookie di sessione opaco `HttpOnly`, `SameSite=Lax`, `Secure` in HTTPS. Nel database c'è solo l'hash SHA-256 del token.
- OAuth con `state`; il `redirect_uri` è costruito da `BASE_URL`, mai dall'header `Host`.
- CSRF: ogni scrittura richiede l'header `X-Articola`.
- Ogni query è filtrata per `user_id`, e gli id sono UUID validati.
- Limiti per utente: chiamate AI all'ora, rigenerazioni del percorso al giorno, numero di registrazioni e spazio audio.
- Le preferenze, che finiscono nei prompt, sono validate con liste bianche e ripulite.
- Eliminando l'account si cancellano a cascata percorsi, registrazioni, audio e progressi.
