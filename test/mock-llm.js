// A tiny OpenAI-compatible server for tests: answers /v1/chat/completions with valid JSON for each of the app's
// schemas (recognised from the schema embedded in the system prompt). Usage: node test/mock-llm.js <port>
'use strict';
const http = require('http');

function pathPlan(weeks) {
  return {
    title: 'Parlare chiaro in riunione', summary: 'Un percorso per arrivare in riunione con un punto chiaro.',
    goals: ['Intervenire nei primi 10 minuti', 'Meno di 3 intercalari al minuto'],
    routine: [
      { id: 'respiro', kind: 'breath', title: 'Respiro 4-2-6', minutes: 3, instructions: 'Mano sulla pancia, inspira 4, trattieni 2, espira 6.' },
      { id: 'riscaldamento', kind: 'warmup', title: 'Riscaldamento', minutes: 3, instructions: 'Labbra, lingua, vocali esagerate.' },
      { id: 'scioglilingua', kind: 'twister', title: 'Scioglilingua', minutes: 3, instructions: 'Lento e perfetto, poi più veloce.' },
      { id: 'lettura', kind: 'reading', title: 'Lettura ad alta voce', minutes: 4, instructions: 'Primo minuto con la penna tra i denti.' },
      { id: 'struttura', kind: 'structure', title: 'Risposta PREP', minutes: 2, instructions: 'Rispondi in 45 secondi.' },
    ],
    weeks: Array.from({ length: weeks }, (_, i) => ({
      week: i + 1, focus: i === 0 ? 'Punto zero e respiro' : `Focus ${i + 1}`, objective: 'Obiettivo della settimana', why: 'Perché serve',
      extra_exercise: 'Esercizio extra', real_challenge: 'Parla per primo allo stand-up', recording_prompt: 'Racconta il tuo ultimo progetto in 2 minuti',
      tip: 'Pensa solo alle pause', structures: ['PREP'],
    })),
    habits: ['Respiro prima delle riunioni', 'BLUF negli aggiornamenti', 'Una pausa al posto di "eh"'],
  };
}
const daily = {
  focus_tip: 'Oggi pensa solo a chiudere le frasi con la voce verso il basso.',
  tongue_twisters: ['Trentatré trentini entrarono a Trento', 'Sopra la panca la capra campa', 'Apelle figlio di Apollo'],
  reading: { title: 'Il backup', text: 'Ogni sistema / prima o poi si rompe. / Per questo facciamo i backup.' },
  improv_words: ['montagna', 'backup', 'caffè'],
  structure_drill: { structure: 'PREP', question: 'Meglio lavorare da casa o in ufficio?', hint: 'Parti dal punto.' },
  extra: 'Leggi un paragrafo segnando le pause.',
};
const evaluation = {
  summary: 'Messaggio chiaro, chiusura debole.', scores: { clarity: 4, structure: 3, closing: 7 }, structure_used: 'PREP',
  strengths: ['Apertura diretta'], improvements: ['Chiudi con una frase netta'], one_correction: 'Alla prossima registrazione lavora solo sulla chiusura: quando arrivi all\'ultima frase rallenta, abbassa il tono della voce sull\'ultima parola e poi fermati davvero, contando mentalmente fino a due prima di dire qualsiasi altra cosa. Niente "ecco", niente "niente", niente "grazie" buttato lì: la pausa finale fa capire a chi ascolta che il messaggio è completo e lascia il tempo di ricordarlo. FINE-CORREZIONE', better_opening: 'La migrazione slitta a giovedì.',
};
const insight = { headline: 'Gli intercalari sono scesi.', trends: ['Da 5 a 2 al minuto'], keep: ['Le pause'], next_focus: 'La chiusura.' };

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    const sys = (j.messages || []).map((m) => m.content).join('\n');
    let out;
    if (sys.includes('"routine"')) out = pathPlan(Number((sys.match(/Esattamente (\d+) settimane/) || [])[1] || 8));
    else if (sys.includes('"tongue_twisters"')) out = daily;
    else if (sys.includes('"one_correction"')) out = evaluation;
    else if (sys.includes('"headline"')) out = insight;
    else out = {};
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Ecco:\n' + JSON.stringify(out) } }] }));
    }, 300);
  });
}).listen(Number(process.argv[2] || 4011), '127.0.0.1', () => console.log('mock llm ready'));
