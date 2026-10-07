// Sincronizzazione tra dispositivi tramite un repository GitHub privato.
// Non copia un dispositivo sull'altro: UNISCE i dati (nessuna risposta va persa) e poi ricalcola i progressi.
import { uid } from './util.js';
import { rebuildDerived, recordHistory } from '../engine/learning.js';

export const SYNC_FILE = 'ata-coach-sync.json';
// Dati condivisi. Restano sul singolo dispositivo: impostazioni e chiavi, cache AI, sessione in corso, statistiche (ricalcolate).
export const SYNC_KEYS = ['user', 'procedures', 'attempts', 'errors', 'sessions', 'lessonsRead', 'lessonLog', 'history', 'plans', 'customQuestions', 'documents', 'reports', 'sourceChecks', 'feedSeen', 'lastBackupAt', 'tombstones', 'createdAt'];

export class SyncError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export function syncPayload(state) { const p = {}; for (const k of SYNC_KEYS) p[k] = state[k]; return JSON.parse(JSON.stringify(p)); }

const byId = (a = [], b = [], pick = x => x) => { const m = new Map(); for (const x of a) m.set(x.id, x); for (const y of b) m.set(y.id, m.has(y.id) ? pick(m.get(y.id), y) : y); return [...m.values()]; };
const maxMap = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = Math.max(o[k] || 0, v || 0); return o; };
const newer = (x, y) => ((y?.updatedAt || 0) > (x?.updatedAt || 0) ? y : x);
const maxN = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
const maxS = (x, y) => (x == null ? y : y == null ? x : (x > y ? x : y));

export function mergePayloads(a, b) {
  const tombstones = maxMap(a.tombstones, b.tombstones);
  const alive = x => !(tombstones[x.id] && tombstones[x.id] >= (x.updatedAt || 0));
  const history = { ...(a.history || {}) };
  for (const [d, v] of Object.entries(b.history || {})) { const c = history[d]; history[d] = !c ? v : { mastery: Math.max(c.mastery || 0, v.mastery || 0), coverage: Math.max(c.coverage || 0, v.coverage || 0) }; }
  const plans = { ...(a.plans || {}) };
  for (const [d, v] of Object.entries(b.plans || {})) if (!plans[d] || (v.createdAt || 0) > (plans[d].createdAt || 0)) plans[d] = v;
  return {
    user: a.user && b.user ? newer(a.user, b.user) : (a.user || b.user || null),
    procedures: byId(a.procedures, b.procedures, newer).filter(alive),
    attempts: byId(a.attempts, b.attempts).sort((x, y) => x.at - y.at),
    errors: byId(a.errors, b.errors, (x, y) => ({ ...x, resolved: !!(x.resolved || y.resolved), resolvedAt: maxN(x.resolvedAt, y.resolvedAt),
      userType: (y.userTypeAt || 0) > (x.userTypeAt || 0) ? y.userType : (x.userType ?? y.userType ?? null), userTypeAt: maxN(x.userTypeAt, y.userTypeAt) })).sort((x, y) => x.at - y.at),
    sessions: byId(a.sessions, b.sessions).sort((x, y) => x.startedAt - y.startedAt),
    lessonsRead: maxMap(a.lessonsRead, b.lessonsRead),
    lessonLog: byId(a.lessonLog, b.lessonLog).sort((x, y) => x.at - y.at),
    history, plans,
    customQuestions: byId(a.customQuestions, b.customQuestions, newer).filter(alive),
    documents: byId(a.documents, b.documents).filter(alive),
    reports: byId(a.reports, b.reports).filter(alive),
    sourceChecks: maxMap(a.sourceChecks, b.sourceChecks),
    feedSeen: maxS(a.feedSeen, b.feedSeen), lastBackupAt: maxN(a.lastBackupAt, b.lastBackupAt),
    tombstones, createdAt: (a.createdAt && b.createdAt) ? Math.min(a.createdAt, b.createdAt) : (a.createdAt || b.createdAt || null)
  };
}

export function applyPayload(state, p) { for (const k of SYNC_KEYS) if (k in p) state[k] = p[k]; rebuildDerived(state); recordHistory(state); return state; }

