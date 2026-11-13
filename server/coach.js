// What the AI is asked to write, and how its output is tidied before it is stored.
// Callers pass validated input only (preferences through prefs.validate, metrics through metrics.js).
'use strict';
const P = require('./program');
const S = require('./schemas');
const llm = require('./llm');
const { HttpError } = require('./http');

const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
const LANG_NAME = { it: 'italiano', en: 'inglese' };
const STYLE = {
  practical: 'molto pratico: pochi concetti, tanti esercizi brevi',
  balanced: 'equilibrato tra spiegazioni brevi e pratica',
  deep: 'approfondito: spiega il perché di ogni esercizio, con più teoria',
};
const TONE = {
  direct: 'diretto e asciutto, come un coach esigente ma rispettoso',
  encouraging: 'incoraggiante e caldo, senza sminuire i problemi',
};
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));
// Safety cap on model text. Limits are generous (the prompt asks for short text); if one is ever hit the cut
// falls on a word boundary with an ellipsis instead of mid-word.
const str = (s, max) => {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
};
const strList = (a, n, max) => (Array.isArray(a) ? a.map((s) => str(s, max)).filter(Boolean).slice(0, n) : []);

// The person reads what the coach writes in the interface language (uiLang); what they say out loud (tongue
// twisters, reading, improvisation words, questions, a rewritten opening) is in the language they practise.
// The prompts stay in Italian; with an English interface the model is told explicitly to answer in English.
const uiLangName = (prefs) => LANG_NAME[prefs.uiLang] || LANG_NAME.it;
function systemCoach(prefs) {
  return `Sei un coach di comunicazione orale (dizione, public speaking, pensiero strutturato) che lavora con professionisti.
Scrivi in ${uiLangName(prefs)} chiaro, frasi brevi, concreto, senza gergo motivazionale né emoji.${prefs.uiLang === 'en'
    ? '\nIMPORTANT: these instructions are in Italian, but every text you write for the person must be in English, unless a rule below asks for another language for a specific field.'
    : ''}
${P.METHOD}`;
}

