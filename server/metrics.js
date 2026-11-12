// Numbers measured on a recording. Text metrics (words, pace, fillers) are computed here from the transcript;
// audio metrics (pauses, speech ratio, intonation) are measured in the browser on the recorded audio and only
// validated here. Measured criteria of the grid (pace, fillers, pauses) get their 1-5 score from these numbers.
'use strict';
const { FILLERS } = require('./program');

const round1 = (n) => Math.round(n * 10) / 10;

function words(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

// Words with their position in the original text, so fillers can be highlighted exactly where they were counted.
function tokensWithPos(text) {
  const s = String(text || '');
  return Array.from(s.matchAll(/[\p{L}\p{N}']+/gu), (m) => ({ w: normToken(m[0].toLowerCase()), start: m.index, end: m.index + m[0].length }));
}

// Hesitation sounds are transcribed with any number of repeated letters ("eeeh", "ehmm", "ummm"): normalise them.
function normToken(t) {
  if (/^e+h+$/.test(t)) return 'eh';
  if (/^e+h+m+$/.test(t)) return 'ehm';
  if (/^u+m+$/.test(t)) return 'um';
  if (/^u+h+m+$/.test(t)) return 'uhm';
  if (/^u+h+$/.test(t)) return 'uh';
  if (/^m{2,}h*$/.test(t)) return 'mmh';
  if (/^h+m+$/.test(t)) return 'hmm';
  if (/^e+r+m*$/.test(t) && t.length > 1) return t.includes('m') ? 'erm' : 'er';
  return t;
}

// Words that are fillers only in some contexts. A candidate is NOT counted when the word before it is in
// `after` or the word after it is in `before` ("che tipo di", "I like", "what kind of", "do you know").
// Transcripts often carry no punctuation, so the rules are deliberately conservative.
const PRONOUNS = ['i', 'you', 'we', 'they', 'he', 'she', 'it', 'who', "i'd", "you'd", "we'd", "they'd", "he'd", "she'd"];
const CONTEXT = {
  it: {
    tipo: { after: ['un', 'che', 'questo', 'quel', 'quello', 'stesso', 'ogni', 'qualsiasi', 'nessun', 'del', 'il', 'quale', 'di', 'altro', 'nuovo'], before: ['di', 'de'] },
  },
  en: {
    like: {
      after: [...PRONOUNS, 'would', 'could', 'should', 'might', 'will', 'do', 'does', 'did', "don't", "doesn't", "didn't", 'dont', 'to', 'not',
        'look', 'looks', 'looked', 'looking', 'seem', 'seems', 'seemed', 'sound', 'sounds', 'sounded', 'feel', 'feels', 'felt', 'feeling',
        'just', 'much', 'more', 'most', 'less', 'something', 'anything', 'nothing', 'people', 'really'],
      before: ['this', 'that', 'these', 'those', 'me', 'him', 'her', 'us', 'them', 'it', 'a', 'an', 'to'],
    },
    'kind of': { after: ['a', 'what', 'this', 'that', 'the', 'any', 'some', 'every', 'one', 'which', 'same', 'different', 'new', 'right', 'wrong', 'only', 'other'] },
    'sort of': { after: ['a', 'what', 'this', 'that', 'the', 'any', 'some', 'every', 'one', 'which', 'same', 'different', 'new', 'right', 'wrong', 'only', 'other'] },
    'you know': {
      after: ['do', 'does', 'did', "don't", "doesn't", "didn't", 'dont', 'if', 'as', 'would', 'will', 'what', 'how', 'could', 'should', 'let'],
      before: ['that', 'how', 'why', 'where', 'when', 'who', 'whether', 'him', 'her', 'them', 'it', 'about', 'me', 'us', 'this', 'everything', 'anything', 'something'],
    },
    'i mean': { after: ['what', 'if', 'do', 'did', 'that'], before: ['it', 'to', 'that'] },
    'you see': { after: ['do', 'did', 'can', 'could', 'if', 'as', 'will', 'would', 'what', 'when', "don't", "didn't"], before: ['the', 'a', 'an', 'it', 'that', 'this', 'them', 'him', 'her', 'me', 'us', 'how', 'what'] },
    actually: { after: ['is', 'was', 'are', 'were'] },
  },
};

function countFillers(text, lang) {
  const toks = tokensWithPos(text);
  const list = (FILLERS[lang] || FILLERS.it).map((f) => f.split(' ')).sort((a, b) => b.length - a.length);
  const ctx = CONTEXT[lang] || CONTEXT.it;
  const byWord = {}; const spans = []; let total = 0;
  for (let i = 0; i < toks.length;) {
    const hit = list.find((f) => f.every((w, j) => toks[i + j] && toks[i + j].w === w));
    if (!hit) { i++; continue; }
    const key = hit.join(' ');
    const rule = ctx[key] || {};
    const prev = i > 0 ? toks[i - 1].w : null;
    const next = toks[i + hit.length] ? toks[i + hit.length].w : null;
    const excluded = (rule.after || []).includes(prev) || (rule.before || []).includes(next);
    if (!excluded) {
      byWord[key] = (byWord[key] || 0) + 1; total++;
      spans.push([toks[i].start, toks[i + hit.length - 1].end]);
    }
    i += hit.length;
  }
  return { total, byWord, spans };
}

function textMetrics(transcript, durationSec, lang) {
  const n = words(transcript).length;
  const minutes = Math.max(durationSec, 1) / 60;
  const f = countFillers(transcript, lang);
  return {
    durationSec: round1(durationSec),
    words: n,
    wpm: n ? Math.round(n / minutes) : 0,
    fillers: { total: f.total, perMin: round1(f.total / minutes), byWord: f.byWord, spans: f.spans },
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