// --- base64 UTF-8 (funziona nel browser e in Node)
export function toB64(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
export function fromB64(b64) { const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

export const validRepo = r => /^[\w.-]+\/[\w.-]+$/.test(String(r || '').trim());

export class GitHubSync {
  constructor({ token, repo, path = SYNC_FILE, fetchFn = null }) {
    if (!validRepo(repo)) throw new SyncError('config', 'Nome del repository non valido (formato: utente/nome).');
    if (!token) throw new SyncError('config', 'Manca la chiave di sincronizzazione.');
    this.token = token.trim(); this.repo = repo.trim(); this.path = path; this.fetch = fetchFn || ((...a) => fetch(...a));
  }
  url() { return `https://api.github.com/repos/${this.repo}/contents/${encodeURIComponent(this.path)}`; }
  headers(accept = 'application/vnd.github+json') { return { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }; }
  async req(url, opts) {
    let r; try { r = await this.fetch(url, opts); } catch { throw new SyncError('offline', 'Nessuna connessione.'); }
    if (r.status === 401) throw new SyncError('auth', 'La chiave di sincronizzazione non è valida o è scaduta.');
    if (r.status === 403) throw new SyncError('auth', 'La chiave non ha il permesso di scrivere nel repository (serve Contents: Read and write).');
    return r;
  }
  async pull() {
    const r = await this.req(this.url() + '?t=' + Date.now(), { headers: this.headers(), cache: 'no-store' });
    if (r.status === 404) { await this.checkRepo(); return null; }
    if (!r.ok) throw new SyncError('server', 'GitHub ha risposto con errore ' + r.status + '.');
    const meta = await r.json();
    let text;
    if (meta.content && meta.encoding === 'base64') text = fromB64(meta.content);
    else { const raw = await this.req(this.url() + '?raw=' + Date.now(), { headers: this.headers('application/vnd.github.raw+json'), cache: 'no-store' }); if (!raw.ok) throw new SyncError('server', 'Lettura non riuscita (' + raw.status + ').'); text = await raw.text(); }
    let data; try { data = JSON.parse(text); } catch { throw new SyncError('data', 'Il file di sincronizzazione è danneggiato.'); }
    if (!data || data.app !== 'ata-coach') throw new SyncError('data', 'Il file nel repository non è di ATA Coach.');
    return { data: data.payload, meta: data.meta, sha: meta.sha };
  }
  async checkRepo() {
    const r = await this.req(`https://api.github.com/repos/${this.repo}`, { headers: this.headers() });
    if (r.status === 404) throw new SyncError('repo', 'Repository non trovato, oppure la chiave non ha accesso a quel repository.');
  }
  async push(payload, sha, meta) {
    const body = { message: 'ATA Coach: sincronizzazione', content: toB64(JSON.stringify({ app: 'ata-coach', meta, payload })), ...(sha ? { sha } : {}) };
    const r = await this.req(this.url(), { method: 'PUT', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) throw new SyncError('conflict', 'Il file è cambiato nel frattempo.');
    if (!r.ok) throw new SyncError('server', 'Salvataggio non riuscito (' + r.status + ').');
    return (await r.json()).content?.sha;
  }
}

const strip = p => JSON.stringify(p);

// Sincronizza: legge, unisce, applica, scrive (con nuovi tentativi se l'altro dispositivo ha scritto nel frattempo).
export async function syncNow(state, backend, { now = Date.now(), save = async () => {} } = {}) {
  if (!state.sync.deviceId) state.sync.deviceId = uid('dev');
  const firstSync = !state.sync.lastSyncAt;
  let result = { pulled: false, pushed: false, changedLocal: false };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remote = await backend.pull();
    const local = syncPayload(state);
    // Primo collegamento di un dispositivo nuovo: il profilo già salvato (quello vero di Giorgia) vince su quello appena creato.
    if (firstSync && remote?.data?.user && local.user) local.user = { ...local.user, updatedAt: 0 };
    const merged = remote ? mergePayloads(local, remote.data) : mergePayloads(local, local);
    const current = syncPayload(state);
    const changedLocal = strip(merged) !== strip(mergePayloads(current, current));
    if (changedLocal) { applyPayload(state, merged); }
    const needPush = !remote || strip(merged) !== strip(mergePayloads(remote.data, remote.data));
    try {
      if (needPush) await backend.push(merged, remote?.sha, { updatedAt: now, device: state.sync.deviceId, schema: 1 });
      result = { pulled: !!remote, pushed: needPush, changedLocal };
      break;
    } catch (e) { if (e.code === 'conflict' && attempt < 3) continue; throw e; }
  }
  state.sync.lastSyncAt = now; state.sync.lastError = null;
  await save();
  return result;
}

// Codice per collegare un altro dispositivo (contiene la chiave: va trattato come una password).
export const encodeLink = (repo, token) => toB64(JSON.stringify({ r: repo, t: token })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeLink(code) {
  try { const s = String(code).trim().replace(/^.*#collega=/, ''); const j = JSON.parse(fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))); if (validRepo(j.r) && j.t) return { repo: j.r, token: j.t }; } catch { /* codice non valido */ }
  return null;
}
