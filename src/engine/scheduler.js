// Motore di pianificazione. Decide cosa fare, quanto, in che ordine. Funziona senza AI.
import { DAY, clamp, uid, dayKey, daysBetween, startOfDay, avg } from '../core/util.js';
import { TOPICS, GOALS, lessonForTopic, topicById, OPEN_QUESTIONS } from '../content/seed.js';
import { getStat, mastery, retention, questionById } from './learning.js';
import { pickQuestions } from './quiz.js';

const REVIEW_COST = 0.75, MC_COST = 1, OPEN_COST = 4;

export function availabilityFor(state, date = Date.now()) {
  const a = state.user?.availability || [0, 30, 30, 30, 30, 30, 0];
  return a[new Date(date).getDay()] || 0;
}

export function daysToExam(state, now = Date.now()) {
  const dates = [];
  if (state.user?.targetDate) dates.push(new Date(state.user.targetDate).getTime());
  for (const p of state.procedures || []) for (const d of p.deadlines || []) if (d.date && p.active !== false) dates.push(new Date(d.date).getTime());
  const future = dates.filter(d => d >= startOfDay(now)).sort((a, b) => a - b);
  return future.length ? daysBetween(now, future[0]) : null;
}

export function goalWeights(state) {
  const g = GOALS.find(x => x.id === (state.user?.goal || 'lavoro')) || GOALS[0];
  // La CIAD è requisito d'accesso: se manca, la materia EIPASS pesa comunque molto; se c'è già, quasi niente.
  const has = state.user?.hasCIAD;
  return { ...g.weights, eip: has === 'si' ? 0.15 : Math.max(g.weights.eip ?? 1, 1.6) };
}

// Priorità = importanza × debolezza × errori × memoria × urgenza × prerequisiti × varietà
export function topicPriority(state, topic, { now = Date.now(), masteryOf = null, studiedToday = new Set() } = {}) {
  const st = getStat(state, topic.id);
  const m = masteryOf ? masteryOf(topic.id) : mastery(st, now);
  const w = goalWeights(state)[topic.subject] ?? 1;
  const importance = (topic.importance / 3) * w;
  const weakness = 0.15 + 0.85 * (1 - m);
  const errors = 1 + 0.25 * Math.min(st.errorsOpen, 4);
  const memory = st.lastReview ? 0.3 + 0.7 * (1 - retention(st, now)) : 1;
  const dte = daysToExam(state, now);
  const urgency = dte == null ? 1 : 1 + 1.5 / (1 + dte / 21);
  const prereqOk = topic.prereq.every(p => mastery(getStat(state, p), now) >= 0.3 || (masteryOf && masteryOf(p) >= 0.3));
  const prereq = prereqOk ? 1 : 0.3;
  const variety = studiedToday.has(topic.id) ? 0.5 : 1;
  const score = importance * weakness * errors * memory * urgency * prereq * variety;
  return { score, parts: { importance, weakness, errors, memory, urgency, prereq, variety, mastery: m } };
}

export function rankTopics(state, opts = {}) {
  return TOPICS.map(t => ({ topic: t, ...topicPriority(state, t, opts) })).sort((a, b) => b.score - a.score);
}

export function explainPriority(p) {
  const r = [];
  if (p.parts.importance >= 0.9) r.push('è importante per il tuo obiettivo');
  if (p.parts.mastery < 0.3) r.push('non lo conosci ancora bene');
  if (p.parts.errors > 1) r.push('hai errori aperti');
  if (p.parts.memory > 0.6 && p.parts.mastery > 0) r.push('lo stai dimenticando');
  if (p.parts.urgency > 1.3) r.push('la scadenza si avvicina');
  if (p.parts.prereq < 1) r.push('(prima andrebbe rinforzato un argomento di base)');
  return r.length ? r.join(', ') : 'è il prossimo passo del programma';
}

function startedTopic(state, topicId) {
  const l = lessonForTopic(topicId), st = state.topicStats[topicId];
  return (l && state.lessonsRead[l.id]) || (st && st.n > 0) ? 1 : 0;
}

function studiedTodaySet(state, now) {
  const k = dayKey(now);
  return new Set(state.attempts.filter(a => dayKey(a.at) === k).map(a => a.topic));
}

