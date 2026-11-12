// Validation of the onboarding answers / preferences. Everything is whitelisted: these values end up in
// prompts, so free text is cleaned of control characters and quotes and capped in length.
'use strict';
const P = require('./program');
const { HttpError } = require('./http');

const GOAL_IDS = P.ids(P.GOALS);
const SITUATION_IDS = P.ids(P.SITUATIONS);
const AREA_IDS = P.ids(P.AREAS);

const OPTIONS = {
  speakingLang: ['it', 'en'],
  minutesPerDay: [10, 15, 20, 30],
  daysPerWeek: [3, 5, 7],
  weeks: [4, 6, 8, 12],
  style: ['practical', 'balanced', 'deep'],
  feedbackTone: ['direct', 'encouraging'],
  timeOfDay: ['morning', 'lunch', 'evening'],
  recordingDay: [0, 1, 2, 3, 4, 5, 6], // 0 = Sunday, as in Date#getDay; default Friday
};

const DEFAULTS = {
  goals: [], goalText: '', role: '', situations: [], speakingLang: 'it',
  selfRatings: { voice: 3, structure: 3, confidence: 3, fluency: 3 }, struggle: '',
  minutesPerDay: 15, daysPerWeek: 5, weeks: 8, style: 'balanced', interests: [],
  feedbackTone: 'encouraging', timeOfDay: 'morning', recordingDay: 5,
};

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["`<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function pickList(v, allowed, max) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => allowed.includes(x)))].slice(0, max);
}

function pickOne(v, allowed, dflt) { return allowed.includes(v) ? v : dflt; }

// Returns a complete, valid preferences object built from untrusted input (missing fields get defaults).
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Preferenze non valide.');
  const out = {};
  out.goals = pickList(input.goals, GOAL_IDS, 4);
  out.goalText = cleanText(input.goalText, 300);
  if (!out.goals.length && !out.goalText) throw new HttpError(400, 'Indica almeno un obiettivo.');
  out.role = cleanText(input.role, 80);
  out.situations = pickList(input.situations, SITUATION_IDS, 6);
  out.speakingLang = pickOne(input.speakingLang, OPTIONS.speakingLang, DEFAULTS.speakingLang);
  out.selfRatings = {};
  const r = input.selfRatings && typeof input.selfRatings === 'object' ? input.selfRatings : {};
  for (const id of AREA_IDS) {
    const n = Number(r[id]);
    out.selfRatings[id] = Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
  }
  out.struggle = cleanText(input.struggle, 300);
  for (const k of ['minutesPerDay', 'daysPerWeek', 'weeks', 'recordingDay']) out[k] = pickOne(Number(input[k]), OPTIONS[k], DEFAULTS[k]);
  for (const k of ['style', 'feedbackTone', 'timeOfDay']) out[k] = pickOne(input[k], OPTIONS[k], DEFAULTS[k]);
  out.interests = Array.isArray(input.interests)
    ? [...new Set(input.interests.map((s) => cleanText(s, 40)).filter(Boolean))].slice(0, 8)
    : [];
  return out;
}

const withDefaults = (p) => Object.assign({}, DEFAULTS, p || {});

module.exports = { validate, withDefaults, cleanText, OPTIONS, DEFAULTS };
