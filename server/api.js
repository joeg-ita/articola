// REST API under /api/*. Everything except /api/me and /api/meta requires a logged-in user, and every query that
// touches user data is scoped by user_id. Writes must carry the X-Articola header (CSRF: a cross-site page cannot
// send it without a CORS preflight, which is never granted).
'use strict';
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const P = require('./program');
const prefsLib = require('./prefs');
const coach = require('./coach');
const metricsLib = require('./metrics');
const stt = require('./stt');
const llm = require('./llm');
const i18n = require('./i18n');
const { HttpError, sendJson, readJson, readBody } = require('./http');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUDIO_MIME_RE = /^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,"'-]+)?$/i;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const KINDS = ['baseline', 'weekly', 'practice', 'final'];
const CRITERIA_IDS = P.ids(P.CRITERIA);
const STALE_GENERATION_MS = 10 * 60 * 1000;

/* ---------- rate limiting (in-memory, per user, sliding window) ---------- */

function makeLimiter(max, windowMs = 3600000) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }, 600000).unref();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr); return true;
  };
}
const llmLimiter = makeLimiter(config.llmRatePerHour);
const writeLimiter = makeLimiter(600);
const sttLimiter = makeLimiter(30);
const tooMany = () => new HttpError(429, 'Troppe richieste: riprova tra un po\'.');

/* ---------- validation helpers ---------- */

const checkUuid = (s) => { if (!UUID_RE.test(s)) throw new HttpError(400, 'Identificativo non valido.'); return s.toLowerCase(); };
function checkDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) throw new HttpError(400, 'Data non valida.');
  const t = Date.parse(s + 'T00:00:00Z');
  // "Today" as the client sees it can differ from server time by timezone: allow a couple of days.
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s || Math.abs(t - Date.now()) > 2 * 86400000) throw new HttpError(400, 'Data non valida.');
  return s;
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/* ---------- background jobs (in-process, deduplicated) ---------- */

const jobs = new Map();      // key -> promise
const jobErrors = new Map(); // key -> { message, at }
function runJob(key, fn) {
  if (jobs.has(key)) return;
  jobErrors.delete(key);
  const p = (async () => {
    try { await fn(); }
    catch (e) {
      if (!(e instanceof HttpError)) console.error(`[job] ${key.split(':')[0]}:`, e.message);
      jobErrors.set(key, { message: e instanceof HttpError ? e.message : 'Generazione non riuscita.', at: Date.now() });
    } finally { jobs.delete(key); }
  })();
  jobs.set(key, p);
}
const recentError = (key) => { const e = jobErrors.get(key); return e && Date.now() - e.at < 5 * 60000 ? e.message : null; };

/* ---------- paths ---------- */

function pathView(r, lang) {
  if (!r) return null;
  let status = r.status; let error = r.error;
  if (status === 'generating' && Date.now() - new Date(r.updated_at).getTime() > STALE_GENERATION_MS) { status = 'failed'; error = 'La generazione si è interrotta: riprova.'; }
  return { id: r.id, status, weeks: r.weeks, startDate: r.start_date ? isoDay(r.start_date) : null, plan: r.plan, error: i18n.tr(lang, error), createdAt: r.created_at };
}

async function currentPathRow(userId) {
  const { rows } = await db.query(
    `SELECT * FROM paths WHERE user_id = $1 AND status <> 'archived' ORDER BY (status IN ('generating','ready')) DESC, created_at DESC LIMIT 1`, [userId]);
  return rows[0] || null;
}
async function readyPath(userId) {
  const r = await currentPathRow(userId);
  if (!r || r.status !== 'ready') throw new HttpError(409, 'Nessun percorso attivo.', 'no_path');
  return r;
}

// Where the user is in the path on a given day.
function position(pathRow, day) {
  if (!pathRow.start_date) return { started: false, dayIndex: 0, week: 1, finished: false };
  const dayIndex = Math.max(0, daysBetween(isoDay(pathRow.start_date), day));
  const raw = Math.floor(dayIndex / 7) + 1;
  return { started: true, dayIndex, week: Math.min(raw, pathRow.weeks), finished: raw > pathRow.weeks };
}

