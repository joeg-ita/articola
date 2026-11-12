// The method the app is built on ("Programma di Articulation Skills"): the assessment grid, the baseline
// clips, the thinking structures, the meeting phrases and the common errors. It is used in two places:
//  - the prompts, so every generated path and exercise follows the same method;
//  - the Guide page of the frontend (served by GET /api/meta).
'use strict';

// Onboarding choices. Ids are what is stored; labels are what is shown.
const GOALS = [
  { id: 'meetings', label: 'Intervenire in riunione con sicurezza' },
  { id: 'presentations', label: 'Fare presentazioni efficaci' },
  { id: 'fillers', label: 'Eliminare gli intercalari ("eh", "cioè"…)' },
  { id: 'diction', label: 'Voce più chiara e dizione pulita' },
  { id: 'structure', label: 'Pensare e parlare in modo strutturato' },
  { id: 'technical', label: 'Spiegare temi tecnici a chi non è del mestiere' },
  { id: 'smalltalk', label: 'Chiacchierate, networking e small talk' },
  { id: 'interviews', label: 'Colloqui di lavoro' },
  { id: 'anxiety', label: 'Gestire l\'ansia quando parlo' },
];

const SITUATIONS = [
  { id: 'standup', label: 'Stand-up e riunioni di team' },
  { id: 'clients', label: 'Riunioni con clienti' },
  { id: 'calls', label: 'Call e videoconferenze' },
  { id: 'talks', label: 'Presentazioni e demo' },
  { id: 'events', label: 'Eventi e networking' },
  { id: 'interviews', label: 'Colloqui' },
  { id: 'teaching', label: 'Formazione e lezioni' },
  { id: 'social', label: 'Conversazioni informali' },
];

// Self-assessment areas asked in onboarding (1-5).
const AREAS = [
  { id: 'voice', label: 'Voce e dizione' },
  { id: 'structure', label: 'Struttura del discorso' },
  { id: 'confidence', label: 'Sicurezza e presenza' },
  { id: 'fluency', label: 'Fluidità (pochi intercalari, buone pause)' },
];

// The 1-5 assessment grid used on every recording.
// `source` says who can judge it: the AI reads only the transcript and the measured metrics, so tone and diction
// (which need the sound itself) are self-assessed; pace, fillers and pauses are measured.
const CRITERIA = [
  { id: 'clarity', label: 'Chiarezza', look: 'Si capisce il messaggio principale al primo ascolto?', source: 'ai' },
  { id: 'structure', label: 'Struttura', look: 'C\'è un inizio, uno sviluppo, una chiusura?', source: 'ai' },
  { id: 'pace', label: 'Velocità', look: 'Obiettivo circa 130–160 parole al minuto', source: 'measured' },
  { id: 'fillers', label: 'Intercalari', look: 'Conta "eh", "cioè", "praticamente", "tipo", "diciamo"', source: 'measured' },
  { id: 'pauses', label: 'Pause', look: 'Usi pause intenzionali o riempi ogni silenzio?', source: 'measured' },
  { id: 'tone', label: 'Tono', look: 'La voce varia o resta piatta? Cala a fine frase?', source: 'self' },
  { id: 'diction', label: 'Dizione', look: 'Le parole finiscono pulite o si "mangiano" le sillabe?', source: 'self' },
  { id: 'closing', label: 'Chiusura', look: 'Finisci con una frase netta o sfumi?', source: 'ai' },
];

// The three "point zero" clips, redone at the end of the path.
const BASELINE_CLIPS = [
  { key: 'explain', title: 'Spiegazione', minutes: 2, prompt: 'Spiega un progetto a cui hai lavorato a qualcuno che non è del mestiere.' },
  { key: 'improv', title: 'Improvvisata', minutes: 1, prompt: 'Rispondi senza preparazione: "Qual è la cosa più utile che hai imparato quest\'anno?"' },
  { key: 'pitch', title: 'Mini-presentazione', minutes: 3, prompt: 'Presenta una proposta come se fossi in riunione.' },
];

const STRUCTURES = [
  { id: 'BLUF', name: 'BLUF (Bottom Line Up Front)', when: 'Aggiornamenti, escalation, risposte a un responsabile', scheme: 'Conclusione → motivo → dettagli se richiesti', example: '"La migrazione slitta a giovedì. Il motivo è la replica del DB. Se serve vi mostro i log."' },
  { id: 'PREP', name: 'PREP', when: 'Dare un\'opinione, rispondere a una domanda', scheme: 'Punto → Ragione → Esempio → Punto', example: '"Conviene automatizzare il rinnovo dei certificati. Riduce gli errori manuali: il mese scorso uno scaduto ha bloccato la pipeline. Quindi lo proporrei come priorità."' },
  { id: 'SCQA', name: 'SCQA', when: 'Proposte, presentazioni, richieste di budget', scheme: 'Situazione → Complicazione → Domanda → Risposta', example: '"Oggi i deploy sono manuali. Con più team gli errori crescono. Come li riduciamo? Con una pipeline standard condivisa."' },
  { id: 'WSN', name: 'Cosa / E quindi / E ora', when: 'Incidenti, retrospettive, analisi', scheme: 'Cosa è successo → perché conta → cosa facciamo', example: '"Il nodo è andato giù alle 3. Il servizio è rimasto degradato 40 minuti. Aggiungiamo un alert sulla memoria."' },
  { id: 'THREE', name: 'Regola del tre', when: 'Qualsiasi discorso', scheme: 'Massimo tre punti, annunciati all\'inizio', example: '"Vi parlo di tre cose: costi, tempi, rischi."' },
];

