// Motore didattico: per ogni argomento tiene più dimensioni, non una sola percentuale.
import { DAY, clamp, uid, avg, dayKey } from '../core/util.js';
import { TOPICS, LESSONS, ALL_QUESTIONS, lessonForTopic } from '../content/seed.js';
import { newCard, reviewCard } from './srs.js';

export const ERROR_TYPES = {
  sconosciuto: 'Concetto mai visto',
  confusione: 'Confusione tra concetti simili',
  dimenticanza: 'Dimenticato',
  distrattore: 'Caduta nel tranello',
  lettura: 'Letto male / troppa fretta',
  applicazione: 'Sai la regola ma non la applichi',
  velocita: 'Tempo insufficiente',
  falsa_sicurezza: 'Ero sicura, ma era sbagliata'
};

export function allQuestions(state) { return [...ALL_QUESTIONS, ...(state.customQuestions || [])]; }
export function questionById(state, id) { return allQuestions(state).find(q => q.id === id); }

export function defaultTopicStat() {
  return {
    theory: 0,          // 0-1: lezioni lette, spiegazioni comprese
    practice: 0,        // 0-1: domande di applicazione corrette
    acc: null,          // media mobile accuratezza quiz
    n: 0, correct: 0,
    stability: 1,       // giorni: quanto "regge" la memoria (curva dell'oblio)
    lastReview: null,
    errorsOpen: 0,
    levels: { riconoscimento: { n: 0, c: 0 }, applicazione: { n: 0, c: 0 }, spiegazione: { n: 0, s: 0 } },
    guessedRight: 0,    // risposte giuste dichiarate "non sicura"
    notUnderstood: 0
  };
}

export function getStat(state, topicId) {
  if (!state.topicStats[topicId]) state.topicStats[topicId] = defaultTopicStat();
  return state.topicStats[topicId];
}

// Memoria stimata: R = e^(-t/S)
export function retention(stat, now = Date.now()) {
  if (!stat || !stat.lastReview) return 0;
  const days = Math.max(0, (now - stat.lastReview) / DAY);
  return Math.exp(-days / Math.max(0.5, stat.stability));
}

export function mastery(stat, now = Date.now()) {
  if (!stat || (stat.n === 0 && stat.theory === 0)) return 0;
  const acc = stat.acc ?? 0;
  const confidence = clamp(stat.n / 6);            // con poche risposte la stima pesa meno
  const base = 0.45 * acc * confidence + 0.25 * stat.theory + 0.30 * stat.practice;
  return clamp(base * (0.6 + 0.4 * retention(stat, now)));
}

export function applyLessonStats(state, lessonId, understood, now) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  const topicId = lesson ? lesson.topic : lessonId.replace(/^l_/, 't_');
  const st = getStat(state, topicId);
  st.theory = clamp(st.theory + (understood ? 0.35 : 0.1));
  if (!understood) st.notUnderstood++;
  if (!st.lastReview) st.lastReview = now;
  return st;
}

export function markLessonRead(state, lessonId, understood = true, now = Date.now()) {
  state.lessonsRead[lessonId] = now;
  (state.lessonLog = state.lessonLog || []).push({ id: uid('l'), lessonId, ok: !!understood, at: now });
  return applyLessonStats(state, lessonId, understood, now);
}

export function classifyError(state, q, ctx, now = Date.now()) {
  const st = getStat(state, q.topic);
  const prior = state.attempts.filter(a => a.qid === q.id);
  const lesson = lessonForTopic(q.topic);
  if (ctx.dontKnow) return st.theory === 0 && !(lesson && state.lessonsRead[lesson.id]) ? 'sconosciuto' : 'dimenticanza';
  if (ctx.timedOut) return 'velocita';
  if (ctx.ms != null && ctx.ms < 3500) return 'lettura';
  if (ctx.confident) return 'falsa_sicurezza';
  if (prior.some(a => a.correct)) return 'dimenticanza';
  if (q.trap != null && ctx.chosen === q.trap) return 'distrattore';
  if (q.level === 'applicazione' && st.levels.riconoscimento.n >= 2 && st.levels.riconoscimento.c / st.levels.riconoscimento.n >= 0.6) return 'applicazione';
  if (st.theory === 0 && st.n < 2) return 'sconosciuto';
  return 'confusione';
}

// ctx: { chosen, ms, confident, unsure, dontKnow, timedOut, sessionId }
// Parte "pura" di una risposta: aggiorna statistiche e ripasso. Usata dal vivo e per ricostruire i progressi dopo una sincronizzazione.
export function applyAttemptStats(state, q, { correct, unsure = false, diagnostic = false, at }) {
  const now = at, ctx = { unsure, diagnostic };
  const st = getStat(state, q.topic);
  st.n++; if (correct) st.correct++;
  const v = correct ? (ctx.unsure ? 0.6 : 1) : 0;
  st.acc = st.acc == null ? v : st.acc * 0.7 + v * 0.3;
  const lv = st.levels[q.level] || st.levels.riconoscimento;
  lv.n++; if (correct) lv.c++;
  if (correct && q.level === 'applicazione') st.practice = clamp(st.practice + 0.15);
  if (correct && q.level === 'riconoscimento') st.theory = clamp(st.theory + 0.04);
  if (correct && ctx.unsure) st.guessedRight++;
  // memoria: risposte giuste dopo un intervallo rafforzano di più
  const gap = st.lastReview ? (now - st.lastReview) / DAY : 0;
  st.stability = correct ? Math.min(180, st.stability * (1.3 + Math.min(1, gap / st.stability) * 0.5)) : Math.max(0.5, st.stability * 0.6);
  st.lastReview = now;

  const grade = correct ? (ctx.unsure ? 1 : 2) : 0;
  // Nel test iniziale una risposta sbagliata è una lacuna da studiare, non un errore da ripassare domani.
  if (!(ctx.diagnostic && !correct)) state.cards[q.id] = reviewCard(state.cards[q.id] || newCard(now), grade, now);
  return st;
}