function profileText(prefs, name) {
  const goals = prefs.goals.map((g) => label(P.GOALS, g));
  const sit = prefs.situations.map((s) => label(P.SITUATIONS, s));
  const ratings = P.AREAS.map((a) => `${a.label}: ${prefs.selfRatings[a.id]}/5`).join('; ');
  return [
    `Nome: ${name || 'utente'}`,
    `Obiettivi: ${goals.join('; ') || '-'}`,
    prefs.goalText ? `Obiettivo con parole sue: "${prefs.goalText}"` : '',
    `Ruolo/contesto: ${prefs.role || 'non indicato'}`,
    `Situazioni in cui parla: ${sit.join('; ') || 'non indicate'}`,
    `Lingua in cui si allena a parlare: ${LANG_NAME[prefs.speakingLang]}`,
    `Autovalutazione di partenza: ${ratings}`,
    prefs.struggle ? `Cosa la mette più in difficoltà: "${prefs.struggle}"` : '',
    `Tempo: ${prefs.minutesPerDay} minuti al giorno, ${prefs.daysPerWeek} giorni a settimana, per ${prefs.weeks} settimane; momento preferito: ${prefs.timeOfDay}`,
    `Stile preferito: ${STYLE[prefs.style]}`,
    prefs.interests.length ? `Temi che le interessano (per testi ed esempi): ${prefs.interests.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/* ---------- the path ---------- */

async function generatePath(prefs, name) {
  const plan = await llm.generate({
    system: systemCoach(prefs),
    schema: S.PathPlan,
    maxTokens: 12000,
    user: `Crea il percorso personalizzato di questa persona.

PROFILO:
${profileText(prefs, name)}

REGOLE:
- Esattamente ${prefs.weeks} settimane, numerate da 1 a ${prefs.weeks}. La settimana 1 è sempre "punto zero" (le tre registrazioni di partenza) più respiro; l'ultima è consolidamento (si rifanno le tre registrazioni e si confrontano con la prima).
- Adatta la progressione del metodo agli obiettivi e alle situazioni: dai più spazio a ciò che serve davvero (es. chi vuole fare presentazioni arriva a una presentazione vera; chi vuole il networking lavora su conversazioni e domande). Con meno settimane accorpa i focus, con più settimane approfondisci.
- Le aree con autovalutazione più bassa vanno affrontate presto.
- Sfide reali nelle situazioni della persona (${prefs.situations.map((s) => label(P.SITUATIONS, s)).join(', ') || 'riunioni e conversazioni di lavoro'}), concrete e verificabili ("fatto / non fatto").
- Tracce di registrazione legate al focus della settimana e al suo lavoro.
- Tutti i testi del percorso sono in ${uiLangName(prefs)}.
- La routine quotidiana ha 4-6 passi e dura in totale ${prefs.minutesPerDay} minuti; parte dalla routine del metodo e la adatta (es. più improvvisazione per chi deve rispondere a domande).
- Per ogni settimana indica le strutture di pensiero su cui lavora (sigle: ${S.STRUCTURE_IDS.join(', ')}; WSN = Cosa / E quindi / E ora, THREE = Regola del tre).`,
  });
  return tidyPlan(plan, prefs);
}

function tidyPlan(plan, prefs) {
  const weeks = [];
  for (let n = 1; n <= prefs.weeks; n++) {
    const w = plan.weeks.find((x) => Math.round(x.week) === n) || plan.weeks[n - 1];
    if (!w) throw new HttpError(502, 'Il percorso generato è incompleto: riprova.');
    weeks.push({
      week: n, focus: str(w.focus, 80), objective: str(w.objective, 600), why: str(w.why, 600),
      extra_exercise: str(w.extra_exercise, 800), real_challenge: str(w.real_challenge, 800),
      recording_prompt: str(w.recording_prompt, 800), tip: str(w.tip, 600),
      structures: [...new Set(w.structures || [])].slice(0, 3),
    });
  }
  const seen = new Set();
  const routine = plan.routine.slice(0, 7).map((s, i) => {
    let id = str(s.id, 24).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `passo-${i + 1}`;
    while (seen.has(id)) id += '-' + i;
    seen.add(id);
    return { id, kind: s.kind, title: str(s.title, 80), minutes: clampInt(s.minutes, 1, 15), instructions: str(s.instructions, 1000) };
  });
  return {
    title: str(plan.title, 100), summary: str(plan.summary, 1200), goals: strList(plan.goals, 5, 400),
    routine, weeks, habits: strList(plan.habits, 3, 400),
  };
}

/* ---------- the exercises of one day ---------- */

async function generateDaily({ plan, week, prefs, dayIndex, avoid }) {
  const w = plan.weeks[week - 1];
  const lang = LANG_NAME[prefs.speakingLang];
  const minutesReading = (plan.routine.find((s) => s.kind === 'reading') || {}).minutes || 4;
  const words = Math.round(Math.min(450, Math.max(120, minutesReading * 70)));
  const out = await llm.generate({
    system: systemCoach(prefs),
    schema: S.DailyContent,
    maxTokens: 4000,
    user: `Prepara gli esercizi di oggi (giorno ${dayIndex + 1} del percorso, settimana ${week} di ${plan.weeks.length}).

FOCUS DELLA SETTIMANA: ${w.focus} — ${w.objective}
Esercizio aggiuntivo della settimana: ${w.extra_exercise}
Strutture della settimana: ${w.structures.join(', ') || 'PREP'}
Correzione su cui concentrarsi: ${w.tip}

PROFILO:
${profileText(prefs)}

REGOLE:
- Scioglilingua, brano, parole per l'improvvisazione e domanda per la struttura sono in ${lang} (la persona li dice ad alta voce); focus_tip, hint ed extra sono in ${uiLangName(prefs)}. Scioglilingua: 3, uno facile, uno medio, uno difficile; preferisci quelli classici e corretti, in tema con il focus (es. consonanti doppie, r, s) e non ripetere questi recenti: ${avoid.twisters.join(' | ') || 'nessuno'}.
- Brano: circa ${words} parole, su uno dei temi della persona${prefs.interests.length ? ` (${prefs.interests.join(', ')})` : ''} o sul suo lavoro, scritto per essere letto ad alta voce; segna con " / " le pause da fare. Titoli recenti da non ripetere: ${avoid.readings.join(' | ') || 'nessuno'}.
- Parole per l'improvvisazione: concrete e varie, non ripetere: ${avoid.words.join(', ') || 'nessuna'}.
- Domanda per la struttura: realistica per il suo contesto, con una sola struttura tra quelle della settimana.`,
  });
  return {
    focus_tip: str(out.focus_tip, 600),
    tongue_twisters: strList(out.tongue_twisters, 3, 600),
    reading: { title: str(out.reading.title, 120), text: str(out.reading.text, 4000) },
    improv_words: strList(out.improv_words, 3, 40),
    structure_drill: { structure: out.structure_drill.structure, question: str(out.structure_drill.question, 600), hint: str(out.structure_drill.hint, 600) },
    extra: str(out.extra, 1000),
  };
}

/* ---------- evaluation of a recording ---------- */

async function evaluateRecording({ rec, metrics, prefs, weekInfo }) {
  const m = metrics;
  const facts = [
    `Durata: ${m.durationSec} s; parole: ${m.words}; velocità: ${m.wpm} parole/min (obiettivo 130-160)`,
    `Intercalari: ${m.fillers.total} (${m.fillers.perMin}/min; obiettivo sotto 3/min)${m.fillers.total ? ' — ' + Object.entries(m.fillers.byWord).map(([k, v]) => `"${k}" ×${v}`).join(', ') : ''}`,
    m.pausesPerMin != null ? `Pause misurate sull'audio: ${m.pausesPerMin}/min, di cui lunghe (>2 s): ${m.longPauses}; parlato effettivo ${m.speechRatio}% del tempo` : '',
    m.pitchStdSt != null ? `Variazione dell'intonazione: ${m.pitchStdSt} semitoni (sotto 1,5 = piatta, sopra 3 = espressiva)` : '',
  ].filter(Boolean).join('\n');
  const out = await llm.generate({
    system: `${systemCoach(prefs)}\nTono del feedback: ${TONE[prefs.feedbackTone]}.`,
    schema: S.Evaluation,
    maxTokens: 3000,
    user: `Valuta questa registrazione con la griglia del metodo.

TRACCIA: ${rec.prompt}
${weekInfo ? `FOCUS DELLA SETTIMANA ${weekInfo.week}: ${weekInfo.focus} (correzione su cui lavora: ${weekInfo.tip})` : ''}
LINGUA PARLATA: ${LANG_NAME[prefs.speakingLang]}

DATI MISURATI (affidabili, usali):
${facts}

TRASCRIZIONE (automatica: può contenere errori di riconoscimento, non penalizzarli; la punteggiatura è approssimativa):
"""
${rec.transcript}
"""

Dai i voti 1-5 solo per chiarezza, struttura e chiusura: velocità, intercalari e pause sono già misurati, tono e dizione li valuta la persona riascoltandosi (tu non senti l'audio, non commentarli). Nei miglioramenti puoi usare i dati misurati. La "one_correction" deve essere una sola, coerente con il focus della settimana quando possibile.
Scrivi tutto in ${uiLangName(prefs)}, tranne "better_opening" che è in ${LANG_NAME[prefs.speakingLang]} (è una frase da dire). Se non riconosci una struttura, "structure_used" è "${prefs.uiLang === 'en' ? 'none' : 'nessuna'}".`,
  });
  return {
    summary: str(out.summary, 1500),
    scores: { clarity: clampInt(out.scores.clarity, 1, 5), structure: clampInt(out.scores.structure, 1, 5), closing: clampInt(out.scores.closing, 1, 5) },
    structure_used: str(out.structure_used, 60),
    strengths: strList(out.strengths, 3, 600),
    improvements: strList(out.improvements, 3, 600),
    one_correction: str(out.one_correction, 800),
    better_opening: str(out.better_opening, 800),
  };
}

