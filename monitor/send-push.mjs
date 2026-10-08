// Invia notifiche push al telefono/PC di Giorgia. Gira su GitHub Actions; richiede il pacchetto "web-push".
// Segreti: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION (testo copiato dall'app).
import { readFileSync, existsSync } from 'node:fs';
import webpush from 'web-push';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTION, VAPID_SUBJECT = 'mailto:ata-coach@example.invalid', MODE = 'reminder', SITE_URL = './' } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SUBSCRIPTION) { console.log('Notifiche push non configurate: salto.'); process.exit(0); }
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subs = JSON.parse(PUSH_SUBSCRIPTION); if (!Array.isArray(subs)) subs = [subs];
let payload;
if (MODE === 'news') {
  const news = existsSync('monitor/.new.json') ? JSON.parse(readFileSync('monitor/.new.json', 'utf8')) : [];
  // Notifica solo bando e requisiti: le notizie minori restano nell'app senza disturbare.
  const bando = news.filter(n => n.kind === 'bando'), req = news.filter(n => n.kind === 'requisiti');
  if (bando.length) payload = { kind: 'bando', title: '📣 Novità sul bando ATA terza fascia', body: bando[0].title + (bando.length > 1 ? ` (e altri ${bando.length - 1} avvisi)` : '') + ' – Apri l\'app: ti dico cosa fare.', url: SITE_URL + '#bando' };
  else if (req.length) payload = { kind: 'requisiti', title: 'Novità ufficiale su CIAD o contratto', body: req[0].title + ' – Apri l\'app per leggerla.', url: SITE_URL + '#bando' };
  else { console.log(`${news.length} notizie minori: nessuna notifica (sono nell'app).`); process.exit(0); }
} else payload = { kind: 'reminder', title: 'ATA Coach', body: 'È il momento di studiare. Premi Fai tu.', url: SITE_URL };

const fingerprint = s => { try { const u = new URL(s.endpoint); return `${u.hostname} …${s.endpoint.slice(-8)}`; } catch { return 'codice non valido'; } };
let failed = 0;
for (const s of subs) {
  console.log('Invio a:', fingerprint(s));
  try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' }); }
  catch (e) { failed++; console.log('Invio fallito:', e.statusCode || e.message, e.statusCode === 410 ? '(iscrizione scaduta: rifai "Configura le notifiche push" nell\'app)' : ''); }
}
console.log(`Inviate ${subs.length - failed}/${subs.length} notifiche (${MODE}).`);
