// End-to-end run of the API against a live server (dev login + mock LLM): onboarding → path → today → recording
// → evaluation → progress → insight → isolation between users → account deletion.
// Usage: BASE=http://127.0.0.1:3100 node test/e2e.js
'use strict';
const assert = require('assert');
const BASE = process.env.BASE || 'http://127.0.0.1:3100';

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const h = Object.assign({ 'x-articola': '1' }, headers);
    if (cookie) h.cookie = cookie;
    let payload;
    if (Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(',').map((c) => c.split(';')[0]).filter((c) => /ar_sid=/.test(c) && !/ar_sid=;/.test(c)).pop() || cookie;
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
}
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (label) => console.log('  ✓', label);

(async () => {
  const a = client(); const b = client();
  let r = await a('GET', '/api/me');
  assert.equal(r.data.user, null); assert.equal(r.data.providers.dev, true); ok('anonymous /api/me');
  r = await a('GET', '/api/today?day=' + day); assert.equal(r.status, 401); ok('401 without session');
  r = await fetch(BASE + '/api/preferences', { method: 'PUT' }); assert.equal(r.status, 403); ok('403 without CSRF header');

  r = await a('POST', '/auth/dev', { name: 'Anna Test' }); assert.equal(r.status, 200);
  r = await a('GET', '/api/me'); assert.equal(r.data.user.name, 'Anna Test'); assert.equal(r.data.user.onboarded, false); ok('dev login');

  r = await a('PUT', '/api/preferences', { preferences: { goals: [] } }); assert.equal(r.status, 400); ok('preferences need a goal');
  r = await a('PUT', '/api/preferences', { preferences: {
    goals: ['meetings', 'fillers', 'bogus'], goalText: 'Parlare al board <script>', role: 'Sviluppatrice', situations: ['standup', 'calls'],
    speakingLang: 'it', selfRatings: { voice: 2, structure: 4, confidence: 9 }, minutesPerDay: 15, daysPerWeek: 5, weeks: 4, style: 'practical',
    interests: ['Montagna', 'Tecnologia'], feedbackTone: 'direct', recordingDay: 5,
  } });
  assert.equal(r.status, 200); assert.deepEqual(r.data.preferences.goals, ['meetings', 'fillers']);
  assert.equal(r.data.preferences.selfRatings.confidence, 3); assert.ok(!r.data.preferences.goalText.includes('<')); ok('preferences validated & cleaned');

  r = await a('POST', '/api/path/generate'); assert.equal(r.status, 202);
  r = await a('POST', '/api/path/generate'); assert.equal(r.status, 409); ok('path generation started, duplicate refused');
  for (let i = 0; i < 30; i++) { r = await a('GET', '/api/path'); if (r.data.path.status !== 'generating') break; await sleep(300); }
  assert.equal(r.data.path.status, 'ready', JSON.stringify(r.data.path)); assert.equal(r.data.path.plan.weeks.length, 4); ok('path ready with 4 weeks');

  r = await a('GET', '/api/today?day=' + day); assert.equal(r.status, 409); assert.equal(r.data.code, 'not_started'); ok('today needs an accepted path');
  r = await a('POST', '/api/path/accept', { day }); assert.equal(r.status, 200);
  r = await a('GET', '/api/me'); assert.equal(r.data.user.onboarded, true); ok('path accepted, onboarded');

  r = await a('GET', '/api/today?day=' + day);
  assert.equal(r.status, 200); assert.equal(r.data.position.week, 1); assert.equal(r.data.contentStatus, 'generating');
  for (let i = 0; i < 30 && r.data.contentStatus !== 'ready'; i++) { await sleep(300); r = await a('GET', '/api/today?day=' + day); }
  assert.equal(r.data.contentStatus, 'ready'); assert.equal(r.data.content.tongue_twisters.length, 3); ok('daily content generated and cached');
  const ids = r.data.routine.map((s) => s.id);

  r = await a('POST', '/api/today/progress', { day, stepsDone: [ids[0], 'nope'], challengeDone: true });
  assert.deepEqual(r.data.stepsDone, [ids[0]]); assert.equal(r.data.routineDone, false);
  r = await a('POST', '/api/today/progress', { day, stepsDone: ids, challengeDone: true });
  assert.equal(r.data.routineDone, true); assert.equal(r.data.streak.current, 1); ok('progress saved, routine done, streak 1');

  const transcript = 'Allora, eh, oggi vi parlo del progetto. Cioè, praticamente abbiamo migrato il database in tre settimane, ' +
    'tipo di lavoro che richiede attenzione. Il motivo è la replica. Diciamo che il risultato è buono e i tempi sono rispettati. ' +
    'Ricapitolando: migrazione fatta, rischi bassi, prossimo passo il monitoraggio.';
  r = await a('POST', '/api/recordings', { kind: 'baseline', promptKey: 'explain', prompt: 'Spiega un progetto', durationSec: 30, transcript, day,
    audioMetrics: { pausesPerMin: 9, longPauses: 1, speechRatio: 82, pitchStdSt: 2.1, evil: 'x' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = r.data;
  assert.equal(rec.metrics.fillers.total, 4, JSON.stringify(rec.metrics.fillers)); // eh, cioè, praticamente, diciamo ("tipo di" excluded)
  assert.ok(rec.metrics.wpm > 50); assert.equal(rec.metrics.measuredScores.pauses, 5); assert.equal(rec.metrics.evil, undefined); ok(`recording created: ${rec.metrics.wpm} wpm, ${rec.metrics.fillers.total} fillers`);

  const fakeAudio = Buffer.alloc(4096, 7);
  r = await a('PUT', `/api/recordings/${rec.id}/audio`, fakeAudio, { 'content-type': 'text/plain' }); assert.equal(r.status, 415);
  r = await a('PUT', `/api/recordings/${rec.id}/audio`, fakeAudio, { 'content-type': 'audio/webm;codecs=opus' }); assert.equal(r.status, 200);
  r = await a('PUT', `/api/recordings/${rec.id}/audio`, fakeAudio, { 'content-type': 'audio/webm' }); assert.equal(r.status, 409); ok('audio upload (type check, single upload)');
  r = await a('GET', `/api/recordings/${rec.id}/audio`, undefined, { range: 'bytes=0-99' });
  assert.equal(r.status, 206); assert.equal(r.data.length, 100); assert.equal(r.headers.get('content-range'), 'bytes 0-99/4096'); ok('audio range request');

  r = await a('PATCH', `/api/recordings/${rec.id}`, { selfScores: { tone: 3, diction: 4, clarity: 9 } });
  assert.deepEqual(r.data.selfScores, { tone: 3, diction: 4 }); ok('self-assessment saved');
  r = await a('POST', `/api/recordings/${rec.id}/evaluate`);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.evaluation.scores.closing, 5); assert.equal(r.data.evalStatus, 'done'); ok('AI evaluation (scores clamped)');
  r = await a('PATCH', `/api/recordings/${rec.id}`, { transcript: transcript + ' Eh, grazie.' });
  assert.equal(r.data.evaluation, null); assert.equal(r.data.metrics.fillers.total, 5); ok('transcript edit recomputes metrics and clears stale evaluation');

  r = await a('POST', '/api/recordings', { kind: 'weekly', prompt: 'Racconta', durationSec: 60, transcript: transcript.replace(/eh,|cioè,|praticamente|Diciamo che/gi, ''), day });
  assert.equal(r.status, 201); assert.equal(r.data.week, 1);
  r = await a('GET', '/api/progress');
  assert.equal(r.status, 200); assert.equal(r.data.series.length, 2); assert.equal(r.data.weeks[0].routineDays, 1); assert.equal(r.data.weeks[0].challengeDone, true);
  assert.ok(r.data.comparison.find((c) => c.key === 'explain').baseline); ok('progress: series, weekly table, baseline comparison');
  r = await a('POST', '/api/progress/insight', { day }); assert.equal(r.status, 200); assert.equal(r.data.headline, 'Gli intercalari sono scesi.');
  r = await a('GET', '/api/progress'); assert.equal(r.data.insight.stale, false); ok('insight generated and cached');

  r = await a('GET', '/api/today?day=' + day); assert.equal(r.data.stats.weeklyRecordingDone, true); assert.deepEqual(r.data.stats.baselineDone, ['explain']); ok('today reflects recordings');

  // Isolation: another user cannot see or touch Anna's data.
  await b('POST', '/auth/dev', { name: 'Bruno Test' });
  r = await b('GET', `/api/recordings/${rec.id}`); assert.equal(r.status, 404);
  r = await b('GET', `/api/recordings/${rec.id}/audio`); assert.equal(r.status, 404);
  r = await b('DELETE', `/api/recordings/${rec.id}`); assert.equal(r.status, 404);
  r = await b('GET', '/api/recordings'); assert.equal(r.data.recordings.length, 0);
  r = await b('GET', '/api/progress'); assert.equal(r.status, 409); ok('user isolation');

  r = await a('GET', '/api/meta'); assert.equal(r.data.criteria.length, 8); assert.equal(r.data.baselineClips.length, 3); ok('meta');
  r = await a('DELETE', '/api/me'); assert.equal(r.status, 200);
  r = await a('GET', '/api/me'); assert.equal(r.data.user, null); ok('account deleted and logged out');
  console.log('\nAll e2e checks passed.');
})().catch((e) => { console.error('\nE2E FAILED:', e.message); process.exit(1); });
