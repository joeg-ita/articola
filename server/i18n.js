// Interface languages. Italian is the source language of the code (messages, method content); English versions
// live here. The client says which language it shows with the X-Lang header (or ?lang= for cacheable GETs).
'use strict';
const P = require('./program');

const LANGS = ['it', 'en'];

function reqLang(req, url) {
  const q = url && url.searchParams.get('lang');
  if (LANGS.includes(q)) return q;
  const h = String(req.headers['x-lang'] || '').toLowerCase();
  return LANGS.includes(h) ? h : 'it';
}

/* ---------- error and status messages, keyed by the Italian text used in the code ---------- */

const MESSAGES_EN = {
  'Troppe richieste: riprova tra un po\'.': 'Too many requests: try again in a while.',
  'Identificativo non valido.': 'Invalid identifier.',
  'Data non valida.': 'Invalid date.',
  'Generazione non riuscita.': 'Generation failed.',
  'Generazione non riuscita: riprova.': 'Generation failed: please try again.',
  'La generazione si è interrotta: riprova.': 'Generation was interrupted: please try again.',
  'Nessun percorso attivo.': 'No active path.',
  'Completa prima l\'onboarding.': 'Complete the onboarding first.',
  'Hai rigenerato il percorso troppe volte oggi: riprova domani.': 'You have regenerated the path too many times today: try again tomorrow.',
  'Il percorso è già in preparazione.': 'The path is already being prepared.',
  'Il percorso non è ancora iniziato.': 'The path has not started yet.',
  'Registrazione non trovata.': 'Recording not found.',
  'Autovalutazione non valida.': 'Invalid self-assessment.',
  'Tipo di registrazione non valido.': 'Invalid recording type.',
  'Durata non valida (minimo 3 secondi, massimo 15 minuti).': 'Invalid duration (minimum 3 seconds, maximum 15 minutes).',
  'Traccia mancante.': 'Missing prompt.',
  'Clip non valida.': 'Invalid clip.',
  'Hai raggiunto il numero massimo di registrazioni: eliminane qualcuna.': 'You have reached the maximum number of recordings: delete some.',
  'Serve un percorso attivo.': 'An active path is required.',
  'Audio già caricato.': 'Audio already uploaded.',
  'Formato audio non supportato.': 'Unsupported audio format.',
  'Audio vuoto.': 'Empty audio.',
  'Spazio per le registrazioni esaurito: eliminane qualcuna.': 'Recording storage is full: delete some recordings.',
  'Audio non disponibile.': 'Audio not available.',
  'Carica prima l\'audio.': 'Upload the audio first.',
  'Non ho riconosciuto parole nella registrazione.': 'No words were recognised in the recording.',
  'La trascrizione è troppo corta per una valutazione (servono almeno 15 parole).': 'The transcript is too short to evaluate (at least 15 words are needed).',
  'Servono almeno due registrazioni con trascrizione per leggere i progressi.': 'At least two recordings with a transcript are needed to read your progress.',
  'Richiesta non valida.': 'Invalid request.',
  'Accesso richiesto.': 'Sign-in required.',
  'Non trovato.': 'Not found.',
  'Preferenze non valide.': 'Invalid preferences.',
  'Indica almeno un obiettivo.': 'Choose at least one goal.',
  'Il servizio AI non è disponibile al momento.': 'The AI service is not available right now.',
  'Il servizio AI è sovraccarico: riprova tra poco.': 'The AI service is overloaded: try again shortly.',
  'Richiesta al servizio AI non valida.': 'Invalid request to the AI service.',
  'Il modello non ha risposto in tempo.': 'The model did not respond in time.',
  'Il servizio AI ha risposto con un errore.': 'The AI service returned an error.',
  'Il modello non ha potuto generare questo contenuto. Prova a riformulare le preferenze.': 'The model could not generate this content. Try rephrasing your preferences.',
  'La risposta del modello è stata troncata.': 'The model response was truncated.',
  'Il modello ha restituito dati non validi.': 'The model returned invalid data.',
  'Impossibile contattare il servizio AI.': 'Could not reach the AI service.',
  'Risposta non valida dal servizio AI.': 'Invalid response from the AI service.',
  'Il percorso generato è incompleto: riprova.': 'The generated path is incomplete: please try again.',
  'Trascrizione sul server non configurata.': 'Server-side transcription is not configured.',
  'Impossibile contattare il servizio di trascrizione.': 'Could not reach the transcription service.',
  'Il servizio di trascrizione ha risposto con un errore.': 'The transcription service returned an error.',
  'Metodo non consentito.': 'Method not allowed.',
  'URL non valido.': 'Invalid URL.',
  'Vietato.': 'Forbidden.',
  'Richiesta troppo grande.': 'Request too large.',
  'JSON non valido.': 'Invalid JSON.',
  'Errore interno del server.': 'Internal server error.',
};

const tr = (lang, msg) => (lang === 'en' && msg && MESSAGES_EN[msg]) || msg;

/* ---------- the method content shown in the app (onboarding choices, grid, guide) ---------- */

