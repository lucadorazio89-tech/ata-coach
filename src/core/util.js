// Utility condivise. Nessuna dipendenza esterna.
export const DAY = 86400000;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function startOfDay(d = Date.now()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
export function dayKey(d = Date.now()) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
export function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
export function addDays(d, n) { return startOfDay(d) + n * DAY; }

export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export function fmtDate(d) { const x = new Date(d); return x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear(); }
export function fmtShort(d) { const x = new Date(d); return WEEKDAYS[x.getDay()].slice(0, 3) + ' ' + x.getDate(); }
export function fmtMinutes(m) { m = Math.round(m); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function seededRandom(seed = 1) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000000) / 1000000; }; }
export function shuffle(arr, rnd = Math.random) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function normalizeText(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export const sum = a => a.reduce((x, y) => x + y, 0);
export const avg = a => a.length ? sum(a) / a.length : 0;
