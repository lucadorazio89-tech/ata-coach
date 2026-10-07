// Analisi bandi SENZA AI: estrazione a regole. Tutto ciò che estrae è marcato "da verificare".
import { MONTHS, uid } from '../core/util.js';

const SUBJECT_KEYWORDS = {
  ord: ['autonomia', 'ptof', 'organi collegiali', 'consiglio d\'istituto', 'ordinamento scolastico'],
  proc: ['procedimento amministrativo', '241/1990', '241/90', 'accesso agli atti', 'accesso ai documenti'],
  priv: ['privacy', 'protezione dei dati', '679/2016', '2016/679', 'trasparenza', '33/2013'],
  doc: ['protocollo', 'amministrazione digitale', '82/2005', '445/2000', 'firma digitale', 'pec'],
  cont: ['contabilit', '129/2018', 'programma annuale', 'bilancio'],
  pers: ['stato giuridico', 'ccnl', '165/2001', 'rapporto di lavoro', 'graduatori'],
  sic: ['sicurezza', '81/2008', '81/08'],
  info: ['informatic', 'ciad', 'alfabetizzazione digitale', 'office', 'foglio di calcolo', 'videoscrittura']
};
const PROFILES = ['assistente amministrativo', 'assistente tecnico', 'collaboratore scolastico', 'operatore scolastico', 'cuoco', 'infermiere', 'guardarobiere', 'direttore dei servizi generali', 'dsga'];

function parseDates(text) {
  const out = [];
  const re1 = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/g;
  const re2 = new RegExp('\\b(\\d{1,2})\\s+(' + MONTHS.join('|') + ')\\s+(\\d{4})\\b', 'gi');
  let m;
  while ((m = re1.exec(text))) out.push({ index: m.index, raw: m[0], date: new Date(+m[3], +m[2] - 1, +m[1]) });
  while ((m = re2.exec(text))) out.push({ index: m.index, raw: m[0], date: new Date(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]) });
  return out.filter(d => !isNaN(d.date)).sort((a, b) => a.index - b.index).map(d => {
    const ctx = text.slice(Math.max(0, d.index - 90), d.index + d.raw.length + 40).replace(/\s+/g, ' ').trim();
    const isDeadline = /(entro|scadenza|termine|fino al|non oltre|dal .* al)/i.test(ctx);
    const isNorm = /(d\.?\s?lgs|decreto|legge|d\.?p\.?r|d\.?m\.?|n\.\s?\d)/i.test(text.slice(Math.max(0, d.index - 25), d.index));
    return { raw: d.raw, iso: d.date.toISOString().slice(0, 10), context: ctx, kind: isNorm ? 'riferimento normativo' : isDeadline ? 'possibile scadenza' : 'data', verified: false };
  });
}

export function analyzeBandoOffline(text) {
  const low = text.toLowerCase();
  const dates = parseDates(text);
  const profiles = PROFILES.filter(p => low.includes(p));
  const type = /(soli titoli|per titoli|graduatori[ae] di (circolo|istituto))/i.test(text) ? 'titoli'
    : /(prova (scritta|orale|preselettiva)|preselezione|colloquio)/i.test(text) ? 'esame' : 'non determinato';
  const subjects = Object.entries(SUBJECT_KEYWORDS).filter(([, kws]) => kws.some(k => low.includes(k))).map(([s]) => s);
  const requirements = text.split(/\n|(?<=[.;])\s+/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 400 && /(requisit|titolo di studio|diploma|laurea|certificazion|ciad|cittadinanza|et[aà] non inferiore|godimento dei diritti)/i.test(s)).slice(0, 10);
  const links = [...new Set((text.match(/https?:\/\/[^\s)"']+/g) || []))];
  const officialHint = links.some(l => /(mim\.gov\.it|istruzione\.it|gazzettaufficiale\.it|inpa\.gov\.it|usr|normattiva\.it)/i.test(l));
  return {
    id: uid('bando'), analyzedAt: Date.now(), method: 'regole (senza AI)',
    type, profiles, subjects, dates, requirements, links, officialHint,
    warnings: [
      'Estrazione automatica: ogni dato è DA VERIFICARE sul testo ufficiale.',
      ...(dates.filter(d => d.kind === 'possibile scadenza').length === 0 ? ['Nessuna scadenza riconosciuta con certezza.'] : []),
      ...(officialHint ? [] : ['Nel testo non compare un link a una fonte istituzionale (MIM, USR, INPA, Gazzetta Ufficiale).'])
    ]
  };
}
