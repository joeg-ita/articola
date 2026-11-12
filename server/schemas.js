// Shapes of everything the model writes. Used three ways: as the structured-output format for Claude,
// as the JSON schema shown to OpenAI-compatible models, and to validate whatever comes back.
// Kept simple on purpose (no length/range constraints, which not every provider enforces): numbers are
// clamped and lists trimmed in code after validation.
'use strict';
const { z } = require('zod');

const STRUCTURE_IDS = ['BLUF', 'PREP', 'SCQA', 'WSN', 'THREE'];
const STEP_KINDS = ['breath', 'warmup', 'twister', 'reading', 'improv', 'structure', 'other'];

const PathPlan = z.object({
  title: z.string().describe('Titolo breve e motivante del percorso'),
  summary: z.string().describe('2-3 frasi: cosa allena e come, in base agli obiettivi della persona'),
  goals: z.array(z.string()).describe('Gli obiettivi della persona riformulati come risultati misurabili (2-4)'),
  routine: z.array(z.object({
    id: z.string().describe('identificativo breve in minuscolo, es. "respiro"'),
    kind: z.enum(STEP_KINDS),
    title: z.string(),
    minutes: z.number(),
    instructions: z.string().describe('come si fa, in 1-3 frasi concrete'),
  })).describe('La routine quotidiana: la somma dei minuti deve essere uguale ai minuti al giorno scelti'),
  weeks: z.array(z.object({
    week: z.number(),
    focus: z.string().describe('il focus della settimana, 2-5 parole'),
    objective: z.string().describe('cosa saprà fare a fine settimana'),
    why: z.string().describe('perché questo focus serve ai suoi obiettivi, 1 frase'),
    extra_exercise: z.string().describe('esercizio aggiuntivo quotidiano legato al focus'),
    real_challenge: z.string().describe('sfida reale in una delle situazioni della persona'),
    recording_prompt: z.string().describe('traccia per la registrazione settimanale di circa 2 minuti'),
    tip: z.string().describe('la sola correzione su cui concentrarsi questa settimana'),
    structures: z.array(z.enum(STRUCTURE_IDS)),
  })),
  habits: z.array(z.string()).describe('3 abitudini da mantenere dopo il percorso'),
});

const DailyContent = z.object({
  focus_tip: z.string().describe('una frase: la sola cosa a cui pensare oggi'),
  tongue_twisters: z.array(z.string()).describe('3 scioglilingua'),
  reading: z.object({
    title: z.string(),
    text: z.string().describe('brano da leggere ad alta voce; le pause da fare sono segnate con " / "'),
  }),
  improv_words: z.array(z.string()).describe('3 parole a caso per improvvisare 60 secondi'),
  structure_drill: z.object({
    structure: z.enum(STRUCTURE_IDS),
    question: z.string().describe('domanda a cui rispondere ad alta voce con la struttura'),
    hint: z.string().describe('come impostare la risposta, 1 frase'),
  }),
  extra: z.string().describe('l\'esercizio aggiuntivo della settimana, declinato per oggi'),
});

const Evaluation = z.object({
  summary: z.string().describe('2-3 frasi di sintesi'),
  scores: z.object({
    clarity: z.number(),
    structure: z.number(),
    closing: z.number(),
  }).describe('voti 1-5 secondo la griglia'),
  structure_used: z.string().describe('quale struttura riconosci (BLUF, PREP, SCQA, Cosa/E quindi/E ora, Regola del tre) o "nessuna"'),
  strengths: z.array(z.string()).describe('2-3 punti di forza, con citazioni brevi dal testo'),
  improvements: z.array(z.string()).describe('2-3 miglioramenti concreti'),
  one_correction: z.string().describe('LA correzione su cui concentrarsi alla prossima registrazione: una o due frasi complete, concrete'),
  better_opening: z.string().describe('come avrebbe potuto iniziare, riscritto in 1-2 frasi'),
});

const Insight = z.object({
  headline: z.string().describe('una frase sul cambiamento principale'),
  trends: z.array(z.string()).describe('2-4 osservazioni sui numeri, con i valori'),
  keep: z.array(z.string()).describe('cosa sta funzionando'),
  next_focus: z.string().describe('su cosa concentrarsi nelle prossime due settimane'),
});

module.exports = { PathPlan, DailyContent, Evaluation, Insight, STRUCTURE_IDS, STEP_KINDS };
