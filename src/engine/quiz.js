// Motore quiz: selezione domande e correzione offline delle risposte aperte.
import { shuffle, normalizeText, clamp } from '../core/util.js';
import { TOPICS } from '../content/seed.js';
import { EIP_MODULES, EIP_MODULE_OF, EIP_LEVELS } from '../content/eipass.js';
import { allQuestions, getStat, mastery } from './learning.js';
import { dueQuestionIds } from './srs.js';

export function mcQuestions(state) { return allQuestions(state).filter(q => q.type === 'mc'); }

// mode: random | topic | subject | errors | due | adaptive
export function pickQuestions(state, { mode = 'adaptive', topicIds = null, subjectId = null, n = 10, exclude = [], rnd = Math.random, now = Date.now() } = {}) {
  let pool = mcQuestions(state).filter(q => !exclude.includes(q.id));
  if (subjectId) { const ids = TOPICS.filter(t => t.subject === subjectId).map(t => t.id); pool = pool.filter(q => ids.includes(q.topic)); }
  if (topicIds) pool = pool.filter(q => topicIds.includes(q.topic));
  if (mode === 'errors') {
    const ids = [...new Set(state.errors.filter(e => !e.resolved).sort((a, b) => b.at - a.at).map(e => e.qid))];
    return ids.map(id => pool.find(q => q.id === id)).filter(Boolean).slice(0, n);
  }
  if (mode === 'due') {
    const ids = dueQuestionIds(state, now);
    return ids.map(id => pool.find(q => q.id === id)).filter(Boolean).slice(0, n);
  }
  if (mode === 'random' || mode === 'subject') return shuffle(pool, rnd).slice(0, n);
  // adaptive / topic: prima mai viste, poi sbagliate, poi le altre; difficoltà vicina al livello
  const seen = new Set(state.attempts.map(a => a.qid));
  const wrongLast = new Set();
  for (const a of state.attempts) { if (a.correct) wrongLast.delete(a.qid); else wrongLast.add(a.qid); }
  const scored = pool.map(q => {
    const m = mastery(getStat(state, q.topic), now);
    const target = 1 + m * 2;                                   // livello 1..3
    let s = 1 - Math.abs(q.difficulty - target) / 3;
    if (!seen.has(q.id)) s += 1; if (wrongLast.has(q.id)) s += 0.8;
    if (q.level === 'applicazione' && m > 0.4) s += 0.3;
    return { q, s: s + rnd() * 0.3 };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map(x => x.q);
}

// Test diagnostico: una domanda per argomento (facile se esiste), così il primo giorno resta breve.
export function diagnosticQuestions(state, rnd = Math.random) {
  const out = [];
  // EIPASS: una sola domanda per modulo (non per argomento), e solo se la CIAD manca; mai esercizi al PC.
  const eipFirst = new Set(EIP_MODULES.map(m => TOPICS.find(t => t.module === m.n)?.id));
  for (const t of TOPICS) {
    if (t.subject === 'eip' && (!eipFirst.has(t.id) || state.user?.hasCIAD === 'si')) continue;
    const qs = mcQuestions(state).filter(q => q.topic === t.id && q.origin === 'content-pack' && !q.pc);
    const pick = shuffle(qs.filter(q => q.difficulty === 1), rnd)[0] || shuffle(qs, rnd)[0];
    if (pick) out.push(pick);
  }
  return out;
}

// Simulazione: distribuzione proporzionale per materia, tempo 1 min/domanda.
export function simulationQuestions(state, n = 30, rnd = Math.random, subjectIds = null) {
  const pool = mcQuestions(state).filter(q => !q.pc && (!subjectIds || subjectIds.includes(TOPICS.find(t => t.id === q.topic)?.subject)));
  return shuffle(pool, rnd).slice(0, Math.min(n, pool.length));
}

// Correzione offline: copertura delle parole chiave. Non è un giudizio definitivo:
// l'utente si autovaluta confrontando con la risposta modello.
export function gradeOpenOffline(q, text) {
  const t = normalizeText(text);
  const words = t.split(' ').filter(Boolean).length;
  const matched = [], missing = [];
  for (const k of q.keywords) {
    const alts = k.split('|').map(normalizeText);
    (alts.some(a => t.includes(a)) ? matched : missing).push(k.split('|')[0]);
  }
  let score = q.keywords.length ? matched.length / q.keywords.length : 0;
  if (words < 8) score *= 0.6;                                 // risposte troppo brevi
  return { score: clamp(score), matched, missing, words };
}

// ---------- Simulazione d'esame EIPASS Standard ----------
// Come l'esame vero: per ogni parte 12 domande Base, 11 Intermedio, 9 Avanzato, 4 Altamente specializzato, in difficoltà crescente.
export const EIP_PART = [0, 12, 11, 9, 4];
export function eipSimulation(state, modules = EIP_MODULES.map(m => m.n), rnd = Math.random) {
  const pool = mcQuestions(state).filter(q => q.eipLevel && !q.pc && q.origin === 'content-pack');
  const steps = [];
  for (const n of modules) for (const lvl of [1, 2, 3, 4]) {
    const qs = shuffle(pool.filter(q => EIP_MODULE_OF[q.topic] === n && q.eipLevel === lvl), rnd).slice(0, EIP_PART[lvl]);
    for (const q of qs) steps.push({ t: 'mc', qid: q.id, block: 'quiz', part: n, lvl });
  }
  return steps;
}
// Livello raggiunto in una parte: un livello è superato con il 50% di risposte giuste;
// per salire al livello successivo serve il 75% in quello precedente (regole Certipass).
export function eipPartLevel(counts) {
  const r = l => counts[l] && counts[l].n ? counts[l].ok / counts[l].n : 0;
  if (r(1) < 0.5) return 0;
  let level = 1;
  for (let l = 2; l <= 4; l++) { if (r(l - 1) >= 0.75 && r(l) >= 0.5) level = l; else break; }
  return level;
}
export function eipSimResult(state, sessionId) {
  const qOf = id => mcQuestions(state).find(q => q.id === id);
  const parts = {};
  for (const a of state.attempts.filter(x => x.session === sessionId)) {
    const q = qOf(a.qid); if (!q || !q.eipLevel) continue;
    const n = EIP_MODULE_OF[q.topic], p = parts[n] || (parts[n] = { n, counts: { 1: { n: 0, ok: 0 }, 2: { n: 0, ok: 0 }, 3: { n: 0, ok: 0 }, 4: { n: 0, ok: 0 } }, wrongTopics: {} });
    p.counts[q.eipLevel].n++; if (a.correct) p.counts[q.eipLevel].ok++; else p.wrongTopics[q.topic] = (p.wrongTopics[q.topic] || 0) + 1;
  }
  const list = Object.values(parts).sort((a, b) => a.n - b.n).map(p => {
    const level = eipPartLevel(p.counts);
    return { ...p, name: EIP_MODULES.find(m => m.n === p.n).name, level, levelName: level ? EIP_LEVELS[level] : null, passed: level > 0,
      weak: Object.entries(p.wrongTopics).sort((a, b) => b[1] - a[1]).map(([t]) => TOPICS.find(x => x.id === t)?.name).filter(Boolean).slice(0, 2) };
  });
  return { parts: list, passed: list.filter(p => p.passed).length, total: list.length };
}
