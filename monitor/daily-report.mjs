// Riepilogo serale via email: legge il file di sincronizzazione (repository privato dei progressi)
// e prepara oggetto, versione HTML e versione testo. Uso: node daily-report.mjs <ata-coach-sync.json> <cartella-uscita>
// Gira dentro il repository privato: i dati di Giorgia non passano da repository pubblici e non finiscono nei log.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { emptyState, migrate } from '../src/core/store.js';
import { applyPayload } from '../src/core/sync.js';
import { periodReport, forecast } from '../src/engine/reporting.js';
import { tomorrowLine, studiedMinutesOn } from '../src/engine/scheduler.js';
import { overallMastery, coverage, readinessLabel } from '../src/engine/learning.js';
import { TOPICS, topicById } from '../src/content/seed.js';
import { EIP_MODULES, EIP_LEVELS } from '../src/content/eipass.js';
import { DAY, startOfDay, dayKey, fmtMinutes, fmtDate } from '../src/core/util.js';

const [, , file = 'ata-coach-sync.json', outDir = 'out'] = process.argv;
const now = Date.now();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const giorno = d => new Date(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const ora = d => new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// Livello CIAD «solido»: parte superata con almeno 9 Base su 12 (il margine consigliato nella guida).
export function ciadSummary(state) {
  const sims = state.sessions.filter(s => s.mode === 'eipsim' && s.report?.eip);
  return EIP_MODULES.map(m => {
    const tries = sims.flatMap(s => s.report.eip.parts.filter(p => p.n === m.n).map(p => ({ ...p, day: dayKey(s.startedAt) })));
    const solid = new Set(tries.filter(p => p.passed && p.counts[1].ok >= 9).map(p => p.day));
    const best = tries.reduce((b, p) => Math.max(b, p.level), -1);
    return { n: m.n, name: m.name, tries: tries.length, best, solidDays: solid.size, ready: solid.size >= 2 };
  });
}

export function buildReport(state, meta, at = now) {
  const name = state.user?.name || 'Giorgia';
  const today0 = startOfDay(at);
  const todayAtts = state.attempts.filter(a => a.at >= today0 && a.level !== 'spiegazione');
  const todayOk = todayAtts.filter(a => a.correct).length;
  const todaySessions = state.sessions.filter(s => s.startedAt >= today0);
  const todayMin = studiedMinutesOn(state, at);
  const todayTopics = [...new Set(todayAtts.map(a => a.topic))].map(t => topicById(t)?.name).filter(Boolean);
  const todayErr = state.errors.filter(e => e.at >= today0).length;
  const todaySims = todaySessions.filter(s => s.mode === 'eipsim' && s.report?.eip);
  const w = periodReport(state, 7, at), m = periodReport(state, 30, at);
  const activeDays = r => r.perDay.filter(d => d.minutes > 0).length;
  const om = overallMastery(state, undefined, at);
  const subj = [...w.bySubject].filter(s => s.mastery != null).sort((a, b) => a.mastery - b.mastery);
  const ciad = state.user?.hasCIAD !== 'si' ? ciadSummary(state) : null;
  const deadlines = (state.procedures || []).filter(p => p.active !== false).flatMap(p => (p.deadlines || []).filter(d => d.date).map(d => ({ ...d, proc: p.name, left: Math.ceil((new Date(d.date + 'T23:59:59').getTime() - at) / DAY) }))).filter(d => d.left >= 0).sort((a, b) => a.left - b.left);
  const fc = forecast(state, 0.75, at);
  const tomorrow = tomorrowLine(state, at).replace(/^DOMANI:\s*/, '');
  const syncAt = meta?.updatedAt || null;
  const stale = !syncAt || syncAt < today0;
  const openErrors = state.errors.filter(e => !e.resolved).length;

  const subject = `ATA Coach – ${name}, ${giorno(at)}: ${todayMin ? fmtMinutes(todayMin) + ' di studio' : 'oggi niente studio'}`;

  // ---------- testo ----------
  const L = [];
  L.push(`Riepilogo di ${name} – ${giorno(at)}`, '');
  if (stale) L.push(`Attenzione: l'ultima sincronizzazione è ${syncAt ? `del ${fmtDate(syncAt)} alle ${ora(syncAt)}` : 'assente'}. Lo studio fatto senza connessione comparirà dopo.`, '');
  L.push('OGGI', todayMin ? `${fmtMinutes(todayMin)} in ${todaySessions.length} ${todaySessions.length === 1 ? 'sessione' : 'sessioni'} · ${todayAtts.length} domande, ${todayAtts.length ? Math.round(todayOk / todayAtts.length * 100) + '% giuste' : ''}` : 'Nessuno studio registrato oggi.');
  if (todayTopics.length) L.push('Argomenti: ' + todayTopics.slice(0, 5).join(', '));
  if (todayErr) L.push(todayErr === 1 ? 'Un errore nuovo (tornerà nei ripassi)' : `Errori nuovi: ${todayErr} (torneranno nei ripassi)`);
  for (const s of todaySims) for (const p of s.report.eip.parts) L.push(`Simulazione CIAD – Parte ${p.n}: ${p.passed ? 'superata, livello ' + p.levelName : 'non ancora superata'} (Base ${p.counts[1].ok}/${p.counts[1].n})`);
  L.push('', 'ULTIMI 7 GIORNI', `${fmtMinutes(w.minutes)} · studio in ${activeDays(w)} giorni su 7 · ${w.quiz} domande${w.accuracy != null ? ', ' + pct(w.accuracy) + ' giuste' : ''}`);
  L.push(w.perDay.map(d => `${new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short' })} ${d.minutes}′`).join(' · '));
  if (w.recurringTopics.length) L.push('Più errori su: ' + w.recurringTopics.map(t => `${t.name} (${t.n})`).join(', '));
  L.push('', 'ULTIMI 30 GIORNI', `${fmtMinutes(m.minutes)} · studio in ${activeDays(m)} giorni su 30 · ${m.quiz} domande${m.accuracy != null ? ', ' + pct(m.accuracy) + ' giuste' : ''}`);
  L.push('', 'A CHE PUNTO È', `Preparazione: ${pct(om)} (${readinessLabel(om)}) · programma visto: ${pct(coverage(state))} · errori da sistemare: ${openErrors}`);
  if (subj.length) L.push('Materie più deboli: ' + subj.slice(0, 3).map(s => `${s.name} ${pct(s.mastery)}`).join(' · '));
  if (fc.text) L.push(fc.text);
  if (ciad) {
    L.push('', 'CIAD – SIMULAZIONE EIPASS', `Parti pronte per l'esame (superate due volte con almeno 9 Base su 12): ${ciad.filter(p => p.ready).length} su 7`);
    for (const p of ciad) L.push(`  Parte ${p.n} · ${p.name}: ${p.tries ? (p.best > 0 ? 'migliore livello ' + EIP_LEVELS[p.best] : 'non ancora superata') : 'non ancora provata'}`);
  }
  if (deadlines.length) { L.push('', 'SCADENZE'); for (const d of deadlines.slice(0, 3)) L.push(`  ${d.label} (${d.proc}): ${fmtDate(d.date)} – ${d.left === 0 ? 'scade oggi' : 'mancano ' + d.left + ' giorni'}`); }
  L.push('', 'DOMANI', tomorrow, '', '— ATA Coach (email automatica, ogni sera)');
  const text = L.join('\n');

  // ---------- HTML ----------
  const INK = '#2C3A92', MUTED = '#5A6080', MARK = '#FFE45E';
  const sec = (title, inner) => `<tr><td style="padding:18px 0 4px"><div style="font:700 13px/1 Arial,sans-serif;letter-spacing:.06em;color:${INK};text-transform:uppercase">${title}</div></td></tr><tr><td style="font:15px/1.5 Arial,sans-serif;color:#1D2242">${inner}</td></tr>`;
  const maxMin = Math.max(30, ...w.perDay.map(d => d.minutes));
  const bars = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>${w.perDay.map(d => `<td style="vertical-align:bottom;padding:0 4px;text-align:center"><div style="width:26px;height:${Math.max(3, Math.round(d.minutes / maxMin * 70))}px;background:${d.minutes ? INK : '#D8DCEA'};border-radius:4px 4px 0 0"></div><div style="font:11px Arial,sans-serif;color:${MUTED};padding-top:3px">${new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short' }).slice(0, 3)}</div><div style="font:11px Arial,sans-serif;color:${MUTED}">${d.minutes}′</div></td>`).join('')}</tr></table>`;
  const bigNum = (v, l) => `<td style="padding-right:18px;vertical-align:top"><div style="font:700 22px/1.15 Arial,sans-serif;color:#1D2242;white-space:nowrap">${v}</div><div style="font:12px Arial,sans-serif;color:${MUTED}">${l}</div></td>`;
  const html = `<!doctype html><html lang="it"><body style="margin:0;background:#F5F6FA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;padding:22px">
<tr><td style="font:700 13px Arial,sans-serif;color:${INK}">ATA Coach</td></tr>
<tr><td style="font:700 24px/1.25 Arial,sans-serif;color:#1D2242;padding-top:4px">Riepilogo di ${esc(name)}</td></tr>
<tr><td style="font:15px Arial,sans-serif;color:${MUTED};padding-bottom:4px">${esc(giorno(at))}</td></tr>
${stale ? `<tr><td style="background:#FBE9E7;border-left:4px solid #A3261D;padding:10px 12px;font:14px/1.4 Arial,sans-serif;color:#1D2242;border-radius:6px">Ultima sincronizzazione ${syncAt ? `del ${esc(fmtDate(syncAt))} alle ${ora(syncAt)}` : 'assente'}: lo studio fatto senza connessione comparirà nel prossimo riepilogo.</td></tr>` : ''}
${sec('Oggi', todayMin
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${bigNum(fmtMinutes(todayMin), 'di studio')}${bigNum(todayAtts.length, 'domande')}${bigNum(todayAtts.length ? Math.round(todayOk / todayAtts.length * 100) + '%' : '—', 'giuste')}</tr></table>
       ${todayTopics.length ? `<p style="margin:8px 0 0">Argomenti: ${esc(todayTopics.slice(0, 5).join(', '))}</p>` : ''}
       ${todayErr ? `<p style="margin:4px 0 0;color:${MUTED}">${todayErr === 1 ? 'Un errore nuovo: tornerà' : todayErr + ' errori nuovi: torneranno'} nei ripassi.</p>` : ''}
       ${todaySims.flatMap(s => s.report.eip.parts).map(p => `<p style="margin:6px 0 0">Simulazione CIAD – <b>Parte ${p.n}</b>: ${p.passed ? `✅ superata, livello <b>${esc(p.levelName)}</b>` : '❌ non ancora superata'} <span style="color:${MUTED}">(Base ${p.counts[1].ok}/${p.counts[1].n})</span></p>`).join('')}`
    : `<p style="margin:0">Nessuno studio registrato oggi. Domani bastano anche 5 minuti per non interrompere la catena.</p>`)}
${sec('Ultimi 7 giorni', `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${bigNum(fmtMinutes(w.minutes), 'in totale')}${bigNum(activeDays(w) + '/7', 'giorni di studio')}${bigNum(pct(w.accuracy), 'risposte giuste')}</tr></table>${bars}
   ${w.recurringTopics.length ? `<p style="margin:8px 0 0;color:${MUTED}">Più errori su: ${esc(w.recurringTopics.map(t => `${t.name} (${t.n})`).join(', '))}</p>` : ''}`)}
${sec('Ultimi 30 giorni', `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${bigNum(fmtMinutes(m.minutes), 'in totale')}${bigNum(activeDays(m) + '/30', 'giorni di studio')}${bigNum(m.quiz, 'domande')}</tr></table>`)}
${sec('A che punto è', `<p style="margin:0">Preparazione <b>${pct(om)}</b> (${esc(readinessLabel(om))}) · programma visto <b>${pct(coverage(state))}</b> · errori da sistemare <b>${openErrors}</b></p>
   ${subj.length ? `<p style="margin:6px 0 0">Materie più deboli: ${esc(subj.slice(0, 3).map(s => `${s.name} ${pct(s.mastery)}`).join(' · '))}</p>` : ''}
   ${fc.text ? `<p style="margin:6px 0 0;color:${MUTED}">${esc(fc.text)}</p>` : ''}`)}
${ciad ? sec('CIAD – simulazione EIPASS', `<p style="margin:0">Parti pronte per l'esame: <b>${ciad.filter(p => p.ready).length} su 7</b> <span style="color:${MUTED}">(superate in due giorni diversi con almeno 9 domande Base giuste su 12)</span></p>
   <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px">${ciad.map(p => `<tr><td style="padding:2px 10px 2px 0;font:14px Arial,sans-serif;white-space:nowrap;vertical-align:top">${p.ready ? '✅' : p.best > 0 ? '🟡' : '⚪'} Parte ${p.n}</td><td style="font:14px Arial,sans-serif;color:${MUTED};padding:2px 0">${esc(p.name)} – ${p.tries ? (p.best > 0 ? 'migliore: ' + EIP_LEVELS[p.best] : 'non ancora superata') : 'non ancora provata'}</td></tr>`).join('')}</table>`) : ''}
${deadlines.length ? sec('Scadenze', deadlines.slice(0, 3).map(d => `<p style="margin:0 0 4px"><b>${esc(d.label)}</b> (${esc(d.proc)}): ${esc(fmtDate(d.date))} – <b>${d.left === 0 ? 'scade oggi' : 'mancano ' + d.left + ' giorni'}</b></p>`).join('')) : ''}
<tr><td style="padding-top:20px"><div style="border:2px solid ${INK};border-radius:8px;padding:12px 14px;transform:rotate(-0.6deg)"><div style="font:12px Arial,sans-serif;color:${INK}">Domani</div><div style="font:700 16px/1.4 Arial,sans-serif;color:${INK}">${esc(tomorrow)}</div></div></td></tr>
<tr><td style="font:12px Arial,sans-serif;color:${MUTED};padding-top:18px">Email automatica di ATA Coach, inviata ogni sera con i dati sincronizzati.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// ---------- esecuzione ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  let state = emptyState(), meta = null, missing = false;
  if (existsSync(file)) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.app !== 'ata-coach') throw new Error('Il file non è di ATA Coach.');
    meta = data.meta; state = migrate(state); applyPayload(state, data.payload || {});
  } else missing = true;
  const r = missing
    ? { subject: 'ATA Coach – riepilogo non disponibile', text: 'Nel repository dei progressi non c\'è ancora il file di sincronizzazione: l\'app non ha mai sincronizzato.', html: '<p>Nel repository dei progressi non c\'è ancora il file di sincronizzazione: l\'app non ha mai sincronizzato.</p>' }
    : buildReport(state, meta);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/riepilogo.html`, r.html); writeFileSync(`${outDir}/riepilogo.txt`, r.text);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `subject=${r.subject.replace(/\n/g, ' ')}\n`);
  console.log('Riepilogo pronto.'); // niente dati personali nel log
}
