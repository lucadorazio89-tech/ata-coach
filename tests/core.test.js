import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, seededRandom } from '../src/core/util.js';
import { Store, MemoryAdapter, emptyState, migrate } from '../src/core/store.js';
import { QUESTIONS, OPEN_QUESTIONS, TOPICS, LESSONS, SOURCES, SUBJECTS, PROCEDURE_TEMPLATES } from '../src/content/seed.js';
import { newCard, reviewCard, dueQuestionIds } from '../src/engine/srs.js';
import { recordAttempt, mastery, getStat, retention, falsePreparation, markLessonRead, classifyError, recordOpenAnswer } from '../src/engine/learning.js';
import { pickQuestions, diagnosticQuestions, gradeOpenOffline } from '../src/engine/quiz.js';
import { buildSession, rankTopics, tomorrowLine, recoveryInfo, projectCalendar, planStats } from '../src/engine/scheduler.js';
import { sessionReport, periodReport, procedureReport, forecast } from '../src/engine/reporting.js';
import { analyzeBandoOffline } from '../src/engine/bando.js';
import { AIService } from '../src/ai/ai.js';

const NOW = new Date('2026-10-06T10:00:00').getTime();
const freshState = () => { const s = emptyState(); s.user = { name: 'Giorgia', goal: 'lavoro', availability: [0, 30, 30, 30, 30, 30, 20] }; return s; };
const Q = id => QUESTIONS.find(q => q.id === id);

test('content pack: integrità', () => {
  const ids = new Set();
  for (const q of [...QUESTIONS, ...OPEN_QUESTIONS]) { assert.ok(!ids.has(q.id), 'id duplicato ' + q.id); ids.add(q.id); assert.ok(TOPICS.find(t => t.id === q.topic), 'topic mancante ' + q.id); }
  for (const q of QUESTIONS) {
    assert.ok(q.answer >= 0 && q.answer < q.options.length, 'risposta fuori range ' + q.id);
    assert.ok(q.trap == null || (q.trap !== q.answer && q.trap < q.options.length), 'trap non valido ' + q.id);
    if (q.source) assert.ok(SOURCES.find(s => s.id === q.source), 'fonte mancante ' + q.id);
    assert.equal(new Set(q.options).size, q.options.length, 'opzioni duplicate ' + q.id);
  }
  for (const t of TOPICS) { assert.ok(SUBJECTS.find(s => s.id === t.subject)); assert.ok(LESSONS.find(l => l.topic === t.id), 'lezione mancante ' + t.id); assert.ok(QUESTIONS.filter(q => q.topic === t.id).length >= 3, 'poche domande ' + t.id); }
  for (const p of PROCEDURE_TEMPLATES) for (const r of p.requirements) if (r.source) assert.ok(SOURCES.find(s => s.id === r.source));
  // contenuti che cambiano nel tempo devono essere marcati
  assert.equal(SOURCES.find(s => s.id === 'dm89').status, 'da_verificare');
});

test('srs: intervalli crescono se giusto, ripartono se sbagliato', () => {
  let c = newCard(NOW);
  c = reviewCard(c, 2, NOW); assert.equal(c.interval, 1);
  c = reviewCard(c, 2, NOW); assert.equal(c.interval, 3);
  c = reviewCard(c, 2, NOW); assert.ok(c.interval > 3);
  c = reviewCard(c, 0, NOW); assert.equal(c.interval, 1); assert.equal(c.lapses, 1);
  const g = reviewCard(reviewCard(newCard(NOW), 2, NOW), 1, NOW); assert.ok(g.interval < 3, 'risposta incerta: intervallo più corto');
});

test('memoria: decade nel tempo e la padronanza cala', () => {
  const s = freshState();
  for (const id of ['q009', 'q010', 'q011', 'q012']) recordAttempt(s, Q(id), { chosen: Q(id).answer, ms: 9000 }, NOW);
  const st = getStat(s, 't_241');
  assert.ok(retention(st, NOW) > 0.99);
  assert.ok(retention(st, NOW + 60 * DAY) < 0.5);
  assert.ok(mastery(st, NOW + 60 * DAY) < mastery(st, NOW));
});