async function generatePath(user, res) {
  const prefs = prefsLib.withDefaults(user.preferences);
  if (!prefs.goals.length && !prefs.goalText) throw new HttpError(400, 'Completa prima l\'onboarding.');
  const recent = await db.query(`SELECT count(*)::int AS n FROM paths WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [user.id]);
  if (recent.rows[0].n >= config.pathRegenPerDay) throw new HttpError(429, 'Hai rigenerato il percorso troppe volte oggi: riprova domani.');
  if (!llmLimiter(user.id)) throw tooMany();
  let pathId;
  try {
    pathId = await db.withTx(async (c) => {
      const live = await c.query(`SELECT id, status, updated_at FROM paths WHERE user_id = $1 AND status IN ('generating','ready') FOR UPDATE`, [user.id]);
      for (const r of live.rows) {
        if (r.status === 'generating' && Date.now() - new Date(r.updated_at).getTime() < STALE_GENERATION_MS) throw new HttpError(409, 'Il percorso è già in preparazione.');
      }
      await c.query(`UPDATE paths SET status = 'archived', updated_at = now() WHERE user_id = $1 AND status IN ('generating','ready','failed')`, [user.id]);
      const ins = await c.query(`INSERT INTO paths (user_id, status, weeks) VALUES ($1, 'generating', $2) RETURNING id`, [user.id, prefs.weeks]);
      return ins.rows[0].id;
    });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Il percorso è già in preparazione.');
    throw e;
  }
  runJob(`path:${pathId}`, async () => {
    try {
      const plan = await coach.generatePath(prefs, user.name);
      await db.query(`UPDATE paths SET status = 'ready', plan = $2, error = NULL, updated_at = now() WHERE id = $1 AND status = 'generating'`, [pathId, plan]);
    } catch (e) {
      await db.query(`UPDATE paths SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [pathId, e instanceof HttpError ? e.message : 'Generazione non riuscita: riprova.']);
      throw e;
    }
  });
  sendJson(res, 202, { id: pathId, status: 'generating' });
}

/* ---------- today ---------- */

async function avoidLists(userId, pathId) {
  const { rows } = await db.query('SELECT payload FROM daily_content WHERE user_id = $1 AND path_id = $2 ORDER BY day_key DESC LIMIT 10', [userId, pathId]);
  return {
    twisters: rows.flatMap((r) => r.payload.tongue_twisters || []).slice(0, 15),
    readings: rows.map((r) => r.payload.reading && r.payload.reading.title).filter(Boolean),
    words: rows.flatMap((r) => r.payload.improv_words || []).slice(0, 30),
  };
}

async function weekStats(userId, pathRow, pos) {
  const startWeek = new Date(Date.parse(isoDay(pathRow.start_date) + 'T00:00:00Z') + (pos.week - 1) * 7 * 86400000).toISOString().slice(0, 10);
  const prog = await db.query(
    `SELECT count(*) FILTER (WHERE routine_done)::int AS routine_days, bool_or(challenge_done) AS challenge
       FROM day_progress WHERE user_id = $1 AND path_id = $2 AND week = $3`, [userId, pathRow.id, pos.week]);
  const recs = await db.query(
    `SELECT kind, prompt_key, week FROM recordings WHERE user_id = $1 AND path_id = $2`, [userId, pathRow.id]);
  const baselineDone = [...new Set(recs.rows.filter((r) => r.kind === 'baseline').map((r) => r.prompt_key))];
  const finalDone = [...new Set(recs.rows.filter((r) => r.kind === 'final').map((r) => r.prompt_key))];
  return {
    weekStart: startWeek,
    routineDays: prog.rows[0].routine_days,
    challengeDone: !!prog.rows[0].challenge,
    weeklyRecordingDone: recs.rows.some((r) => r.kind === 'weekly' && r.week === pos.week),
    baselineDone, finalDone,
  };
}

async function streak(userId, pathId, day) {
  const { rows } = await db.query(
    `SELECT day_key FROM day_progress WHERE user_id = $1 AND path_id = $2 AND routine_done ORDER BY day_key DESC LIMIT 400`, [userId, pathId]);
  const days = new Set(rows.map((r) => isoDay(r.day_key)));
  let n = 0; let d = day;
  if (!days.has(d)) d = new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); // today not done yet: count up to yesterday
  while (days.has(d)) { n++; d = new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10); }
  return { current: n, total: days.size };
}