/* ---------- reading of the progress ---------- */

async function progressInsight({ plan, rows, prefs, week }) {
  const lines = rows.map((r) => `${r.date} sett.${r.week || '-'} ${r.kind}${r.promptKey ? '/' + r.promptKey : ''}: ${r.wpm ?? '-'} parole/min, ${r.fillersPerMin ?? '-'} intercalari/min, pause ${r.pausesPerMin ?? '-'}/min, intonazione ${r.pitchStdSt ?? '-'} st, voto medio ${r.avgScore ?? '-'}`).join('\n');
  const out = await llm.generate({
    system: `${systemCoach(prefs)}\nTono: ${TONE[prefs.feedbackTone]}.`,
    schema: S.Insight,
    maxTokens: 2000,
    user: `Leggi i progressi di questa persona (settimana ${week} di ${plan.weeks.length}, obiettivi: ${plan.goals.join('; ')}).

REGISTRAZIONI (dalla più vecchia):
${lines}

Confronta l'inizio con le registrazioni recenti, cita i numeri, non inventare dati che non ci sono. Se le registrazioni sono poche dillo.`,
  });
  return { headline: str(out.headline, 600), trends: strList(out.trends, 4, 600), keep: strList(out.keep, 3, 600), next_focus: str(out.next_focus, 800) };
}

module.exports = { generatePath, generateDaily, evaluateRecording, progressInsight, tidyPlan };
