// v0.5: materia EIPASS Standard (CIAD) e simulazione d'esame con le regole Certipass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EIP_QUESTIONS, EIP_TOPICS, EIP_LESSONS, EIP_MODULES, EIP_MODULE_OF } from '../src/content/eipass.js';
import { eipSimulation, eipPartLevel, eipSimResult, EIP_PART, simulationQuestions, diagnosticQuestions } from '../src/engine/quiz.js';
import { goalWeights } from '../src/engine/scheduler.js';
import { emptyState } from '../src/core/store.js';
import { seededRandom } from '../src/core/util.js';

const fresh = () => { const s = emptyState(); s.user = { name: 'G', goal: 'lavoro', hasCIAD: 'no' }; return s; };

test('banca EIPASS: ogni modulo ha domande sufficienti per ogni livello dell\'esame', () => {
  for (const m of EIP_MODULES) {
    const qs = EIP_QUESTIONS.filter(q => !q.pc && EIP_MODULE_OF[q.topic] === m.n);
    for (const l of [1, 2, 3, 4]) assert.ok(qs.filter(q => q.eipLevel === l).length >= EIP_PART[l], `modulo ${m.n} livello ${l}`);
  }
  assert.ok(EIP_QUESTIONS.length >= 350);
});

test('banca EIPASS: dati puliti (id unici, 4 opzioni diverse, spiegazione, lezione per ogni argomento)', () => {
  const ids = new Set(); for (const q of EIP_QUESTIONS) { assert.ok(!ids.has(q.id), q.id); ids.add(q.id); }
  for (const q of EIP_QUESTIONS) { assert.equal(q.options.length, 4, q.id); assert.equal(new Set(q.options).size, 4, q.id); assert.ok(q.explanation.length > 10, q.id); assert.equal(q.answer, 0); }
  for (const t of EIP_TOPICS) assert.ok(EIP_LESSONS.find(l => l.topic === t.id), t.id);
  for (const q of EIP_QUESTIONS.filter(x => x.pc)) assert.match(q.pc[q.pc.length - 1], /^Domanda:/, q.id);
});

test('simulazione: 36 domande per parte, 12/11/9/4, in difficoltà crescente, senza esercizi al PC', () => {
  const steps = eipSimulation(fresh(), [6], seededRandom(3));
  assert.equal(steps.length, 36);
  assert.deepEqual([1, 2, 3, 4].map(l => steps.filter(x => x.lvl === l).length), [12, 11, 9, 4]);
  assert.deepEqual(steps.map(x => x.lvl), [...steps.map(x => x.lvl)].sort((a, b) => a - b));
  assert.ok(steps.every(x => !EIP_QUESTIONS.find(q => q.id === x.qid).pc));
  assert.equal(eipSimulation(fresh(), undefined, seededRandom(1)).length, 36 * 7);
});

test('livello raggiunto: 50% per superare un livello, 75% per salire al successivo', () => {
  const c = (a, b, c2, d) => ({ 1: { n: 12, ok: a }, 2: { n: 11, ok: b }, 3: { n: 9, ok: c2 }, 4: { n: 4, ok: d } });
  assert.equal(eipPartLevel(c(5, 11, 9, 4)), 0, 'meno di metà Base: non superata');
  assert.equal(eipPartLevel(c(6, 0, 0, 0)), 1, 'metà Base: superata con livello Base');
  assert.equal(eipPartLevel(c(8, 11, 9, 4)), 1, 'Base sotto il 75%: resta Base anche se il resto è perfetto');
  assert.equal(eipPartLevel(c(9, 6, 0, 0)), 2);
  assert.equal(eipPartLevel(c(12, 9, 5, 2)), 3);
  assert.equal(eipPartLevel(c(12, 11, 7, 2)), 4);
});

test('risultato della simulazione calcolato dalle risposte della sessione', () => {
  const s = fresh(); const steps = eipSimulation(s, [2], seededRandom(9));
  steps.forEach((x, i) => s.attempts.push({ id: 'a' + i, qid: x.qid, correct: x.lvl === 1 ? i % 2 === 0 : false, session: 'S', at: i }));
  const r = eipSimResult(s, 'S');
  assert.equal(r.total, 1); assert.equal(r.parts[0].n, 2); assert.equal(r.parts[0].counts[1].ok, 6);
  assert.equal(r.parts[0].passed, true); assert.equal(r.parts[0].levelName, 'Base');
});

test('il piano dà spazio alla CIAD solo se manca', () => {
  const s = fresh(); assert.ok(goalWeights(s).eip >= 1.6);
  s.user.hasCIAD = 'si'; assert.ok(goalWeights(s).eip < 0.2);
});

test('le simulazioni generiche e il test iniziale non contengono esercizi al PC', () => {
  assert.ok(simulationQuestions(fresh(), 400).every(q => !q.pc));
  assert.ok(diagnosticQuestions(fresh()).every(q => !q.pc));
});
