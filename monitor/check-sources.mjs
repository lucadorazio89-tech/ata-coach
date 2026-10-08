// Controlla le fonti ufficiali e aggiorna src/feed.json. Gira su GitHub Actions (Node 20), nessuna dipendenza.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = s => decode(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// Parole chiave corte (es. "ata") solo come parola intera, per non scattare su "giornata" o "approvata".
const matches = (text, kws) => { const t = text.toLowerCase(); return kws.some(k => { k = k.toLowerCase(); return k.length <= 4 ? new RegExp('(^|[^a-zàèéìòù])' + k + '($|[^a-zàèéìòù])').test(t) : t.includes(k); }); };

// Classifica un titolo: 'bando' (graduatorie ATA terza fascia: uscita, domande, scadenze),
// 'requisiti' (CIAD, contratto che può cambiare i requisiti) o 'notizia' (tutto il resto, senza notifica).
const ATA = /(^|[^a-zàèéìòù])ata($|[^a-zàèéìòù])|personale ata|assistent[ei] amministrativ|collaborator[ei] scolastic/;
export function classify(title) {
  const t = String(title || '').toLowerCase();
  const ata = ATA.test(t);
  if (/(ciad|alfabetizzazione digitale)/.test(t)) return 'requisiti';
  if (/(ccnl|contratto collettivo|ordinamento professionale)/.test(t) && (ata || /(firmat|sottoscritt|ipotesi|definitiv)/.test(t))) return 'requisiti';
  if (ata && /graduatori|terza fascia|iii fascia|circolo e d.istituto/.test(t)) {
    if (/(24 mesi|prima fascia|i fascia|permanent|ruolo|immissioni)/.test(t) && !/(terza fascia|iii fascia|istituto)/.test(t)) return 'notizia';
    if (/(bando|decreto|d\.\s?m\.|dm |domand|istanz|aggiornament|apertura|presentazione|termin|scadenz|avviso|nota |inserimento|triennio|20\d\d)/.test(t)) return 'bando';
  }
  return 'notizia';
}

export function extractLinks(html, baseUrl, keywords) {
  const out = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = clean(m[2]);
    if (title.length < 12 || !matches(title, keywords)) continue;
    let url; try { url = new URL(decode(m[1]), baseUrl).href; } catch { continue; }
    if (!/^https?:/.test(url)) continue;
    if (!out.has(url)) out.set(url, { title: title.slice(0, 220), url });
  }
  return [...out.values()];
}

export function parseRss(xml, keywords) {
  const items = [];
  for (const block of xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []) {
    const title = clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = ((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '').trim();
    const date = ((block.match(/<(pubDate|updated|published)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '').trim();
    if (title && link && matches(title, keywords)) items.push({ title: title.slice(0, 220), url: decode(link), published: date || null });
  }
  return items;
}

export function mergeFeed(prev, fresh, statuses, now = new Date().toISOString()) {
  const known = new Map((prev.items || []).map(i => [i.url, i]));
  const added = [];
  for (const it of fresh) if (!known.has(it.url)) { const n = { ...it, kind: classify(it.title), id: Buffer.from(it.url).toString('base64url').slice(-24), firstSeen: now }; known.set(it.url, n); added.push(n); }
  const items = [...known.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, 200);
  return { feed: { schema: 'ata-coach-feed/1', updatedAt: now, note: 'Link trovati sui siti ufficiali del Ministero e dell\'Ufficio scolastico. Tocca un titolo per aprire la pagina originale.', sources: statuses, items }, added };
}

async function fetchText(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'ATA-Coach-monitor/1.0 (uso personale di studio)', 'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { text: await r.text(), finalUrl: r.url };
  } finally { clearTimeout(t); }
}

const strip = a => JSON.stringify((a || []).map(({ checkedAt, ...r }) => r));

async function main() {
  const cfg = JSON.parse(readFileSync('monitor/sources.json', 'utf8'));
  const feedPath = 'src/feed.json';
  const prev = existsSync(feedPath) ? JSON.parse(readFileSync(feedPath, 'utf8')) : { items: [] };
  const fresh = [], statuses = [];
  for (const s of cfg.sources) {
    const st = { id: s.id, name: s.name, url: s.url, checkedAt: new Date().toISOString() };
    try {
      const { text, finalUrl } = await fetchText(s.url);
      const items = (s.type === 'rss' ? parseRss(text, cfg.keywords) : extractLinks(text, finalUrl, cfg.keywords)).map(i => ({ ...i, source: s.name }));
      fresh.push(...items); st.ok = true; st.found = items.length;
    } catch (e) { st.ok = false; st.error = String(e.message || e); }
    statuses.push(st);
  }
  const firstRun = !(prev.items || []).length;
  const { feed, added } = mergeFeed(prev, fresh, statuses);
  // GitHub disattiva le azioni programmate dopo 60 giorni senza modifiche: ogni 25 giorni salvo un "segno di vita".
  const stale = !prev.heartbeat || Date.now() - new Date(prev.heartbeat).getTime() > 25 * 86400000;
  feed.heartbeat = stale ? feed.updatedAt : prev.heartbeat;
  writeFileSync(feedPath, JSON.stringify(feed, null, 1));
  const news = firstRun ? [] : added;                   // al primo giro non notifica tutto lo storico
  writeFileSync('monitor/.new.json', JSON.stringify(news));
  console.log(`Fonti: ${statuses.filter(s => s.ok).length}/${statuses.length} ok. Nuovi link: ${added.length}${firstRun ? ' (primo giro, nessuna notifica)' : ''}.`);
  statuses.filter(s => !s.ok).forEach(s => console.log(`  ! ${s.name}: ${s.error}`));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_count=${news.length}\nchanged=${added.length > 0 || stale || strip(prev.sources) !== strip(statuses) ? 'true' : 'false'}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
