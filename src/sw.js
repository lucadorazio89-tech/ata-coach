// Service worker: app offline + notifiche push personalizzate con i dati locali.
const CACHE = 'ata-coach-v6';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg', './ui/styles.css', './ui/app.js',
  './core/util.js', './core/store.js', './content/eipass.js', './content/seed.js', './engine/srs.js', './engine/learning.js', './engine/quiz.js',
  './engine/scheduler.js', './engine/reporting.js', './engine/bando.js', './engine/packs.js', './core/sync.js', './ai/ai.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'generativelanguage.googleapis.com' || url.hostname === 'api.github.com') return;
  // feed delle fonti: prima la rete (deve essere fresco), poi la cache
  if (url.origin === location.origin && url.pathname.endsWith('/feed.json')) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  // file dell'app: prima la cache (offline), aggiornata in background
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || /fonts\.g|cdnjs\.cloudflare\.com/.test(url.hostname))) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
      return res;
    }).catch(() => hit || caches.match('./index.html'));
    return hit || net;
  }));
});

function readState() {
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 1500));   // se i dati locali non rispondono, la notifica parte lo stesso
  return Promise.race([timeout, readStateRaw()]);
}
function readStateRaw() {
  return new Promise(resolve => {
    const r = indexedDB.open('ata-coach', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => resolve(null);
    r.onsuccess = () => { try { const g = r.result.transaction('kv', 'readonly').objectStore('kv').get('state'); g.onsuccess = () => resolve(g.result || null); g.onerror = () => resolve(null); } catch { resolve(null); } };
  });
}
const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

self.addEventListener('push', e => {
  let data = {}; try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    let title = data.title || 'ATA Coach', body = data.body || 'Apri ATA Coach.';
    if (data.kind === 'reminder') try {
      const st = await readState(), today = dayKey(Date.now());
      if (st) {
        const mins = (st.sessions || []).filter(s => dayKey(s.startedAt) === today).reduce((a, s) => a + ((s.report && s.report.minutes) || 0), 0);
        const plan = st.nextPlan && st.nextPlan.day === today ? st.nextPlan.line.replace(/^DOMANI/, 'OGGI') : null;
        if (mins > 0) { title = 'Oggi hai già studiato'; body = `${mins} minuti fatti. Brava. Domani si continua.`; }
        else body = plan || 'Hai qualche minuto? Premi Fai tu, decido io cosa studiare.';
        // Scadenza della domanda scritta da Giorgia: negli ultimi 30 giorni il promemoria la ricorda per prima.
        const dl = (st.procedures || []).flatMap(p => (p.active === false ? [] : p.deadlines || []).filter(d => d.date && d.byUser).map(d => ({ ...d, proc: p.name })))
          .map(d => ({ ...d, left: Math.ceil((new Date(d.date + 'T23:59:59').getTime() - Date.now()) / 86400000) })).filter(d => d.left >= 0 && d.left <= 30).sort((a, b) => a.left - b.left)[0];
        if (dl) { title = dl.left === 0 ? `Oggi scade: ${dl.label}` : `Mancano ${dl.left} giorni: ${dl.label}`; body = `${dl.proc}. ` + (mins > 0 ? 'Oggi hai già studiato: pensa solo alla domanda.' : body); }
      }
    } catch { /* uso il testo predefinito */ }
    const important = data.kind === 'bando' || data.kind === 'requisiti';
    await self.registration.showNotification(title, { body, icon: './icon.svg', tag: data.kind || 'ata', renotify: true, requireInteraction: important, vibrate: important ? [300, 120, 300, 120, 300] : undefined, data: { url: data.url || './' } });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
