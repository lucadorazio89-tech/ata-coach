// Database locale. Lo stato utente (progressi) è separato dai contenuti didattici (content pack in seed.js).
// Adapter: IndexedDB (browser), localStorage (fallback), memoria (test).
import { dayKey } from './util.js';
import { PROCEDURE_TEMPLATES } from '../content/seed.js';

export const SCHEMA_VERSION = 4;

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    user: null,                 // { name, goal, availability:[min dom..sab], notifyHour, startedAt, hasCIAD, hasDiploma }
    procedures: [],             // bandi/procedure seguite dall'utente (copie modificabili dei template + importati)
    topicStats: {},             // topicId -> statistiche del motore didattico
    cards: {},                  // questionId -> stato spaced repetition
    attempts: [],               // ogni risposta data
    errors: [],                 // registro errori con causa
    sessions: [],               // sessioni di studio con report
    lessonsRead: {},            // lessonId -> timestamp
    history: {},                // dayKey -> { mastery, coverage } per previsioni
    plans: {},                  // dayKey -> piano del giorno (DailyPlan)
    lastBackupAt: null,
    sourceChecks: {},           // sourceId -> data dell'ultima verifica fatta da una persona
    reports: [],                // segnalazioni di errori nei contenuti
    feedSeen: null,             // ultima novità dalle fonti già vista
    alertsDone: {},             // id avviso bando -> data in cui Giorgia l'ha letto
    nextPlan: null,             // { day, line } usato dal service worker per il promemoria push
    lessonLog: [],              // { id, lessonId, ok, at } eventi lezione (per ricostruire i progressi)
    tombstones: {},             // id eliminati -> data (per propagare le cancellazioni tra dispositivi)
    sync: { repo: '', token: '', lastSyncAt: null, lastError: null, deviceId: null },
    customQuestions: [],        // domande importate o generate (sempre marcate con origine)
    documents: [],              // testi importati (bandi, appunti)
    notifications: [],          // { id, at, text, read }
    aiLog: [],                  // { at, task, tokensIn, tokensOut, cached, provider }
    aiCache: {},                // hash -> { at, output }
    settings: { aiMode: 'off', provider: 'gemini', model: 'gemini-flash-latest', apiKey: '', dailyTokenBudget: 20000, notifications: false },
    current: null               // sessione in corso (per "continua da dove ero")
  };
}

export const MIGRATIONS = {
  // v2: il modello gemini-2.5-flash viene spento il 16/10/2026 → alias sempre aggiornato
  2: s => { if (!s.settings.model || /^gemini-(2\.0|2\.5)-flash$/.test(s.settings.model)) s.settings.model = 'gemini-flash-latest'; return s; },
  // v3: sincronizzazione — registro lezioni, test iniziale marcato sulle risposte, cancellazioni tracciate
  3: s => {
    if (!s.lessonLog || !s.lessonLog.length) s.lessonLog = Object.entries(s.lessonsRead || {}).map(([lessonId, at]) => ({ id: 'l_mig_' + lessonId, lessonId, ok: true, at }));
    const diag = new Set((s.sessions || []).filter(x => x.diagnostic).map(x => x.id));
    for (const a of s.attempts || []) if (a.session && diag.has(a.session)) a.diag = true;
    return s;
  },
  // v4: procedure ufficiali aggiornate (bando 2027 e CIAD EIPASS Standard); restano le spunte e le date scritte da Giorgia
  4: s => {
    s.alertsDone = s.alertsDone || {};
    s.procedures = (s.procedures || []).map(p => {
      const t = PROCEDURE_TEMPLATES.find(x => x.id === p.id); if (!t || (p.rev || 0) >= (t.rev || 0)) return p;
      const fresh = JSON.parse(JSON.stringify(t));
      fresh.deadlines = fresh.deadlines.map(d => { const old = (p.deadlines || []).find(x => x.id === d.id); return old && old.byUser && old.date ? { ...d, date: old.date, byUser: true } : d; });
      return { ...fresh, checked: p.checked || {}, active: p.active !== false, updatedAt: Date.now() };
    });
    return s;
  }
};

