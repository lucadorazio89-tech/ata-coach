// v0.6: email di riepilogo serale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, ciadSummary, reportDay } from '../monitor/daily-report.mjs';
import { emptyState } from '../src/core/store.js';
import { recordAttempt, allQuestions } from '../src/engine/learning.js';
import { DAY, startOfDay } from '../src/core/util.js';

const NOW = new Date('2026-10-13T20:00:00').getTime();
function state() {
  const s = emptyState(); s.user = { name: 'Giorgia', hasCIAD: 'no', availability: [0, 30, 30, 30, 30, 30, 0] };
  const qs = allQuestions(s).filter(q => q.type === 'mc' && !q.pc);
  for (const [d, n, min] of [[0, 4, 20], [2, 3, 15]]) {
    const t0 = startOfDay(NOW - d * DAY) + 18 * 3600000;
    for (let i = 0; i < n; i++) recordAttempt(s, qs[i + d], { chosen: i % 2 ? qs[i + d].answer : (qs[i + d].answer + 1) % 4, ms: 9000, sessionId: 's' + d }, t0 + i * 1000);
    s.sessions.push({ id: 's' + d, mode: 'auto', startedAt: t0, endedAt: t0 + min * 60000, lessons: [], report: { minutes: min } });
  }
  return s;
}

test('riepilogo: oggi, settimana, mese, domani nel testo e nell\'HTML', () => {
  const r = buildReport(state(), { updatedAt: NOW - 600000 }, NOW);
  assert.match(r.subject, /Giorgia, martedì 13 ottobre: 20 min di studio/);
  for (const k of ['OGGI', 'ULTIMI 7 GIORNI', 'ULTIMI 30 GIORNI', 'A CHE PUNTO È', 'CIAD', 'DOMANI']) assert.ok(r.text.includes(k), k);
  assert.match(r.text, /4 domande, 50% giuste/);
  assert.match(r.text, /35 min · studio in 2 giorni su 7/);
  assert.ok(r.html.includes('Riepilogo di Giorgia') && r.html.includes('Domani'));
  assert.ok(!r.html.includes('Ultima sincronizzazione'), 'dati aggiornati: nessun avviso');
});

test('riepilogo: avviso se i dati non sono stati sincronizzati oggi; giorno senza studio', () => {
  const s = emptyState(); s.user = { name: 'Giorgia', hasCIAD: 'si', availability: [30, 30, 30, 30, 30, 30, 30] };
  const r = buildReport(s, { updatedAt: NOW - 2 * DAY }, NOW);
  assert.match(r.subject, /oggi niente studio/);
  assert.ok(r.html.includes('Ultima sincronizzazione'));
  assert.ok(!r.text.includes('CIAD – SIMULAZIONE'), 'chi ha la CIAD non vede la sezione simulazione');
});

test('CIAD «pronta»: parte superata in due giorni diversi con almeno 9 Base su 12', () => {
  const s = emptyState();
  const part = (ok) => ({ n: 3, passed: ok >= 6, level: ok >= 6 ? 1 : 0, counts: { 1: { n: 12, ok } } });
  s.sessions = [{ mode: 'eipsim', startedAt: NOW - 3 * DAY, report: { eip: { parts: [part(10)] } } },
    { mode: 'eipsim', startedAt: NOW - DAY, report: { eip: { parts: [part(9)] } } },
    { mode: 'eipsim', startedAt: NOW - DAY, report: { eip: { parts: [{ ...part(7), n: 4 }] } } }];
  const c = ciadSummary(s);
  assert.equal(c.find(p => p.n === 3).ready, true);
  assert.equal(c.find(p => p.n === 4).ready, false, '7 su 12 supera la parte ma senza margine');
  assert.equal(c.find(p => p.n === 1).tries, 0);
});

test('invio in ritardo dopo mezzanotte: il riepilogo resta sulla giornata appena finita', () => {
  const late = new Date('2026-10-14T01:05:00').getTime();
  const r = buildReport(state(), { updatedAt: NOW }, reportDay(late));
  assert.match(r.subject, /martedì 13 ottobre: 20 min di studio/);
  assert.equal(reportDay(NOW), NOW, 'alle 20 non cambia niente');
});
