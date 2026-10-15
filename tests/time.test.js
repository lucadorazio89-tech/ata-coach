// v0.6: tempo di studio attivo (non il tempo trascorso tra inizio e fine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addActive, sessionMinutesOn, sessionReport, estimateActiveMinutes, ACTIVE_CAP } from '../src/engine/reporting.js';
import { studiedMinutesOn } from '../src/engine/scheduler.js';
import { emptyState, migrate } from '../src/core/store.js';
import { mergePayloads } from '../src/core/sync.js';
import { dayKey } from '../src/core/util.js';

const T = new Date('2026-10-14T18:00:00').getTime(), MIN = 60000;

test('le interazioni sommano il tempo tra un tocco e l\'altro', () => {
  const r = { lastTick: T };
  addActive(r, T + 40000); addActive(r, T + 100000); addActive(r, T + 160000);
  assert.equal(r.activeMs, 160000);
});

test('app lasciata aperta: al massimo 3 minuti su una domanda, 8 su una lezione', () => {
  const r = { lastTick: T };
  addActive(r, T + 25 * MIN, 'mc'); assert.equal(r.activeMs, ACTIVE_CAP.mc);
  addActive(r, T + 50 * MIN, 'lesson'); assert.equal(r.activeMs, ACTIVE_CAP.mc + ACTIVE_CAP.lesson);
});

test('app nascosta (schermo spento, altra app): non conta niente', () => {
  const r = { lastTick: T };
  addActive(r, T + 2 * MIN, 'mc', false);
  assert.equal(r.activeMs || 0, 0); assert.equal(r.lastTick, T + 2 * MIN);
});

test('il report usa il tempo attivo e divide tra i giorni una sessione ripresa il giorno dopo', () => {
  const s = emptyState(); const next = T + 24 * 60 * MIN;
  const session = { id: 'x', startedAt: T, endedAt: next + 10 * MIN, lessons: [], activeMs: 22 * MIN, activeByDay: { [dayKey(T)]: 12 * MIN, [dayKey(next)]: 10 * MIN } };
  session.report = sessionReport(s, session, {}, next + 10 * MIN);
  assert.equal(session.report.minutes, 22, 'non 24 ore');
  s.sessions.push(session);
  assert.equal(sessionMinutesOn(session, dayKey(T)), 12);
  assert.equal(studiedMinutesOn(s, next), 10);
});

test('migrazione v5: sessioni vecchie gonfiate dalle pause vengono corrette, le altre restano', () => {
  const s = emptyState(); s.schemaVersion = 4;
  s.attempts = Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, session: 'gonfiata', ms: 40000, level: 'riconoscimento', at: T + i }));
  s.sessions = [{ id: 'gonfiata', startedAt: T, endedAt: T + 3 * 60 * MIN, lessons: [{ topic: 't' }], report: { minutes: 180 } },
    { id: 'normale', startedAt: T, endedAt: T + 20 * MIN, lessons: [{ topic: 't' }, { topic: 'u' }], report: { minutes: 20 } }];
  const m = migrate(s);
  const g = m.sessions.find(x => x.id === 'gonfiata');
  assert.equal(g.report.minutes, estimateActiveMinutes(m, g)); assert.equal(g.report.wallMinutes, 180); assert.ok(g.report.minutes < 15);
  assert.equal(m.sessions.find(x => x.id === 'normale').report.minutes, 20);
});

test('sincronizzazione: la sessione con il tempo corretto vince su quella vecchia gonfiata', () => {
  const old = { id: 'x', startedAt: T, report: { minutes: 180 } }, fixed = { id: 'x', startedAt: T, report: { minutes: 9, wallMinutes: 180 } };
  assert.equal(mergePayloads({ sessions: [old] }, { sessions: [fixed] }).sessions[0].report.minutes, 9);
  assert.equal(mergePayloads({ sessions: [fixed] }, { sessions: [old] }).sessions[0].report.minutes, 9);
});
