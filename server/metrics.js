// Numbers measured on a recording. Text metrics (words, pace, fillers) are computed here from the transcript;
// audio metrics (pauses, speech ratio, intonation) are measured in the browser on the recorded audio and only
// validated here. Measured criteria of the grid (pace, fillers, pauses) get their 1-5 score from these numbers.
'use strict';
const { FILLERS } = require('./program');

const round1 = (n) => Math.round(n * 10) / 10;

function words(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

// Hesitation sounds are transcribed with any number of repeated letters ("eeeh", "ehmm"): normalise them.
function normToken(t) {
  if (/^e+h+$/.test(t)) return 'eh';
  if (/^e+h+m+$/.test(t)) return 'ehm';
  if (/^u+h*m+$/.test(t)) return 'uhm';
  if (/^u+h+$/.test(t)) return 'uh';
  if (/^m{2,}h*$/.test(t)) return 'mmh';
  if (/^h+m+$/.test(t)) return 'hmm';
  if (/^e+r+m*$/.test(t) && t.length > 1) return t.includes('m') ? 'erm' : 'er';
  return t;
}

// Words that are fillers only in some contexts ("che tipo di", "kind of person").
const NOT_FILLER_BEFORE = { tipo: ['di', 'de'], 'kind of': [], 'sort of': [] };

function countFillers(text, lang) {
  const toks = words(text).map(normToken);
  const list = (FILLERS[lang] || FILLERS.it).map((f) => f.split(' ')).sort((a, b) => b.length - a.length);
  const byWord = {}; let total = 0;
  for (let i = 0; i < toks.length;) {
    const hit = list.find((f) => f.every((w, j) => toks[i + j] === w));
    if (!hit) { i++; continue; }
    const key = hit.join(' ');
    const next = toks[i + hit.length];
    if (!(NOT_FILLER_BEFORE[key] || []).includes(next)) { byWord[key] = (byWord[key] || 0) + 1; total++; }
    i += hit.length;
  }
  return { total, byWord };
}

function textMetrics(transcript, durationSec, lang) {
  const n = words(transcript).length;
  const minutes = Math.max(durationSec, 1) / 60;
  const f = countFillers(transcript, lang);
  return {
    durationSec: round1(durationSec),
    words: n,
    wpm: n ? Math.round(n / minutes) : 0,
    fillers: { total: f.total, perMin: round1(f.total / minutes), byWord: f.byWord },
  };
}

// Audio metrics arrive from the browser: keep only known numeric fields within sane ranges.
function cleanAudioMetrics(a) {
  const out = {};
  if (!a || typeof a !== 'object') return out;
  const num = (k, lo, hi) => { const v = Number(a[k]); if (Number.isFinite(v) && v >= lo && v <= hi) out[k] = round1(v); };
  num('speechSec', 0, 900);
  num('speechRatio', 0, 100);
  num('pauseCount', 0, 2000);
  num('pausesPerMin', 0, 200);
  num('longPauses', 0, 500);
  num('pitchStdSt', 0, 24);
  num('pitchMedianHz', 50, 500);
  return out;
}

function scorePace(wpm) {
  if (!wpm) return null;
  const d = wpm < 130 ? 130 - wpm : wpm > 160 ? wpm - 160 : 0;
  return d === 0 ? 5 : d <= 10 ? 4 : d <= 20 ? 3 : d <= 35 ? 2 : 1;
}
function scoreFillers(perMin, wordsN) {
  if (!wordsN) return null;
  return perMin <= 1 ? 5 : perMin <= 2 ? 4 : perMin <= 3 ? 3 : perMin <= 5 ? 2 : 1;
}
// Intentional pauses: roughly one every sentence or two (about 6-16 a minute), few long gaps.
function scorePauses(m) {
  if (m.pausesPerMin == null) return null;
  const p = m.pausesPerMin;
  let s = p >= 6 && p <= 16 ? 5 : (p >= 4 && p < 6) || (p > 16 && p <= 20) ? 4 : (p >= 2 && p < 4) || (p > 20 && p <= 26) ? 3 : 2;
  const longPerMin = (m.longPauses || 0) / Math.max(m.durationSec / 60, 0.5);
  if (longPerMin > 2) s -= 1;
  return Math.max(1, s);
}

function compute(transcript, durationSec, lang, audio) {
  const m = Object.assign(textMetrics(transcript, durationSec, lang), cleanAudioMetrics(audio));
  m.measuredScores = { pace: scorePace(m.wpm), fillers: scoreFillers(m.fillers.perMin, m.words), pauses: scorePauses(m) };
  return m;
}

// Average of every 1-5 score available on a recording (AI, measured, self).
function averageScore(metrics, evaluation, selfScores) {
  const all = Object.assign({}, (metrics && metrics.measuredScores) || {}, (evaluation && evaluation.scores) || {}, selfScores || {});
  const vals = Object.values(all).filter((v) => Number.isInteger(v) && v >= 1 && v <= 5);
  return vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

module.exports = { compute, textMetrics, countFillers, cleanAudioMetrics, averageScore, words };