export function recoveryInfo(state, now = Date.now()) {
  if (!state.sessions.length) return null;
  const last = Math.max(...state.sessions.map(s => s.endedAt || s.startedAt));
  let missed = 0;
  for (let d = startOfDay(last) + DAY; d < startOfDay(now); d += DAY) if (availabilityFor(state, d) > 0) missed++;
  if (missed < 2) return null;
  return { missed, minutes: Math.min(availabilityFor(state, now) || 20, 20), capReviews: 12,
    message: `Bentornata. Hai saltato ${missed} giorni di studio: succede. Oggi una sessione corta per riprendere il ritmo; i ripassi arretrati li distribuisco nei prossimi giorni.` };
}

// mode: auto | lazy | test | errors
export function buildSession(state, minutes, { mode = 'auto', now = Date.now(), rnd = Math.random } = {}) {
  const plan = { id: uid('s'), mode, minutes, createdAt: now, blocks: [], focusTopic: null, why: [] };
  const used = new Set();
  const take = qs => qs.filter(q => q && !used.has(q.id)).map(q => (used.add(q.id), q.id));

  if (mode === 'lazy') {
    plan.minutes = 5;
    const ids = take([...pickQuestions(state, { mode: 'due', n: 5, now }), ...pickQuestions(state, { mode: 'errors', n: 5, now })]).slice(0, 5);
    const fill = take(pickQuestions(state, { mode: 'adaptive', n: 10, now, rnd }).filter(q => q.difficulty === 1)).slice(0, 5 - ids.length);
    plan.blocks.push({ kind: 'review', qids: [...ids, ...fill] });
    plan.why.push('Solo 5 domande facili. L\'importante è non interrompere la catena.');
    return plan;
  }
  if (mode === 'errors') {
    const ids = take(pickQuestions(state, { mode: 'errors', n: Math.max(5, minutes), now }));
    plan.blocks.push({ kind: 'review', qids: ids });
    plan.why.push(ids.length ? `Rivediamo ${ids.length} domande che avevi sbagliato.` : 'Non hai errori aperti: ottimo.');
    return plan;
  }
  if (mode === 'test') {
    const ids = take(pickQuestions(state, { mode: 'adaptive', n: Math.max(5, Math.floor(minutes / MC_COST)), now, rnd }));
    plan.blocks.push({ kind: 'quiz', topic: null, qids: ids });
    plan.why.push('Test misto, scelto in base al tuo livello.');
    return plan;
  }

  // AUTO ("Fai tu")
  const rec = recoveryInfo(state, now);
  if (rec) { minutes = Math.min(minutes, rec.minutes); plan.minutes = minutes; plan.why.push(rec.message); }
  const reviewShare = minutes <= 10 ? 0.5 : minutes <= 30 ? 0.3 : 0.25;
  let reviewN = Math.floor((minutes * reviewShare) / REVIEW_COST);
  if (rec) reviewN = Math.min(reviewN, rec.capReviews);
  const reviewIds = take([...pickQuestions(state, { mode: 'due', n: reviewN, now }), ...pickQuestions(state, { mode: 'errors', n: reviewN, now })]).slice(0, reviewN);
  let remaining = minutes - reviewIds.length * REVIEW_COST;
  if (reviewIds.length) { plan.blocks.push({ kind: 'review', qids: reviewIds }); plan.why.push(`Ripasso: ${reviewIds.length} domande che rischi di dimenticare o avevi sbagliato.`); }

  const ranked = rankTopics(state, { now, studiedToday: studiedTodaySet(state, now) });
  let focus = ranked[0];
  let lesson = lessonForTopic(focus.topic.id);
  let addLesson = lesson && !state.lessonsRead[lesson.id];
  if (addLesson && remaining < lesson.minutes + 3) {
    const alt = ranked.find(r => { const l = lessonForTopic(r.topic.id); return !l || state.lessonsRead[l.id]; });
    if (alt) { focus = alt; lesson = lessonForTopic(alt.topic.id); addLesson = false; }
  }
  plan.focusTopic = focus.topic.id;
  plan.why.push(`Argomento: ${focus.topic.name}, perché ${explainPriority(focus)}.`);
  if (addLesson) { plan.blocks.push({ kind: 'lesson', lessonId: lesson.id, topic: focus.topic.id }); remaining -= lesson.minutes; }

  const st = getStat(state, focus.topic.id);
  const open = OPEN_QUESTIONS.find(o => o.topic === focus.topic.id && !state.attempts.some(a => a.qid === o.id && a.at > now - 7 * DAY));
  const wantOpen = open && remaining >= 15 && (st.theory >= 0.3 || addLesson);
  if (wantOpen) remaining -= OPEN_COST;

  const quizN = Math.max(3, Math.floor(remaining / MC_COST));
  const main = take(pickQuestions(state, { mode: 'topic', topicIds: [focus.topic.id], n: quizN, now, rnd }));
  if (main.length) plan.blocks.push({ kind: 'quiz', topic: focus.topic.id, qids: main });
  let missing = quizN - main.length;
  const others = ranked.filter(r => r.topic.id !== focus.topic.id)
    .sort((a, b) => (startedTopic(state, b.topic.id) - startedTopic(state, a.topic.id)) || (b.score - a.score));
  for (const r of others) {
    if (missing <= 0 || plan.blocks.filter(b => b.kind === 'quiz').length >= 4) break;
    const extra = take(pickQuestions(state, { mode: 'topic', topicIds: [r.topic.id], n: Math.min(missing, 6), now, rnd }));
    if (!extra.length) continue;
    plan.blocks.push({ kind: 'quiz', topic: r.topic.id, qids: extra });
    plan.why.push(startedTopic(state, r.topic.id) ? `Poi qualche domanda su ${r.topic.name}.` : `Poi un assaggio di ${r.topic.name}, per capire da dove partire.`);
    missing -= extra.length;
  }
  if (wantOpen) plan.blocks.push({ kind: 'open', qid: open.id, topic: focus.topic.id });
  return plan;
}

