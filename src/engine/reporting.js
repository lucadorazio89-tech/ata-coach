// Report automatici. Tutto calcolato localmente, zero AI.
import { DAY, avg, dayKey, startOfDay, fmtMinutes, fmtDate } from '../core/util.js';
import { TOPICS, SUBJECTS, topicById, subjectById, sourceById } from '../content/seed.js';
import { mastery, getStat, falsePreparation, overallMastery, coverage, readinessLabel, ERROR_TYPES } from './learning.js';
import { tomorrowLine } from './scheduler.js';

export function sessionReport(state, session, before, now = Date.now()) {
  const atts = state.attempts.filter(a => a.session === session.id);
  const mc = atts.filter(a => a.level !== 'spiegazione');
  const correct = mc.filter(a => a.correct).length;
  const errs = state.errors.filter(e => atts.some(a => a.errorId === e.id));
  const topics = [...new Set(atts.map(a => a.topic).concat(session.lessons || []).map(x => x.topic || x))].filter(Boolean);
  const improvements = [], critical = [];
  for (const t of topics) {
    const m = mastery(getStat(state, t), now), b = before?.[t] ?? 0;
    if (m - b >= 0.03) improvements.push(`${topicById(t).name}: da ${Math.round(b * 100)}% a ${Math.round(m * 100)}%`);
    const tAtts = mc.filter(a => a.topic === t);
    if (tAtts.length >= 3 && tAtts.filter(a => a.correct).length / tAtts.length < 0.5) critical.push(`${topicById(t).name}: meno della metà giuste`);
    const fp = falsePreparation(getStat(state, t)); if (fp) critical.push(`${topicById(t).name}: ${fp}`);
  }
  const errorTypes = {};
  for (const e of errs) errorTypes[e.type] = (errorTypes[e.type] || 0) + 1;
  const toReview = [...new Set(errs.map(e => topicById(e.topic).name))];
  const minutes = Math.max(1, Math.round(((session.endedAt || now) - session.startedAt) / 60000));
  return {
    minutes, activities: (session.lessons || []).length + (mc.length ? 1 : 0) + atts.filter(a => a.level === 'spiegazione').length,
    lessons: (session.lessons || []).length, quizTotal: mc.length, quizCorrect: correct, score: mc.length ? Math.round((correct / mc.length) * 100) : null,
    errors: errs.length, errorTypes, improvements, critical, toReview, tomorrow: tomorrowLine(state, now)
  };
}

export function periodReport(state, days = 7, now = Date.now()) {
  const from = startOfDay(now) - (days - 1) * DAY;
  const sessions = state.sessions.filter(s => s.startedAt >= from);
  const atts = state.attempts.filter(a => a.at >= from && a.level !== 'spiegazione');
  const errs = state.errors.filter(e => e.at >= from);
  const perDay = [];
  for (let i = 0; i < days; i++) {
    const d = from + i * DAY, k = dayKey(d);
    perDay.push({ date: d, minutes: sessions.filter(s => dayKey(s.startedAt) === k).reduce((a, s) => a + (s.report?.minutes || 0), 0) });
  }
  const bySubject = SUBJECTS.map(s => {
    const ids = TOPICS.filter(t => t.subject === s.id).map(t => t.id);
    const sa = atts.filter(a => ids.includes(a.topic));
    return { id: s.id, name: s.name, quiz: sa.length, accuracy: sa.length ? sa.filter(a => a.correct).length / sa.length : null, mastery: avg(ids.map(id => mastery(state.topicStats[id], now))) };
  });
  const recurring = {};
  for (const e of errs) { const k = e.userType || e.type; recurring[k] = (recurring[k] || 0) + 1; }
  const recurringTopics = {};
  for (const e of errs) recurringTopics[e.topic] = (recurringTopics[e.topic] || 0) + 1;
  const om = overallMastery(state, undefined, now);
  return {
    days, minutes: perDay.reduce((a, d) => a + d.minutes, 0), perDay, sessions: sessions.length,
    quiz: atts.length, accuracy: atts.length ? atts.filter(a => a.correct).length / atts.length : null,
    bySubject, recurringErrors: Object.entries(recurring).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: ERROR_TYPES[k] || k, n })),
    recurringTopics: Object.entries(recurringTopics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => ({ name: topicById(t)?.name || t, n })),
    coverage: coverage(state), mastery: om, status: readinessLabel(om), forecast: forecast(state, 0.75, now)
  };
}

