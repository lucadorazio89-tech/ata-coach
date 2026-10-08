import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../src/core/util.js';
import { emptyState, migrate } from '../src/core/store.js';
import { QUESTIONS } from '../src/content/seed.js';
import { recordAttempt, markLessonRead, recordOpenAnswer, rebuildDerived, mastery, getStat } from '../src/engine/learning.js';
import { OPEN_QUESTIONS } from '../src/content/seed.js';
import { mergePayloads, syncPayload, syncNow, GitHubSync, SyncError, encodeLink, decodeLink, toB64, fromB64 } from '../src/core/sync.js';

const NOW = new Date('2026-10-07T10:00:00').getTime();
const Q = id => QUESTIONS.find(q => q.id === id);
const device = (name = 'Giorgia') => { const s = emptyState(); s.user = { name, goal: 'lavoro', availability: [0, 30, 30, 30, 30, 30, 0], updatedAt: NOW - 10 * DAY }; return s; };

// Backend finto che si comporta come l'API GitHub (sha, conflitti).
class FakeRemote {
  constructor() { this.file = null; this.sha = null; this.pushes = 0; this.raceOnce = null; }
  async pull() { return this.file ? { data: JSON.parse(this.file).payload, sha: this.sha } : null; }
  async push(payload, sha) {
    if (this.raceOnce) { const f = this.raceOnce; this.raceOnce = null; await f(); }
    if ((this.sha || null) !== (sha || null)) throw new SyncError('conflict');
    this.file = JSON.stringify({ app: 'ata-coach', payload }); this.sha = 'sha' + (++this.pushes); return this.sha;
  }
}

test('ricostruzione: rigiocare la storia dà le stesse statistiche registrate dal vivo', () => {
  const s = device();
  markLessonRead(s, 'l_241', true, NOW - 3 * DAY);
  recordAttempt(s, Q('q001'), { chosen: 2, ms: 8000, diagnostic: true }, NOW - 4 * DAY);
  recordAttempt(s, Q('q009'), { chosen: 1, ms: 8000 }, NOW - 3 * DAY);
  recordAttempt(s, Q('q010'), { chosen: 0, ms: 8000, unsure: true }, NOW - 2 * DAY);
  recordAttempt(s, Q('q010'), { chosen: 1, ms: 8000 }, NOW - DAY);
  markLessonRead(s, 'l_gdpr', false, NOW - DAY);
  recordOpenAnswer(s, OPEN_QUESTIONS[0], 0.7, 'x', NOW);
  const live = JSON.parse(JSON.stringify({ t: s.topicStats, c: s.cards }));
  rebuildDerived(s);
  assert.deepStrictEqual(JSON.parse(JSON.stringify({ t: s.topicStats, c: s.cards })), live);
});

test('unione: due dispositivi che studiano offline non perdono nulla', async () => {
  const remote = new FakeRemote();
  const phone = device(), pc = device();
  recordAttempt(phone, Q('q009'), { chosen: 1, ms: 8000 }, NOW - 2 * DAY);
  await syncNow(phone, remote, { now: NOW - 2 * DAY });
  await syncNow(pc, remote, { now: NOW - 2 * DAY + 1000 });            // il PC riceve i dati del telefono
  assert.equal(pc.attempts.length, 1);
  // entrambi studiano offline
  recordAttempt(phone, Q('q022'), { chosen: 1, ms: 8000 }, NOW - DAY);
  markLessonRead(phone, 'l_gdpr', true, NOW - DAY);
  recordAttempt(pc, Q('q049'), { chosen: 0, ms: 8000 }, NOW - DAY + 5000);   // sbagliata → errore
  await syncNow(phone, remote, { now: NOW });
  await syncNow(pc, remote, { now: NOW + 1000 });
  await syncNow(phone, remote, { now: NOW + 2000 });
  for (const d of [phone, pc]) { assert.equal(d.attempts.length, 3); assert.equal(d.errors.length, 1); assert.ok(d.lessonsRead.l_gdpr); }
  assert.deepStrictEqual(phone.topicStats, pc.topicStats);
  assert.equal(getStat(pc, 't_office').errorsOpen, 1);
  assert.ok(mastery(pc.topicStats.t_gdpr, NOW) > 0);
});

test('unione: nessun salvataggio se non è cambiato niente', async () => {
  const remote = new FakeRemote(), d = device();
  recordAttempt(d, Q('q009'), { chosen: 1, ms: 8000 }, NOW);
  const r1 = await syncNow(d, remote, { now: NOW }); assert.equal(r1.pushed, true);
  const r2 = await syncNow(d, remote, { now: NOW + 1000 }); assert.equal(r2.pushed, false);
  assert.equal(remote.pushes, 1);
});

test('unione: conflitto di scrittura risolto con un nuovo tentativo', async () => {
  const remote = new FakeRemote(), a = device(), b = device();
  recordAttempt(a, Q('q009'), { chosen: 1, ms: 8000 }, NOW);
  recordAttempt(b, Q('q010'), { chosen: 1, ms: 8000 }, NOW + 10);
  remote.raceOnce = async () => { await syncNow(b, remote, { now: NOW + 20 }); };   // b scrive mentre a sta scrivendo
  await syncNow(a, remote, { now: NOW + 30 });
  assert.equal(a.attempts.length, 2);
  assert.equal(JSON.parse(remote.file).payload.attempts.length, 2);
});

