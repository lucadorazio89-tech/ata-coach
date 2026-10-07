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
  if (!news.length) { console.log('Nessuna novità.'); process.exit(0); }
  payload = { kind: 'news', title: `ATA Coach: ${news.length} novità dalle fonti ufficiali`, body: news.slice(0, 2).map(n => n.title).join(' · '), url: SITE_URL + '#news' };
} else payload = { kind: 'reminder', title: 'ATA Coach', body: 'È il momento di studiare. Premi Fai tu.', url: SITE_URL };

let failed = 0;
for (const s of subs) {
  try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600 }); }
  catch (e) { failed++; console.log('Invio fallito:', e.statusCode || e.message, e.statusCode === 410 ? '(iscrizione scaduta: rifai "Configura le notifiche push" nell\'app)' : ''); }
}
console.log(`Inviate ${subs.length - failed}/${subs.length} notifiche (${MODE}).`);