export function recordAttempt(state, q, ctx, now = Date.now()) {
  const correct = !ctx.dontKnow && !ctx.timedOut && ctx.chosen === q.answer;
  const st = applyAttemptStats(state, q, { correct, unsure: !!ctx.unsure, diagnostic: !!ctx.diagnostic, at: now });
  const attempt = { id: uid('a'), qid: q.id, topic: q.topic, level: q.level, correct, chosen: ctx.chosen ?? null, ms: ctx.ms ?? null, unsure: !!ctx.unsure, at: now, session: ctx.sessionId || null };
  if (ctx.diagnostic) attempt.diag = true;
  state.attempts.push(attempt);

  let error = null;
  if (!correct && !ctx.diagnostic) {
    error = { id: uid('e'), qid: q.id, topic: q.topic, type: classifyError(state, q, ctx, now), at: now, resolved: false, userType: null };
    state.errors.push(error);
    st.errorsOpen++;
    attempt.errorId = error.id;
  } else if (correct && state.cards[q.id].streak >= 2) {
    for (const e of state.errors) if (e.qid === q.id && !e.resolved) { e.resolved = true; e.resolvedAt = now; st.errorsOpen = Math.max(0, st.errorsOpen - 1); }
  }
  return { correct, attempt, error };
}

export function applyOpenStats(state, q, score, now) {
  const st = getStat(state, q.topic);
  st.levels.spiegazione.n++; st.levels.spiegazione.s += score;
  st.theory = clamp(st.theory + 0.15 * score);
  st.practice = clamp(st.practice + 0.1 * score);
  st.lastReview = now;
  return st;
}

export function recordOpenAnswer(state, q, score, sessionId, now = Date.now()) {
  applyOpenStats(state, q, score, now);
  state.attempts.push({ id: uid('a'), qid: q.id, topic: q.topic, level: 'spiegazione', correct: score >= 0.6, score, at: now, session: sessionId || null });
}

// Falsa preparazione: riconosci la risposta ma non sai spiegarla/applicarla, o indovini spesso.
export function falsePreparation(stat) {
  if (!stat) return null;
  const r = stat.levels.riconoscimento, a = stat.levels.applicazione, s = stat.levels.spiegazione;
  const rAcc = r.n ? r.c / r.n : null;
  const aAcc = a.n ? a.c / a.n : null;
  const sAvg = s.n ? s.s / s.n : null;
  if (rAcc != null && r.n >= 3 && rAcc >= 0.75) {
    if (aAcc != null && a.n >= 2 && aAcc < 0.5) return 'Riconosci le risposte, ma sbagli quando devi applicarle a un caso pratico.';
    if (sAvg != null && sAvg < 0.5) return 'Riconosci le risposte, ma fatichi a spiegarle con parole tue.';
  }
  if (stat.correct >= 4 && stat.guessedRight / stat.correct > 0.4) return 'Molte risposte giuste erano tirate a indovinare: il punteggio sembra migliore della preparazione reale.';
  return null;
}

export function topicSnapshot(state, topicId, now = Date.now()) {
  const st = state.topicStats[topicId] || defaultTopicStat();
  return { mastery: mastery(st, now), retention: retention(st, now), theory: st.theory, practice: st.practice, acc: st.acc, n: st.n, errorsOpen: st.errorsOpen, falsePrep: falsePreparation(st), daysSince: st.lastReview ? Math.floor((now - st.lastReview) / DAY) : null };
}

export function overallMastery(state, topicIds = TOPICS.map(t => t.id), now = Date.now()) {
  return avg(topicIds.map(id => mastery(state.topicStats[id], now)));
}
export function coverage(state, topicIds = TOPICS.map(t => t.id)) {
  return avg(topicIds.map(id => { const st = state.topicStats[id]; return st && (st.theory >= 0.3 || st.n >= 3) ? 1 : 0; }));
}
export function readinessLabel(m) { return m >= 0.75 ? 'pronta' : m >= 0.5 ? 'quasi pronta' : 'non ancora pronta'; }

export function recordHistory(state, now = Date.now()) {
  state.history[dayKey(now)] = { mastery: overallMastery(state, undefined, now), coverage: coverage(state) };
}

// Ricostruisce statistiche e ripassi rigiocando lezioni e risposte in ordine di tempo.
// Così, dopo aver unito i dati di due dispositivi, i progressi sono coerenti con tutto ciò che è stato fatto.
export function rebuildDerived(state) {
  state.topicStats = {}; state.cards = {};
  const events = [
    ...(state.lessonLog || []).map(e => ({ at: e.at, k: 0, e })),
    ...state.attempts.map(a => ({ at: a.at, k: 1, a }))
  ].sort((x, y) => x.at - y.at || x.k - y.k);
  for (const ev of events) {
    if (ev.e) { applyLessonStats(state, ev.e.lessonId, ev.e.ok, ev.at); continue; }
    const a = ev.a, q = questionById(state, a.qid);
    if (!q) continue;
    if (a.level === 'spiegazione') applyOpenStats(state, q, a.score ?? (a.correct ? 1 : 0), a.at);
    else applyAttemptStats(state, q, { correct: a.correct, unsure: !!a.unsure, diagnostic: !!a.diag, at: a.at });
  }
  for (const e of state.errors) if (!e.resolved) getStat(state, e.topic).errorsOpen++;
  return state;
}