const PHRASES = [
  { situation: 'Prendere la parola', phrase: '"Posso aggiungere un punto su questo?"' },
  { situation: 'Non sei d\'accordo', phrase: '"Capisco il punto. La mia preoccupazione è X, perché Y. Propongo Z."' },
  { situation: 'Ti interrompono', phrase: '"Finisco il ragionamento e poi ti lascio la parola."' },
  { situation: 'Non sai la risposta', phrase: '"Non ho il dato adesso: verifico e vi rispondo entro domani."' },
  { situation: 'Discussione che divaga', phrase: '"Per restare nei tempi, possiamo riprenderlo in un incontro dedicato?"' },
  { situation: 'Chiudere', phrase: '"Ricapitolando: decidiamo X, se ne occupa Y entro Z."' },
  { situation: 'Chiedere chiarezza', phrase: '"Per essere sicuro di aver capito: intendi che...?"' },
];

const ERRORS = [
  { error: 'Partire dal contesto', sign: 'Dopo un minuto chi ascolta non sa ancora dove vuoi arrivare', fix: 'BLUF: la conclusione nella prima frase' },
  { error: 'Velocità eccessiva', sign: 'Oltre 170 parole al minuto, sillabe mangiate', fix: 'Pausa a ogni punto, scioglilingua lenti' },
  { error: 'Intercalari', sign: 'Più di 3 al minuto', fix: 'Sostituisci ogni "eh" con una pausa muta' },
  { error: 'Frasi lunghissime', sign: 'Subordinate a catena, perdi il filo', fix: 'Una idea per frase, poi punto' },
  { error: 'Voce che cala a fine frase', sign: 'Le ultime parole non si sentono', fix: 'Pensa di "lanciare" l\'ultima parola verso il fondo della stanza' },
  { error: 'Tono interrogativo sulle affermazioni', sign: 'La frase sale alla fine come una domanda', fix: 'Chiudi le affermazioni con la voce verso il basso' },
  { error: 'Auto-sminuirsi', sign: '"Forse è una domanda stupida, ma..."', fix: 'Fai la domanda e basta' },
  { error: 'Troppo gergo', sign: 'Sigle e termini tecnici con chi non li conosce', fix: 'Prima l\'effetto ("il sito era lento"), poi la causa tecnica' },
];

// Fillers counted in transcripts, per spoken language. Multi-word ones first so they are not double counted.
const FILLERS = {
  it: ['e niente', 'in pratica', 'come dire', 'diciamo', 'praticamente', 'sostanzialmente', 'cioè', 'tipo', 'insomma', 'ehm', 'eh', 'uhm', 'mmh', 'boh'],
  en: ['you know', 'i mean', 'kind of', 'sort of', 'basically', 'literally', 'um', 'uh', 'er', 'erm', 'hmm', 'uhm', 'ehm', 'eh'],
};

// The method, condensed, as the model sees it. Generated paths and exercises must stay inside it.
const METHOD = `
METODO DI RIFERIMENTO ("Programma di Articulation Skills"):
- Tre capacità: voce chiara, pensiero strutturato, presenza nelle interazioni.
- Pratica quotidiana breve (di norma 15 minuti) nei giorni scelti; ogni settimana aggiunge UN focus senza abbandonare i precedenti.
- Ogni settimana: un esercizio aggiuntivo legato al focus e una SFIDA REALE (applicare il focus in una situazione vera: stand-up, riunione, pausa caffè, call...).
- Ogni settimana una registrazione di circa 2 minuti, riascoltata con la griglia di valutazione.
- Una correzione alla volta: mentre si parla si pensa a una sola cosa (es. le pause).
- Settimana 1: punto zero (tre registrazioni: spiegazione 2 min, improvvisata 1 min, mini-presentazione 3 min) e respiro. Ultima settimana: consolidamento, si rifanno le tre registrazioni e si confrontano con la prima, si scelgono tre abitudini da mantenere.
- Routine quotidiana tipo (15 min): respiro diaframmatico 4-2-6 (3 min); riscaldamento articolatorio: labbra "brrr", lingua, vocali esagerate (3 min); scioglilingua lento poi veloce (3 min); lettura ad alta voce, il primo minuto con una penna tra i denti, segnando le pause (4 min); improvvisazione su una parola a caso per 60 secondi senza intercalari, sostituendo ogni "eh" con una pausa muta (2 min).
- Strutture: BLUF, PREP, SCQA, Cosa/E quindi/E ora, Regola del tre.
- Griglia (1-5): chiarezza, struttura, velocità (130-160 parole/min), intercalari, pause, tono, dizione, chiusura.
- Progressione tipo di 8 settimane: 1 punto zero e respiro; 2 velocità e pause; 3 eliminare gli intercalari; 4 BLUF e PREP; 5 spiegare il tecnico; 6 domande e obiezioni; 7 presentazione; 8 consolidamento. Va ADATTATA agli obiettivi, alle situazioni e alla durata scelti dalla persona.
- Riunioni: arrivare con 1-3 punti in formato BLUF, intervenire nei primi 10 minuti, frasi brevi, chiudere con una pausa.
- Parlare in pubblico: messaggio centrale in una frase, massimo tre punti, a memoria solo apertura e chiusura, provare ad alta voce tre volte; partire lenti, una frase uno sguardo, pause sui passaggi importanti; ansia: respiro 4-2-6, arrivare in anticipo, leggere il battito come energia.
- Conversazioni: domande aperte e di approfondimento, risposte con un aggancio, equilibrio 50/50, ascolto attivo, mini-storie (situazione → problema → come è finita), uscire con garbo.
`.trim();

const ids = (arr) => arr.map((x) => x.id);

module.exports = { GOALS, SITUATIONS, AREAS, CRITERIA, BASELINE_CLIPS, STRUCTURES, PHRASES, ERRORS, FILLERS, METHOD, ids };