test('errori: classificazione delle cause', () => {
  const s = freshState();
  assert.equal(classifyError(s, Q('q009'), { chosen: 0, dontKnow: true }, NOW), 'sconosciuto');
  assert.equal(classifyError(s, Q('q009'), { chosen: 0, ms: 1500 }, NOW), 'lettura');
  assert.equal(classifyError(s, Q('q009'), { chosen: 0, ms: 8000, confident: true }, NOW), 'falsa_sicurezza');
  assert.equal(classifyError(s, Q('q009'), { chosen: 3, ms: 8000 }, NOW), 'distrattore');   // q009 trap = 3
  recordAttempt(s, Q('q014'), { chosen: 1, ms: 8000 }, NOW);
  assert.equal(classifyError(s, Q('q014'), { chosen: 2, ms: 8000 }, NOW + DAY), 'dimenticanza');
});

test('errori: risolti dopo due risposte giuste consecutive', () => {
  const s = freshState();
  const r = recordAttempt(s, Q('q022'), { chosen: 0, ms: 8000 }, NOW);
  assert.equal(r.correct, false); assert.equal(getStat(s, 't_gdpr').errorsOpen, 1);
  recordAttempt(s, Q('q022'), { chosen: 1, ms: 8000 }, NOW + DAY);
  assert.equal(s.errors[0].resolved, false);
  recordAttempt(s, Q('q022'), { chosen: 1, ms: 8000 }, NOW + 2 * DAY);
  assert.equal(s.errors[0].resolved, true); assert.equal(getStat(s, 't_gdpr').errorsOpen, 0);
});

test('falsa preparazione: riconosce ma non applica', () => {
  const s = freshState();
  for (const id of ['q014', 'q015', 'q014', 'q015']) recordAttempt(s, Q(id), { chosen: Q(id).answer, ms: 8000 }, NOW);
  recordAttempt(s, Q('q016'), { chosen: 2, ms: 8000 }, NOW);
  recordAttempt(s, Q('q017'), { chosen: 0, ms: 8000 }, NOW);
  assert.match(falsePreparation(getStat(s, 't_accesso')), /applicarle/);
});

test('falsa preparazione: risposte giuste tirate a indovinare', () => {
  const s = freshState();
  for (const id of ['q049', 'q050', 'q051', 'q052', 'q049']) recordAttempt(s, Q(id), { chosen: Q(id).answer, ms: 8000, unsure: true }, NOW);
  assert.match(falsePreparation(getStat(s, 't_office')), /indovinare/);
});

test('priorità: argomento importante e debole prima di uno padroneggiato', () => {
  const s = freshState();
  for (let i = 0; i < 6; i++) for (const id of ['q009', 'q010', 'q011', 'q012', 'q013']) recordAttempt(s, Q(id), { chosen: Q(id).answer, ms: 8000 }, NOW);
  markLessonRead(s, 'l_241', true, NOW);
  const ranked = rankTopics(s, { now: NOW });
  const pos = id => ranked.findIndex(r => r.topic.id === id);
  assert.ok(pos('t_gdpr') < pos('t_241'));
  assert.ok(pos('t_traspar') > pos('t_gdpr'), 'prerequisito non soddisfatto abbassa la priorità');
});

test('sessione "fai tu": rispetta il tempo e include lezione se argomento nuovo', () => {
  const s = freshState();
  const plan = buildSession(s, 30, { now: NOW, rnd: seededRandom(3) });
  assert.ok(plan.focusTopic);
  assert.ok(plan.blocks.some(b => b.kind === 'lesson'));
  const st = planStats(s, plan);
  const est = st.review * 0.75 + st.lessons * 5 + (st.mc - st.review) + st.open * 4;
  assert.ok(est <= 34, 'stima minuti ' + est);
  assert.ok(plan.why.length >= 1);
});

test('sessione breve (10 min) evita lezioni troppo lunghe se c\'è un argomento già avviato', () => {
  const s = freshState();
  markLessonRead(s, 'l_office', true, NOW - DAY);
  for (const id of ['q049', 'q050']) recordAttempt(s, Q(id), { chosen: 3, ms: 8000 }, NOW - DAY);
  const plan = buildSession(s, 6, { now: NOW, rnd: seededRandom(1) });
  assert.ok(!plan.blocks.some(b => b.kind === 'lesson'));
});