async function today(user, req, url, res) {
  const day = checkDay(url.searchParams.get('day'));
  const pathRow = await readyPath(user.id);
  if (!pathRow.start_date) throw new HttpError(409, 'Il percorso non è ancora iniziato.', 'not_started');
  const pos = position(pathRow, day);
  const plan = pathRow.plan;
  const key = `daily:${user.id}:${pathRow.id}:${day}`;
  const got = await db.query('SELECT payload FROM daily_content WHERE user_id = $1 AND path_id = $2 AND day_key = $3', [user.id, pathRow.id, day]);
  let content = got.rows[0] ? got.rows[0].payload : null;
  let contentStatus = content ? 'ready' : 'generating';
  let contentError = null;
  if (!content) {
    contentError = recentError(key);
    if (contentError && url.searchParams.get('retry') !== '1') contentStatus = 'failed';
    else if (!jobs.has(key)) {
      if (!llmLimiter(user.id)) { contentStatus = 'failed'; contentError = 'Troppe richieste: riprova tra un po\'.'; }
      else {
        const prefs = prefsLib.withDefaults(user.preferences);
        runJob(key, async () => {
          const payload = await coach.generateDaily({ plan, week: pos.week, prefs, dayIndex: pos.dayIndex, avoid: await avoidLists(user.id, pathRow.id) });
          await db.query(
            `INSERT INTO daily_content (user_id, path_id, day_key, week, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [user.id, pathRow.id, day, pos.week, payload]);
        });
        contentError = null; contentStatus = 'generating';
      }
    }
  }
  const prog = await db.query('SELECT steps_done, routine_done, challenge_done FROM day_progress WHERE user_id = $1 AND path_id = $2 AND day_key = $3', [user.id, pathRow.id, day]);
  const p = prog.rows[0] || { steps_done: [], routine_done: false, challenge_done: false };
  const prefs = prefsLib.withDefaults(user.preferences);
  sendJson(res, 200, {
    day, position: pos, week: plan.weeks[pos.week - 1], routine: plan.routine, title: plan.title,
    content, contentStatus, contentError: i18n.tr(i18n.reqLang(req), contentError),
    progress: { stepsDone: p.steps_done, routineDone: p.routine_done, challengeDone: p.challenge_done },
    stats: await weekStats(user.id, pathRow, pos),
    streak: await streak(user.id, pathRow.id, day),
    isRecordingDay: new Date(day + 'T12:00:00Z').getUTCDay() === prefs.recordingDay,
  });
}

async function saveProgress(user, req, res) {
  if (!writeLimiter(user.id)) throw tooMany();
  const body = await readJson(req, 8000);
  const day = checkDay(body.day);
  const pathRow = await readyPath(user.id);
  if (!pathRow.start_date) throw new HttpError(409, 'Il percorso non è ancora iniziato.');
  const pos = position(pathRow, day);
  const ids = pathRow.plan.routine.map((s) => s.id);
  const steps = Array.isArray(body.stepsDone) ? [...new Set(body.stepsDone.filter((s) => ids.includes(s)))] : [];
  const routineDone = steps.length === ids.length || body.routineDone === true;
  const challengeDone = body.challengeDone === true;
  await db.query(
    `INSERT INTO day_progress (user_id, path_id, day_key, week, steps_done, routine_done, challenge_done, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id, path_id, day_key) DO UPDATE SET steps_done = $5, routine_done = $6, challenge_done = $7, updated_at = now()`,
    [user.id, pathRow.id, day, pos.week, JSON.stringify(steps), routineDone, challengeDone]);
  sendJson(res, 200, { stepsDone: steps, routineDone, challengeDone, streak: await streak(user.id, pathRow.id, day) });
}

/* ---------- recordings ---------- */

function recView(r, full) {
  const out = {
    id: r.id, kind: r.kind, promptKey: r.prompt_key, prompt: r.prompt, week: r.week, pathId: r.path_id,
    durationSec: r.duration_sec, hasAudio: !!r.audio_mime, metrics: r.metrics, selfScores: r.self_scores,
    evalStatus: r.eval_status, createdAt: r.created_at,
    avgScore: metricsLib.averageScore(r.metrics, r.evaluation, r.self_scores),
  };
  if (full) Object.assign(out, { transcript: r.transcript, evaluation: r.evaluation });
  else out.evaluation = r.evaluation ? { scores: r.evaluation.scores } : null;
  return out;
}
const REC_COLS = 'id, kind, prompt_key, prompt, week, path_id, duration_sec, audio_mime, metrics, self_scores, evaluation, eval_status, created_at';

async function getRec(userId, id, cols = REC_COLS + ', transcript') {
  const { rows } = await db.query(`SELECT ${cols} FROM recordings WHERE id = $1 AND user_id = $2`, [checkUuid(id), userId]);
  if (!rows[0]) throw new HttpError(404, 'Registrazione non trovata.');
  return rows[0];
}

function cleanSelfScores(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Autovalutazione non valida.');
  const out = {};
  for (const k of CRITERIA_IDS) { const n = Number(v[k]); if (Number.isInteger(n) && n >= 1 && n <= 5) out[k] = n; }
  return Object.keys(out).length ? out : null;
}
const cleanTranscript = (t) => String(t || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 20000);

async function createRecording(user, req, res) {
  if (!writeLimiter(user.id)) throw tooMany();
  const b = await readJson(req, 64 * 1024);
  if (!KINDS.includes(b.kind)) throw new HttpError(400, 'Tipo di registrazione non valido.');
  const day = checkDay(b.day);
  const duration = Number(b.durationSec);
  if (!Number.isFinite(duration) || duration < 3 || duration > 900) throw new HttpError(400, 'Durata non valida (minimo 3 secondi, massimo 15 minuti).');
  const prompt = prefsLib.cleanText(b.prompt, 500);
  if (!prompt) throw new HttpError(400, 'Traccia mancante.');
  const promptKey = ['baseline', 'final'].includes(b.kind) ? b.promptKey : null;
  if (promptKey !== null && !P.BASELINE_CLIPS.some((c) => c.key === promptKey)) throw new HttpError(400, 'Clip non valida.');
  const count = await db.query('SELECT count(*)::int AS n FROM recordings WHERE user_id = $1', [user.id]);
  if (count.rows[0].n >= config.userMaxRecordings) throw new HttpError(409, 'Hai raggiunto il numero massimo di registrazioni: eliminane qualcuna.');
  const pathRow = await currentPathRow(user.id);
  const live = pathRow && pathRow.status === 'ready' ? pathRow : null;
  if (b.kind !== 'practice' && !live) throw new HttpError(409, 'Serve un percorso attivo.', 'no_path');
  const pos = live && live.start_date ? position(live, day) : null;
  const prefs = prefsLib.withDefaults(user.preferences);
  const transcript = cleanTranscript(b.transcript);
  const audioMetrics = metricsLib.cleanAudioMetrics(b.audioMetrics);
  const metrics = metricsLib.compute(transcript, duration, prefs.speakingLang, audioMetrics);
  metrics.audio = audioMetrics;
  const { rows } = await db.query(
    `INSERT INTO recordings (user_id, path_id, week, kind, prompt_key, prompt, duration_sec, transcript, metrics, self_scores)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${REC_COLS}, transcript`,
    [user.id, live && live.id, pos ? pos.week : (live ? 1 : null), b.kind, promptKey, prompt, duration, transcript, metrics, cleanSelfScores(b.selfScores)]);
  sendJson(res, 201, recView(rows[0], true));
}

async function uploadAudio(user, id, req, res) {
  const rec = await getRec(user.id, id, 'id, audio_mime');
  if (rec.audio_mime) throw new HttpError(409, 'Audio già caricato.');
  const mime = String(req.headers['content-type'] || '');
  if (!AUDIO_MIME_RE.test(mime)) throw new HttpError(415, 'Formato audio non supportato.');
  const buf = await readBody(req, MAX_AUDIO_BYTES);
  if (buf.length < 200) throw new HttpError(400, 'Audio vuoto.');
  const used = await db.query('SELECT COALESCE(sum(audio_bytes), 0)::bigint AS b FROM recordings WHERE user_id = $1', [user.id]);
  if (Number(used.rows[0].b) + buf.length > config.userMaxAudioMb * 1024 * 1024) throw new HttpError(409, 'Spazio per le registrazioni esaurito: eliminane qualcuna.');
  await db.query('UPDATE recordings SET audio = $3, audio_mime = $4, audio_bytes = $5, updated_at = now() WHERE id = $1 AND user_id = $2',
    [rec.id, user.id, buf, mime.slice(0, 100), buf.length]);
  sendJson(res, 200, { ok: true });
}

async function serveAudio(user, id, req, res) {
  const rec = await getRec(user.id, id, 'audio, audio_mime');
  if (!rec.audio) throw new HttpError(404, 'Audio non disponibile.');
  const buf = rec.audio; const total = buf.length;
  const headers = { 'content-type': rec.audio_mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400' };
  // Range support: Safari will not play audio served without it.
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, total - parseInt(m[2], 10));
    let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    if (start >= total || start > end) { res.writeHead(416, { 'content-range': `bytes */${total}` }); return res.end(); }
    res.writeHead(206, Object.assign(headers, { 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1 }));
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, Object.assign(headers, { 'content-length': total }));
  res.end(buf);
}

async function recomputeAndSave(user, rec, transcript, selfScores) {
  const prefs = prefsLib.withDefaults(user.preferences);
  const audio = (rec.metrics && rec.metrics.audio) || {};
  const metrics = metricsLib.compute(transcript, rec.duration_sec, prefs.speakingLang, audio);
  metrics.audio = audio;
  const changedText = transcript !== (rec.transcript || '');
  const { rows } = await db.query(
    `UPDATE recordings SET transcript = $3, metrics = $4, self_scores = $5,
            evaluation = CASE WHEN $6 THEN NULL ELSE evaluation END,
            eval_status = CASE WHEN $6 THEN 'none' ELSE eval_status END, updated_at = now()
      WHERE id = $1 AND user_id = $2 RETURNING ${REC_COLS}, transcript`,
    [rec.id, user.id, transcript, metrics, selfScores, changedText]);
  return rows[0];
}

async function patchRecording(user, id, req, res) {
  if (!writeLimiter(user.id)) throw tooMany();
  const b = await readJson(req, 64 * 1024);
  const rec = await getRec(user.id, id);
  const transcript = b.transcript !== undefined ? cleanTranscript(b.transcript) : (rec.transcript || '');
  const selfScores = b.selfScores !== undefined ? cleanSelfScores(b.selfScores) : rec.self_scores;
  sendJson(res, 200, recView(await recomputeAndSave(user, rec, transcript, selfScores), true));
}

async function transcribeRecording(user, id, res) {
  if (!sttLimiter(user.id)) throw tooMany();
  const rec = await getRec(user.id, id, REC_COLS + ', transcript, audio');
  if (!rec.audio) throw new HttpError(409, 'Carica prima l\'audio.');
  const prefs = prefsLib.withDefaults(user.preferences);
  const text = await stt.transcribe(rec.audio, rec.audio_mime, prefs.speakingLang);
  if (!text) throw new HttpError(422, 'Non ho riconosciuto parole nella registrazione.');
  sendJson(res, 200, recView(await recomputeAndSave(user, rec, cleanTranscript(text), rec.self_scores), true));
}

async function evaluateRecording(user, id, res) {
  const rec = await getRec(user.id, id);
  if (metricsLib.words(rec.transcript).length < 15) throw new HttpError(400, 'La trascrizione è troppo corta per una valutazione (servono almeno 15 parole).');
  if (!llmLimiter(user.id)) throw tooMany();
  const prefs = prefsLib.withDefaults(user.preferences);
  let weekInfo = null;
  if (rec.path_id && rec.week) {
    const p = await db.query('SELECT plan FROM paths WHERE id = $1 AND user_id = $2', [rec.path_id, user.id]);
    const w = p.rows[0] && p.rows[0].plan && p.rows[0].plan.weeks[rec.week - 1];
    if (w) weekInfo = w;
  }
  await db.query(`UPDATE recordings SET eval_status = 'pending' WHERE id = $1 AND user_id = $2`, [rec.id, user.id]);
  let evaluation;
  try {
    evaluation = await coach.evaluateRecording({ rec, metrics: Object.assign({ durationSec: rec.duration_sec }, rec.metrics), prefs, weekInfo });
  } catch (e) {
    await db.query(`UPDATE recordings SET eval_status = 'failed' WHERE id = $1 AND user_id = $2`, [rec.id, user.id]);
    throw e;
  }
  const { rows } = await db.query(
    `UPDATE recordings SET evaluation = $3, eval_status = 'done', updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${REC_COLS}, transcript`,
    [rec.id, user.id, evaluation]);
  sendJson(res, 200, recView(rows[0], true));
}

async function listRecordings(user, res) {
  const { rows } = await db.query(`SELECT ${REC_COLS} FROM recordings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`, [user.id]);
  sendJson(res, 200, { recordings: rows.map((r) => recView(r, false)) });
}

/* ---------- progress ---------- */

const avg = (arr) => { const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

function seriesRow(r) {
  const m = r.metrics || {};
  return {
    id: r.id, date: r.created_at, week: r.week, kind: r.kind, promptKey: r.prompt_key,
    wpm: m.words ? m.wpm : null, fillersPerMin: m.words ? m.fillers.perMin : null,
    pausesPerMin: m.pausesPerMin ?? null, pitchStdSt: m.pitchStdSt ?? null,
    avgScore: metricsLib.averageScore(m, r.evaluation, r.self_scores), hasAudio: !!r.audio_mime,
  };
}

async function progress(user, req, res) {
  const pathRow = await readyPath(user.id);
  const recs = await db.query(`SELECT ${REC_COLS} FROM recordings WHERE user_id = $1 AND path_id = $2 ORDER BY created_at ASC`, [user.id, pathRow.id]);
  const series = recs.rows.map(seriesRow);
  const days = await db.query(
    `SELECT week, count(*) FILTER (WHERE routine_done)::int AS routine_days, bool_or(challenge_done) AS challenge
       FROM day_progress WHERE user_id = $1 AND path_id = $2 GROUP BY week`, [user.id, pathRow.id]);
  const byWeek = new Map(days.rows.map((r) => [r.week, r]));
  const weeks = pathRow.plan.weeks.map((w) => {
    const rs = series.filter((s) => s.week === w.week);
    const d = byWeek.get(w.week);
    return {
      week: w.week, focus: w.focus, routineDays: d ? d.routine_days : 0, challengeDone: !!(d && d.challenge),
      wpm: avg(rs.map((s) => s.wpm)), fillersPerMin: avg(rs.map((s) => s.fillersPerMin)), avgScore: avg(rs.map((s) => s.avgScore)), recordings: rs.length,
    };
  });
  const comparison = P.BASELINE_CLIPS.map((c) => {
    const base = series.find((s) => s.kind === 'baseline' && s.promptKey === c.key) || null;
    const finals = series.filter((s) => s.kind === 'final' && s.promptKey === c.key);
    const title = (i18n.program(i18n.reqLang(req)).baselineClips.find((x) => x.key === c.key) || c).title;
    return { key: c.key, title, baseline: base, final: finals[finals.length - 1] || null };
  });
  const ins = await db.query('SELECT payload, recordings_n, created_at FROM insights WHERE user_id = $1 AND path_id = $2', [user.id, pathRow.id]);
  const insight = ins.rows[0] ? Object.assign({}, ins.rows[0].payload, { stale: ins.rows[0].recordings_n !== series.length, createdAt: ins.rows[0].created_at }) : null;
  const prefs = prefsLib.withDefaults(user.preferences);
  sendJson(res, 200, { series, weeks, comparison, insight, daysPerWeek: prefs.daysPerWeek, startDate: pathRow.start_date ? isoDay(pathRow.start_date) : null });
}

async function makeInsight(user, req, res) {
  const body = await readJson(req, 2000);
  const day = checkDay(body.day);
  const pathRow = await readyPath(user.id);
  const recs = await db.query(`SELECT ${REC_COLS} FROM recordings WHERE user_id = $1 AND path_id = $2 ORDER BY created_at ASC`, [user.id, pathRow.id]);
  const rows = recs.rows.map(seriesRow).filter((r) => r.wpm != null);
  if (rows.length < 2) throw new HttpError(400, 'Servono almeno due registrazioni con trascrizione per leggere i progressi.');
  if (!llmLimiter(user.id)) throw tooMany();
  const pos = position(pathRow, day);
  const payload = await coach.progressInsight({
    plan: pathRow.plan, prefs: prefsLib.withDefaults(user.preferences), week: pos.week,
    rows: rows.slice(-40).map((r) => Object.assign({}, r, { date: isoDay(r.date) })),
  });
  await db.query(
    `INSERT INTO insights (user_id, path_id, recordings_n, payload) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, path_id) DO UPDATE SET recordings_n = $3, payload = $4, created_at = now()`,
    [user.id, pathRow.id, recs.rows.length, payload]);
  sendJson(res, 200, Object.assign({}, payload, { stale: false, createdAt: new Date() }));
}

/* ---------- me / meta ---------- */

async function me(req, res) {
  const user = await auth.authenticate(req, res);
  if (!user) return sendJson(res, 200, { user: null, providers: auth.providersPublic() });
  const ids = await db.query('SELECT provider FROM identities WHERE user_id = $1', [user.id]);
  const pathRow = await currentPathRow(user.id);
  sendJson(res, 200, {
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, onboarded: user.onboarded, preferences: prefsLib.withDefaults(user.preferences), hasPreferences: !!(user.preferences && user.preferences.goals) },
    linked: ids.rows.map((r) => r.provider),
    providers: auth.providersPublic(),
    path: pathView(pathRow, i18n.reqLang(req)),
  });
}

function meta(req, url, res) {
  sendJson(res, 200, {
    ...i18n.program(i18n.reqLang(req, url)), options: prefsLib.OPTIONS,
    serverTranscription: stt.enabled(), ai: { provider: llm.PROVIDER, model: llm.MODEL },
  }, { 'cache-control': 'private, max-age=300' });
}

/* ---------- router ---------- */

async function handle(req, res, url) {
  const { pathname } = url; const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && !req.headers['x-articola']) throw new HttpError(403, 'Richiesta non valida.');
  if (pathname === '/api/me' && method === 'GET') return me(req, res);
  if (pathname === '/api/meta' && method === 'GET') return meta(req, url, res);

  const user = await auth.authenticate(req, res);
  if (!user) throw new HttpError(401, 'Accesso richiesto.');

  if (pathname === '/api/auth/logout' && method === 'POST') { await auth.destroySession(req, res); return sendJson(res, 200, { ok: true }); }
  if (pathname === '/api/me' && method === 'DELETE') {
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    await auth.destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/preferences' && method === 'PUT') {
    if (!writeLimiter(user.id)) throw tooMany();
    const body = await readJson(req, 16 * 1024);
    const prefs = prefsLib.validate(body.preferences);
    await db.query('UPDATE users SET preferences = $2 WHERE id = $1', [user.id, prefs]);
    return sendJson(res, 200, { preferences: prefs });
  }

  if (pathname === '/api/path' && method === 'GET') return sendJson(res, 200, { path: pathView(await currentPathRow(user.id), i18n.reqLang(req)) });
  if (pathname === '/api/path/generate' && method === 'POST') return generatePath(user, res);
  if (pathname === '/api/path/accept' && method === 'POST') {
    const body = await readJson(req, 2000);
    const day = checkDay(body.day);
    const pathRow = await readyPath(user.id);
    await db.query('UPDATE paths SET start_date = COALESCE(start_date, $2::date), updated_at = now() WHERE id = $1', [pathRow.id, day]);
    await db.query('UPDATE users SET onboarded = true WHERE id = $1', [user.id]);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/today' && method === 'GET') return today(user, req, url, res);
  if (pathname === '/api/today/progress' && method === 'POST') return saveProgress(user, req, res);

  if (pathname === '/api/recordings' && method === 'GET') return listRecordings(user, res);
  if (pathname === '/api/recordings' && method === 'POST') return createRecording(user, req, res);
  const m = pathname.match(/^\/api\/recordings\/([^/]+)(?:\/(audio|transcribe|evaluate))?$/);
  if (m) {
    const [, id, sub] = m;
    if (!sub && method === 'GET') return sendJson(res, 200, recView(await getRec(user.id, id), true));
    if (!sub && method === 'PATCH') return patchRecording(user, id, req, res);
    if (!sub && method === 'DELETE') {
      const r = await db.query('DELETE FROM recordings WHERE id = $1 AND user_id = $2', [checkUuid(id), user.id]);
      if (!r.rowCount) throw new HttpError(404, 'Registrazione non trovata.');
      return sendJson(res, 200, { ok: true });
    }
    if (sub === 'audio' && method === 'PUT') return uploadAudio(user, id, req, res);
    if (sub === 'audio' && (method === 'GET' || method === 'HEAD')) return serveAudio(user, id, req, res);
    if (sub === 'transcribe' && method === 'POST') return transcribeRecording(user, id, res);
    if (sub === 'evaluate' && method === 'POST') return evaluateRecording(user, id, res);
  }

  if (pathname === '/api/progress' && method === 'GET') return progress(user, req, res);
  if (pathname === '/api/progress/insight' && method === 'POST') return makeInsight(user, req, res);

  throw new HttpError(404, 'Non trovato.');
}

module.exports = { handle, position, daysBetween };