// Previsione: regressione lineare sulla padronanza giornaliera.
export function forecast(state, target = 0.75, now = Date.now()) {
  const pts = Object.entries(state.history).map(([k, v]) => [new Date(k + 'T12:00:00').getTime(), v.mastery]).sort((a, b) => a[0] - b[0]).slice(-30);
  if (pts.length < 4) return { ready: false, text: 'Servono almeno 4 giorni di studio per una previsione affidabile.' };
  const xs = pts.map(p => (p[0] - pts[0][0]) / DAY), ys = pts.map(p => p[1]);
  const mx = avg(xs), my = avg(ys);
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
  const cur = ys[ys.length - 1];
  if (cur >= target) return { ready: true, slope, text: 'Hai già raggiunto il livello obiettivo. Ora si mantiene con i ripassi.' };
  if (slope <= 0.0005) return { ready: true, slope, text: 'Con il ritmo attuale la preparazione non sta salendo. Basta poco per ripartire: 15 minuti al giorno.' };
  const days = Math.ceil((target - cur) / slope);
  return { ready: true, slope, days, date: now + days * DAY, text: `Con questo ritmo raggiungi il ${Math.round(target * 100)}% verso il ${fmtDate(now + days * DAY)} (circa ${days} giorni). Stima indicativa.` };
}

export function procedureReport(state, proc, now = Date.now()) {
  const topicIds = TOPICS.filter(t => proc.subjects.includes(t.subject)).map(t => t.id);
  const general = overallMastery(state, undefined, now);
  const specific = overallMastery(state, topicIds, now);
  const reqs = proc.requirements.map(r => ({ ...r, done: !!(proc.checked || {})[r.id], sourceTitle: r.source ? sourceById(r.source)?.title : null }));
  const missing = reqs.filter(r => !r.done).map(r => r.text);
  const weak = TOPICS.filter(t => topicIds.includes(t.id) && mastery(state.topicStats[t.id], now) < 0.5).map(t => t.name);
  const sims = state.sessions.filter(s => s.mode === 'simulation' && s.procedure === proc.id);
  const best = sims.length ? Math.max(...sims.map(s => s.report?.score || 0)) : null;
  let status;
  if (proc.type === 'titoli') status = missing.length === 0 ? 'pronto' : missing.length === 1 ? 'quasi pronto' : 'non pronto';
  else { const r = reqs.length ? reqs.filter(x => x.done).length / reqs.length : 1; status = specific >= 0.75 && r === 1 ? 'pronto' : specific >= 0.5 && r >= 0.5 ? 'quasi pronto' : 'non pronto'; }
  return { requirements: reqs, deadlines: proc.deadlines, missing, weak, subjects: proc.subjects.map(s => subjectById(s)?.name), general, specific, simulations: sims.length, bestSimulation: best, status };
}

export function shareText(state, now = Date.now()) {
  const r = periodReport(state, 7, now);
  const name = state.user?.name || 'Giorgia';
  return `ATA Coach – settimana di ${name}\nStudio: ${fmtMinutes(r.minutes)} in ${r.sessions} sessioni\nQuiz: ${r.quiz}${r.accuracy != null ? ` (${Math.round(r.accuracy * 100)}% giuste)` : ''}\nPreparazione: ${Math.round(r.mastery * 100)}% – ${r.status}\nProgramma coperto: ${Math.round(r.coverage * 100)}%\n${tomorrowLine(state, now)}`;
}