const EN = {
  goals: {
    meetings: 'Speak up in meetings with confidence',
    presentations: 'Give effective presentations',
    fillers: 'Cut filler words ("um", "like"…)',
    diction: 'A clearer voice and crisp diction',
    structure: 'Think and speak in a structured way',
    technical: 'Explain technical topics to non-experts',
    smalltalk: 'Conversation, networking and small talk',
    interviews: 'Job interviews',
    anxiety: 'Handle anxiety when I speak',
  },
  situations: {
    standup: 'Stand-ups and team meetings',
    clients: 'Client meetings',
    calls: 'Calls and video conferences',
    talks: 'Presentations and demos',
    events: 'Events and networking',
    interviews: 'Interviews',
    teaching: 'Training and teaching',
    social: 'Informal conversations',
  },
  areas: {
    voice: 'Voice and diction',
    structure: 'Speech structure',
    confidence: 'Confidence and presence',
    fluency: 'Fluency (few fillers, good pauses)',
  },
  criteria: {
    clarity: ['Clarity', 'Is the main message clear on first listen?'],
    structure: ['Structure', 'Is there a beginning, a development and an ending?'],
    pace: ['Pace', 'Target about 130–160 words per minute'],
    fillers: ['Filler words', 'Count "um", "uh", "like", "you know", "basically" (in Italian "eh", "cioè", "praticamente", "tipo")'],
    pauses: ['Pauses', 'Do you use intentional pauses or fill every silence?'],
    tone: ['Tone', 'Does your voice vary or stay flat? Does it drop at the end of sentences?'],
    diction: ['Diction', 'Do words end cleanly or do you swallow syllables?'],
    closing: ['Closing', 'Do you end with a crisp sentence or trail off?'],
  },
  baselineClips: {
    explain: ['Explanation', 'Explain a project you worked on to someone outside your field.'],
    improv: ['Improvised', 'Answer without preparation: "What is the most useful thing you learned this year?"'],
    pitch: ['Mini-presentation', 'Present a proposal as if you were in a meeting.'],
  },
  structures: {
    BLUF: ['BLUF (Bottom Line Up Front)', 'Updates, escalations, answers to a manager', 'Conclusion → reason → details if asked', '"The migration slips to Thursday. The reason is database replication. I can show you the logs if needed."'],
    PREP: ['PREP', 'Giving an opinion, answering a question', 'Point → Reason → Example → Point', '"We should automate certificate renewal. It cuts manual errors: last month an expired one blocked the pipeline. So I\'d make it a priority."'],
    SCQA: ['SCQA', 'Proposals, presentations, budget requests', 'Situation → Complication → Question → Answer', '"Today deployments are manual. With more teams, errors grow. How do we reduce them? With a shared standard pipeline."'],
    WSN: ['What / So what / Now what', 'Incidents, retrospectives, analyses', 'What happened → why it matters → what we do', '"The node went down at 3 a.m. The service was degraded for 40 minutes. We\'re adding a memory alert."'],
    THREE: ['Rule of three', 'Any talk', 'At most three points, announced at the start', '"I\'ll cover three things: costs, timing, risks."'],
  },
  phrases: [
    ['Taking the floor', '"Can I add a point on this?"'],
    ['You disagree', '"I see the point. My concern is X, because Y. I propose Z."'],
    ['You get interrupted', '"Let me finish this thought, then it\'s over to you."'],
    ['You don\'t know the answer', '"I don\'t have that figure right now: I\'ll check and get back to you by tomorrow."'],
    ['The discussion drifts', '"To stay on time, can we pick this up in a dedicated meeting?"'],
    ['Wrapping up', '"To recap: we decide X, Y owns it, by Z."'],
    ['Asking for clarity', '"Just to make sure I understood: you mean that...?"'],
  ],
  errors: [
    ['Starting with the context', 'After a minute, listeners still don\'t know where you\'re going', 'BLUF: the conclusion in the first sentence'],
    ['Speaking too fast', 'Over 170 words per minute, swallowed syllables', 'Pause at every full stop, slow tongue twisters'],
    ['Filler words', 'More than 3 per minute', 'Replace every "um" with a silent pause'],
    ['Very long sentences', 'Chains of clauses, you lose the thread', 'One idea per sentence, then a full stop'],
    ['Voice dropping at the end', 'The last words can\'t be heard', 'Imagine "throwing" the last word to the back of the room'],
    ['Upspeak on statements', 'The sentence rises at the end like a question', 'End statements with your voice going down'],
    ['Self-deprecation', '"This may be a stupid question, but..."', 'Just ask the question'],
    ['Too much jargon', 'Acronyms and technical terms with people who don\'t know them', 'Effect first ("the site was slow"), then the technical cause'],
  ],
};

// The method lists in the requested language. Ids and keys never change: only the text does.
function program(lang) {
  if (lang !== 'en') {
    return { goals: P.GOALS, situations: P.SITUATIONS, areas: P.AREAS, criteria: P.CRITERIA, baselineClips: P.BASELINE_CLIPS, structures: P.STRUCTURES, phrases: P.PHRASES, errors: P.ERRORS };
  }
  const byId = (list, map) => list.map((x) => Object.assign({}, x, { label: map[x.id] || x.label }));
  return {
    goals: byId(P.GOALS, EN.goals),
    situations: byId(P.SITUATIONS, EN.situations),
    areas: byId(P.AREAS, EN.areas),
    criteria: P.CRITERIA.map((c) => { const e = EN.criteria[c.id]; return e ? Object.assign({}, c, { label: e[0], look: e[1] }) : c; }),
    baselineClips: P.BASELINE_CLIPS.map((c) => { const e = EN.baselineClips[c.key]; return e ? Object.assign({}, c, { title: e[0], prompt: e[1] }) : c; }),
    structures: P.STRUCTURES.map((s) => { const e = EN.structures[s.id]; return e ? Object.assign({}, s, { name: e[0], when: e[1], scheme: e[2], example: e[3] }) : s; }),
    phrases: P.PHRASES.map((p, i) => (EN.phrases[i] ? { situation: EN.phrases[i][0], phrase: EN.phrases[i][1] } : p)),
    errors: P.ERRORS.map((x, i) => (EN.errors[i] ? { error: EN.errors[i][0], sign: EN.errors[i][1], fix: EN.errors[i][2] } : x)),
  };
}

module.exports = { LANGS, reqLang, tr, program, MESSAGES_EN };