test('unione: errori risolti, profilo più recente, cancellazioni propagate', () => {
  const a = syncPayload(device()), b = syncPayload(device());
  a.errors = [{ id: 'e1', topic: 't_241', resolved: false, at: 1 }];
  b.errors = [{ id: 'e1', topic: 't_241', resolved: true, resolvedAt: 5, at: 1, userType: 'distrattore', userTypeAt: 4 }];
  b.user = { ...b.user, name: 'Giorgia R.', updatedAt: NOW };
  a.procedures = [{ id: 'p1', name: 'Bando', updatedAt: 10 }, { id: 'p2', name: 'Altro', updatedAt: 10 }];
  b.procedures = [{ id: 'p1', name: 'Bando aggiornato', updatedAt: 20 }];
  b.tombstones = { p2: 30 };
  const m = mergePayloads(a, b);
  assert.equal(m.errors[0].resolved, true); assert.equal(m.errors[0].userType, 'distrattore');
  assert.equal(m.user.name, 'Giorgia R.');
  assert.deepEqual(m.procedures.map(p => p.name), ['Bando aggiornato']);
  assert.equal(JSON.stringify(mergePayloads(m, m)), JSON.stringify(m), 'unione idempotente');
  assert.equal(JSON.stringify(mergePayloads(a, b).attempts), JSON.stringify(mergePayloads(b, a).attempts));
});

test('primo collegamento: il profilo già salvato vince su quello appena creato', async () => {
  const remote = new FakeRemote(), main = device('Giorgia');
  await syncNow(main, remote, { now: NOW });
  const fresh = device('Prova'); fresh.user.updatedAt = NOW + DAY;   // nuovo dispositivo, profilo creato dopo
  await syncNow(fresh, remote, { now: NOW + DAY });
  assert.equal(fresh.user.name, 'Giorgia');
});

test('GitHub: lettura, scrittura, errori di chiave e repository', async () => {
  const store = { content: null, sha: null };
  const fetchFn = async (url, opts = {}) => {
    const h = opts.headers || {};
    if (h.Authorization !== 'Bearer buona') return { ok: false, status: 401, json: async () => ({}) };
    if (url.startsWith('https://api.github.com/repos/giorgia/ata-coach-dati/contents/')) {
      if (opts.method === 'PUT') { const b = JSON.parse(opts.body); if ((b.sha || null) !== store.sha) return { ok: false, status: 409, json: async () => ({}) }; store.content = b.content; store.sha = 's' + Date.now(); return { ok: true, status: 200, json: async () => ({ content: { sha: store.sha } }) }; }
      if (!store.content) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ sha: store.sha, encoding: 'base64', content: store.content }) };
    }
    if (url === 'https://api.github.com/repos/giorgia/ata-coach-dati') return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const gh = new GitHubSync({ token: 'buona', repo: 'giorgia/ata-coach-dati', fetchFn });
  assert.equal(await gh.pull(), null);
  const d = device(); recordAttempt(d, Q('q009'), { chosen: 1, ms: 8000 }, NOW);
  await syncNow(d, gh, { now: NOW });
  const back = await gh.pull(); assert.equal(back.data.attempts.length, 1); assert.equal(back.data.user.name, 'Giorgia');
  const bad = new GitHubSync({ token: 'sbagliata', repo: 'giorgia/ata-coach-dati', fetchFn });
  await assert.rejects(() => bad.pull(), e => e.code === 'auth');
  const wrongRepo = new GitHubSync({ token: 'buona', repo: 'giorgia/altro', fetchFn });
  await assert.rejects(() => wrongRepo.pull(), e => e.code === 'repo');
  assert.throws(() => new GitHubSync({ token: 'x', repo: 'non valido' }), e => e.code === 'config');
});

test('codice di collegamento e testo con accenti', () => {
  const code = encodeLink('giorgia/ata-coach-dati', 'github_pat_ABC123');
  assert.deepEqual(decodeLink(code), { repo: 'giorgia/ata-coach-dati', token: 'github_pat_ABC123' });
  assert.deepEqual(decodeLink('https://x.github.io/ata-coach/#collega=' + code), { repo: 'giorgia/ata-coach-dati', token: 'github_pat_ABC123' });
  assert.equal(decodeLink('spazzatura'), null);
  assert.equal(fromB64(toB64('perché è già lì – «ok»')), 'perché è già lì – «ok»');
});

test('migrazione v3: registro lezioni e test iniziale marcati', () => {
  const m = migrate({ schemaVersion: 2, lessonsRead: { l_241: NOW }, sessions: [{ id: 'd', diagnostic: true }], attempts: [{ id: 'a', session: 'd', qid: 'q001', topic: 't_auto', correct: false, at: NOW }] });
  assert.equal(m.lessonLog.length, 1); assert.equal(m.attempts[0].diag, true); assert.equal(m.schemaVersion, 4);
  rebuildDerived(m); assert.equal(Object.keys(m.cards).length, 0);
});

test('GitHub: una richiesta appesa non blocca la sincronizzazione', async () => {
  const hang = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const gh = new GitHubSync({ token: 'x'.repeat(30), repo: 'a/b', fetchFn: hang });
  const orig = globalThis.setTimeout; globalThis.setTimeout = (f) => orig(f, 5);   // accelera il timeout nel test
  try { await assert.rejects(() => gh.pull(), e => e.code === 'offline'); } finally { globalThis.setTimeout = orig; }
});
