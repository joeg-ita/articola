'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { countFillers } = require('../server/metrics');

const found = (text, lang) => {
  const r = countFillers(text, lang);
  return { total: r.total, byWord: r.byWord, marked: r.spans.map(([s, e]) => text.slice(s, e)) };
};

test('italian fillers, with "tipo di" and "un tipo" excluded', () => {
  const r = found('Eh, cioè, praticamente il progetto, tipo, è andato bene. Che tipo di persona? Diciamo un tipo strano. Ummm.', 'it');
  assert.deepStrictEqual(r.marked, ['Eh', 'cioè', 'praticamente', 'tipo', 'Diciamo', 'Ummm']);
});

test('english fillers are counted', () => {
  const r = found('Um, so it was like, really good, you know, basically. Ummm I mean, the project was kind of late, uh, and stuff.', 'en');
  assert.deepStrictEqual(r.byWord, { um: 2, like: 1, 'you know': 1, basically: 1, 'i mean': 1, 'kind of': 1, uh: 1, 'and stuff': 1 });
  assert.deepStrictEqual(r.marked, ['Um', 'like', 'you know', 'basically', 'Ummm', 'I mean', 'kind of', 'uh', 'and stuff']);
});

test('english words used with their real meaning are not counted', () => {
  const r = found('Do you know what kind of person she is? It looks like rain. I would like a coffee. I like this. I mean it. You know that. It is actually fine.', 'en');
  assert.strictEqual(r.total, 0, JSON.stringify(r.byWord));
});

test('english fillers are not counted in italian and vice versa', () => {
  assert.strictEqual(countFillers('It was like basically done', 'it').total, 0);
  assert.strictEqual(countFillers('cioè praticamente diciamo', 'en').total, 0);
});