test('modalità "non ho voglia": esattamente 5 domande', () => {
  const s = freshState();
  const plan = buildSession(s, 30, { mode: 'lazy', now: NOW, rnd: seededRandom(2) });
  assert.equal(plan.minutes, 5);
  assert.equal(plan.blocks[0].qids.length, 5);
});

test('ripasso errori e domande in scadenza', () => {
  const s = freshState();
  recordAttempt(s, Q('q030'), { chosen: 1, ms: 8000 }, NOW - 2 * DAY);
  assert.ok(dueQuestionIds(s, NOW).includes('q030'));
  assert.deepEqual(pickQuestions(s, { mode: 'errors', n: 5 }).map(q => q.id), ['q030']);
});

test('recupero dopo giorni saltati', () => {
  const s = freshState();
  s.sessions.push({ id: 's1', startedAt: NOW - 6 * DAY, endedAt: NOW - 6 * DAY + 1800000 });
  const r = recoveryInfo(s, NOW);
  assert.ok(r && r.missed >= 2);
  const plan = buildSession(s, 60, { now: NOW, rnd: seededRandom(4) });
  assert.ok(plan.minutes <= 20);
});

test('riga DOMANI nel formato richiesto', () => {
  const s = freshState();
  const line = tomorrowLine(s, NOW);   // martedì → mercoledì: 30 min
  assert.match(line, /^DOMANI: 30 minuti – .+ – ripasso: .+ – \d+ quiz$/);
  const sat = new Date('2026-10-10T10:00:00').getTime(); // sabato → domenica: 0
  assert.match(tomorrowLine(s, sat), /riposo/);
});

test('calendario: ruota gli argomenti e rispetta i giorni liberi', () => {
  const cal = projectCalendar(freshState(), 14, NOW);
  assert.equal(cal.length, 14);
  assert.ok(cal.filter(d => d.minutes === 0).every(d => new Date(d.date).getDay() === 0));
  assert.ok(new Set(cal.filter(d => d.topic).map(d => d.topic)).size >= 4);
});

test('diagnostico copre tutti gli argomenti', () => {
  const d = diagnosticQuestions(freshState(), seededRandom(5));
  assert.equal(new Set(d.map(q => q.topic)).size, TOPICS.length);
});

test('risposte aperte: correzione offline a parole chiave', () => {
  const o = OPEN_QUESTIONS[0];
  const good = gradeOpenOffline(o, 'Il responsabile del procedimento cura l\'istruttoria e fa rispettare i termini; se manca, è il dirigente dell\'unità organizzativa.');
  const bad = gradeOpenOffline(o, 'non so');
  assert.ok(good.score >= 0.8, 'score ' + good.score); assert.ok(bad.score < 0.2);
  const s = freshState(); recordOpenAnswer(s, o, 0.3, 's', NOW); assert.equal(getStat(s, 't_241').levels.spiegazione.n, 1);
});

test('report di sessione, periodo, bando e previsione', () => {
  const s = freshState();
  const session = { id: 'sx', startedAt: NOW - 20 * 60000, endedAt: NOW, lessons: ['t_241'], mode: 'auto' };
  recordAttempt(s, Q('q009'), { chosen: 1, ms: 8000, sessionId: 'sx' }, NOW);
  recordAttempt(s, Q('q010'), { chosen: 0, ms: 8000, sessionId: 'sx' }, NOW);
  const rep = sessionReport(s, session, {}, NOW);
  assert.equal(rep.quizTotal, 2); assert.equal(rep.quizCorrect, 1); assert.equal(rep.errors, 1); assert.equal(rep.minutes, 20);
  assert.match(rep.tomorrow, /^DOMANI/);
  session.report = rep; s.sessions.push(session);
  const w = periodReport(s, 7, NOW); assert.equal(w.minutes, 20); assert.equal(w.quiz, 2);
  const proc = { ...PROCEDURE_TEMPLATES[0], checked: { r_dipl: true } };
  const pr = procedureReport(s, proc, NOW); assert.equal(pr.status, 'non pronto'); assert.ok(pr.missing.length === 3);
  for (let i = 0; i < 6; i++) s.history['2026-09-' + String(20 + i)] = { mastery: 0.1 + i * 0.05, coverage: 0 };
  const f = forecast(s, 0.75, NOW); assert.ok(f.ready && f.days > 0);
});