export function migrate(state) {
  const base = emptyState();
  let s = { ...base, ...state, settings: { ...base.settings, ...(state.settings || {}) }, sync: { ...base.sync, ...(state.sync || {}) } };
  let v = s.schemaVersion || 1;
  while (v < SCHEMA_VERSION) { v++; if (MIGRATIONS[v]) s = MIGRATIONS[v](s); s.schemaVersion = v; }
  return s;
}

export class MemoryAdapter {
  constructor() { this.data = {}; }
  async get(k) { return this.data[k] ? JSON.parse(this.data[k]) : null; }
  async set(k, v) { this.data[k] = JSON.stringify(v); }
  async keys() { return Object.keys(this.data); }
  async del(k) { delete this.data[k]; }
}

export class LocalStorageAdapter {
  constructor(prefix = 'atacoach:') { this.p = prefix; }
  async get(k) { try { const v = localStorage.getItem(this.p + k); return v ? JSON.parse(v) : null; } catch { return null; } }
  async set(k, v) { localStorage.setItem(this.p + k, JSON.stringify(v)); }
  async keys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(this.p)) out.push(k.slice(this.p.length)); } return out; }
  async del(k) { localStorage.removeItem(this.p + k); }
}

export class IndexedDBAdapter {
  constructor(name = 'ata-coach') { this.name = name; this.dbp = null; }
  db() {
    if (!this.dbp) this.dbp = new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.dbp;
  }
  async tx(mode, fn) { const db = await this.db(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const st = t.objectStore('kv'); const out = fn(st); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); }
  async get(k) { const v = await this.tx('readonly', s => s.get(k)); return v ?? null; }
  async set(k, v) { await this.tx('readwrite', s => s.put(v, k)); }
  async keys() { return (await this.tx('readonly', s => s.getAllKeys())) || []; }
  async del(k) { await this.tx('readwrite', s => s.delete(k)); }
}

export async function pickAdapter() {
  try { if (typeof indexedDB !== 'undefined') { const a = new IndexedDBAdapter(); await a.keys(); return a; } } catch { /* fallback */ }
  try { if (typeof localStorage !== 'undefined') { localStorage.setItem('atacoach:test', '1'); localStorage.removeItem('atacoach:test'); return new LocalStorageAdapter(); } } catch { /* fallback */ }
  return new MemoryAdapter();
}

export class Store {
  constructor(adapter) { this.adapter = adapter; this.state = emptyState(); this.listeners = []; this._t = null; }
  async load() { const s = await this.adapter.get('state'); this.state = s ? migrate(s) : emptyState(); return this.state; }
  async save() { await this.adapter.set('state', this.state); await this.snapshot(); }
  saveSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.save().catch(e => console.error('Salvataggio fallito', e)), 300); }
  mutate(fn) { fn(this.state); this.saveSoon(); this.listeners.forEach(l => l(this.state)); }
  onChange(l) { this.listeners.push(l); }
  // Backup automatico: una copia al giorno, tiene le ultime 7.
  async snapshot() {
    const key = 'snap:' + dayKey();
    const keys = (await this.adapter.keys()).filter(k => String(k).startsWith('snap:')).sort();
    if (!keys.includes(key)) { await this.adapter.set(key, this.state); keys.push(key); }
    while (keys.length > 7) await this.adapter.del(keys.shift());
  }
  async listSnapshots() { return (await this.adapter.keys()).filter(k => String(k).startsWith('snap:')).sort().reverse(); }
  async restoreSnapshot(key) { const s = await this.adapter.get(key); if (s) { this.state = migrate(s); await this.adapter.set('state', this.state); } return !!s; }
  exportJSON() { const copy = { ...this.state, settings: { ...this.state.settings, apiKey: '', vapid: null }, sync: { repo: '', token: '', lastSyncAt: null, lastError: null, deviceId: null } }; return JSON.stringify({ app: 'ata-coach', exportedAt: new Date().toISOString(), data: copy }, null, 1); }
  async importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.app !== 'ata-coach' || !parsed.data) throw new Error('Il file non è un backup di ATA Coach.');
    const key = this.state.settings.apiKey, vapid = this.state.settings.vapid, sync = this.state.sync;
    this.state = migrate(parsed.data);
    this.state.sync = sync;
    if (!this.state.settings.apiKey) this.state.settings.apiKey = key;
    if (!this.state.settings.vapid) this.state.settings.vapid = vapid;
    await this.save();
    return this.state;
  }
}
