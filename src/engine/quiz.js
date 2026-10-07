// Motore quiz: selezione domande e correzione offline delle risposte aperte.
import { shuffle, normalizeText, clamp } from '../core/util.js';
import { TOPICS } from '../content/seed.js';
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
  for (const t of TOPICS) {
    const qs = mcQuestions(state).filter(q => q.topic === t.id && q.origin === 'content-pack');
    const pick = shuffle(qs.filter(q => q.difficulty === 1), rnd)[0] || shuffle(qs, rnd)[0];
    if (pick) out.push(pick);
  }
  return out;
}

// Simulazione: distribuzione proporzionale per materia, tempo 1 min/domanda.
export function simulationQuestions(state, n = 30, rnd = Math.random, subjectIds = null) {
  const pool = mcQuestions(state).filter(q => !subjectIds || subjectIds.includes(TOPICS.find(t => t.id === q.topic)?.subject));
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