export function planStats(state, plan) {
  let mc = 0, review = 0, lessons = 0, open = 0;
  const reviewTopics = {};
  for (const b of plan.blocks) {
    if (b.kind === 'review') { review += b.qids.length; mc += b.qids.length; for (const id of b.qids) { const q = questionById(state, id); if (q) reviewTopics[q.topic] = (reviewTopics[q.topic] || 0) + 1; } }
    if (b.kind === 'quiz') mc += b.qids.length;
    if (b.kind === 'lesson') lessons++;
    if (b.kind === 'open') open++;
  }
  const topReview = Object.entries(reviewTopics).sort((a, b) => b[1] - a[1])[0];
  return { mc, review, lessons, open, reviewTopic: topReview ? topReview[0] : null };
}

export function tomorrowLine(state, now = Date.now()) {
  const t = startOfDay(now) + DAY + 9 * 3600000;
  const mins = availabilityFor(state, t);
  if (!mins) return 'DOMANI: riposo – nessuna attività prevista';
  const plan = buildSession(state, mins, { now: t, rnd: () => 0.5 });
  const s = planStats(state, plan);
  const topic = plan.focusTopic ? topicById(plan.focusTopic).name : 'misto';
  const rev = s.reviewTopic ? topicById(s.reviewTopic).name : 'nessun ripasso in scadenza';
  return `DOMANI: ${plan.minutes} minuti – ${topic} – ripasso: ${rev} – ${s.mc} quiz`;
}

// Calendario proiettato: simula la rotazione degli argomenti nei prossimi giorni.
export function projectCalendar(state, days = 14, now = Date.now()) {
  const proj = {};
  for (const t of TOPICS) proj[t.id] = mastery(getStat(state, t.id), now);
  const out = [], recent = [];
  for (let i = 0; i < days; i++) {
    const d = startOfDay(now) + i * DAY + 9 * 3600000;
    const mins = availabilityFor(state, d);
    if (!mins) { out.push({ date: d, minutes: 0, topic: null }); continue; }
    const ranked = rankTopics(state, { now: d, masteryOf: id => proj[id] })
      .map(r => ({ ...r, score: r.score * (recent[0] === r.topic.id ? 0.35 : recent[1] === r.topic.id ? 0.6 : 1) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked[0].topic;
    recent.unshift(top.id);
    out.push({ date: d, minutes: mins, topic: top.id, alsoReview: i > 0 });
    proj[top.id] = clamp(proj[top.id] + 0.12 * Math.min(2, mins / 30));
  }
  return out;
}

export function weeklyMinutes(state) { return (state.user?.availability || []).reduce((a, b) => a + b, 0); }

export function studiedMinutesOn(state, now = Date.now()) {
  const k = dayKey(now);
  return state.sessions.filter(s => dayKey(s.startedAt) === k).reduce((a, s) => a + (s.report?.minutes || 0), 0);
}

export function suggestedMinutesToday(state, now = Date.now()) {
  const rec = recoveryInfo(state, now);
  const base = availabilityFor(state, now) || 15;
  return rec ? rec.minutes : base;
}