test('analisi bando offline: date, tipo, profilo, avvisi', () => {
  const txt = `Graduatorie di istituto di terza fascia per soli titoli. Profilo: Assistente Amministrativo.
Requisiti: diploma di scuola secondaria di secondo grado e certificazione CIAD.
Le domande si presentano dal 28 maggio 2027 al 28/06/2027 tramite Istanze Online. Ai sensi del D.M. n. 89 del 21/05/2024.`;
  const r = analyzeBandoOffline(txt);
  assert.equal(r.type, 'titoli');
  assert.ok(r.profiles.includes('assistente amministrativo'));
  assert.ok(r.subjects.includes('info'));
  assert.ok(r.dates.some(d => d.iso === '2027-06-28' && d.kind === 'possibile scadenza'));
  assert.ok(r.dates.some(d => d.iso === '2024-05-21' && d.kind === 'riferimento normativo'));
  assert.ok(r.requirements.length >= 1);
  assert.ok(r.warnings.some(w => /confronta le date/.test(w)));
});

test('store: export/import e migrazione, la chiave API non viene esportata', async () => {
  const st = new Store(new MemoryAdapter()); await st.load();
  st.state.user = { name: 'Giorgia' }; st.state.settings.apiKey = 'SEGRETA';
  const json = st.exportJSON(); assert.ok(!json.includes('SEGRETA'));
  const st2 = new Store(new MemoryAdapter()); await st2.load(); st2.state.settings.apiKey = 'MIA';
  await st2.importJSON(json); assert.equal(st2.state.user.name, 'Giorgia'); assert.equal(st2.state.settings.apiKey, 'MIA');
  await assert.rejects(() => st2.importJSON('{"app":"altro"}'));
  const m = migrate({ user: { name: 'x' } }); assert.ok(Array.isArray(m.attempts)); assert.equal(m.settings.aiMode, 'off');
});

test('AI: offline → fallback; cache evita chiamate; budget blocca', async () => {
  const state = emptyState();
  let calls = 0;
  const fake = { name: 'fake', generate: async () => { calls++; return { text: 'spiegazione', tokensIn: 100, tokensOut: 50 }; } };
  const ai = new AIService(() => state, () => {}, () => fake);
  assert.equal((await ai.run('explain', { topic: 'x', lesson: 'y' })).ok, false);           // AI spenta
  state.settings.aiMode = 'on'; state.settings.apiKey = 'k';
  const a = await ai.run('explain', { topic: 'x', lesson: 'y' }); assert.ok(a.ok && !a.cached);
  const b = await ai.run('explain', { topic: 'x', lesson: 'y' }); assert.ok(b.ok && b.cached);
  assert.equal(calls, 1);
  state.settings.dailyTokenBudget = 200;
  const c = await ai.run('explain', { topic: 'altro', lesson: 'z' }); assert.equal(c.ok, false); assert.match(c.reason, /limite/);
  const broken = new AIService(() => state, () => {}, () => ({ name: 'b', generate: async () => ({ text: 'non json', tokensIn: 1, tokensOut: 1 }) }));
  state.settings.dailyTokenBudget = 99999;
  assert.equal((await broken.run('gradeOpen', { question: 'q', model: 'm', answer: 'a' })).ok, false);
});

test('test iniziale: le risposte sbagliate non diventano errori né ripassi', () => {
  const s = freshState();
  recordAttempt(s, Q('q001'), { chosen: 2, ms: 8000, diagnostic: true }, NOW);
  recordAttempt(s, Q('q002'), { chosen: null, dontKnow: true, diagnostic: true }, NOW);
  assert.equal(s.errors.length, 0); assert.equal(Object.keys(s.cards).length, 0);
  assert.equal(getStat(s, 't_auto').n, 2);
  recordAttempt(s, Q('q003'), { chosen: 1, ms: 8000, diagnostic: true }, NOW);
  assert.ok(s.cards.q003);
});
