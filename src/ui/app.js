// UI di ATA Coach. Nessun framework: stringhe HTML + delega eventi. Tutta la logica sta negli engine.
import { DAY, dayKey, fmtDate, fmtShort, fmtMinutes, escapeHtml, uid, WEEKDAYS, startOfDay, seededRandom, shuffle } from '../core/util.js';
import { Store, pickAdapter, emptyState } from '../core/store.js';
import { SUBJECTS, TOPICS, LESSONS, GOALS, SOURCES, PROCEDURE_TEMPLATES, CONTENT_VERSION, OPEN_QUESTIONS, topicById, subjectById, lessonForTopic, sourceById } from '../content/seed.js';
import { ERROR_TYPES, allQuestions, questionById, recordAttempt, recordOpenAnswer, markLessonRead, getStat, mastery, topicSnapshot, overallMastery, coverage, readinessLabel, recordHistory } from '../engine/learning.js';
import { pickQuestions, diagnosticQuestions, simulationQuestions, gradeOpenOffline } from '../engine/quiz.js';
import { buildSession, tomorrowLine, recoveryInfo, projectCalendar, suggestedMinutesToday, studiedMinutesOn, planStats, daysToExam } from '../engine/scheduler.js';
import { sessionReport, periodReport, procedureReport, shareText } from '../engine/reporting.js';
import { analyzeBandoOffline } from '../engine/bando.js';
import { AIService } from '../ai/ai.js';
import { validatePack, exportPack, acceptAIQuestions } from '../engine/packs.js';
import { GitHubSync, syncNow, encodeLink, decodeLink, validRepo } from '../core/sync.js';

const esc = escapeHtml;
let store, ai, view = { name: 'home', params: {} }, ui = {}, run = null, timerId = null, feed = null;
const ONLINE_APP = typeof location !== 'undefined' && location.protocol.startsWith('http') && !window.__SINGLE_FILE__;
const S = () => store.state;
const $app = () => document.getElementById('app');

// ---------- helpers di presentazione ----------
const md = t => t.split('\n\n').map(p => `<p>${esc(p).replace(/==(.+?)==/g, '<mark>$1</mark>')}</p>`).join('');
const pct = x => Math.round((x || 0) * 100) + '%';
const bar = (x, label = '') => `<div class="bar" role="img" aria-label="${esc(label)} ${pct(x)}"><span style="width:${pct(x)}"></span></div>`;
const statusPill = st => `<span class="pill pill-${st.replace(/\s/g, '-')}">${esc(st)}</span>`;
function sourceChip(id) {
  const s = id && sourceById(id); if (!s) return '';
  const checked = S().sourceChecks?.[s.id];
  const ver = s.status === 'da_verificare' ? ' <strong class="verify">DA VERIFICARE</strong>' : checked ? ` <small>(verificata il ${fmtDate(checked)})</small>` : '';
  const t = esc(s.title) + ver;
  return `<p class="source">Fonte: ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${t}</a>` : t}${s.official ? '' : ' (fonte non ufficiale)'}</p>`;
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status'); document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }
function go(name, params = {}) { view = { name, params }; ui = {}; render(); window.scrollTo(0, 0); }
function render() { clearInterval(timerId); const fn = VIEWS[view.name] || VIEWS.home; $app().innerHTML = fn(view.params); afterRender(); }
function afterRender() {
  if (view.name === 'run' && run?.timeLimit) {
    const tick = () => { const left = run.startedAt + run.timeLimit - Date.now(); const el = document.getElementById('timer'); if (el) el.textContent = left > 0 ? Math.ceil(left / 60000) + ' min' : 'tempo scaduto'; if (left <= 0) { clearInterval(timerId); finishRun(); } };
    tick(); timerId = setInterval(tick, 5000);
  }
  const focus = document.querySelector('[data-autofocus]'); if (focus) focus.focus();
}
const back = (to = 'home', label = 'Indietro') => `<button class="link back" data-act="go" data-to="${to}">← ${label}</button>`;

// ---------- sincronizzazione tra dispositivi ----------
let syncing = false, syncTimer = null;
const syncOn = () => { const x = S().sync || {}; return !!(x.repo && x.token); };
const hm = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
async function runSync() {
  if (!syncOn() || syncing) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  syncing = true; clearTimeout(syncTimer); syncTimer = null;
  try {
    const gh = new GitHubSync({ token: S().sync.token, repo: S().sync.repo });
    const hadUser = !!S().user;
    const r = await syncNow(store.state, gh, { save: () => store.save() });
    if (!hadUser && S().user && view.name === 'onboarding') go('home');
    else if (view.name !== 'run' && (r.changedLocal || ['home', 'settings'].includes(view.name))) render();
    return r;
  } catch (e) {
    store.state.sync.lastError = { code: e.code || 'errore', msg: e.message || String(e), at: Date.now() };
    await store.save();
    if (view.name === 'home' || view.name === 'settings') render();
    return null;
  } finally { syncing = false; }
}
function syncSoon(ms = 45000) { if (!syncOn()) return; clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
function syncStatusText() {
  const x = S().sync; if (!syncOn()) return '';
  if (syncing) return 'Sincronizzazione in corso…';
  if (x.lastError && (!x.lastSyncAt || x.lastError.at > x.lastSyncAt)) return x.lastError.code === 'offline' ? 'Senza connessione: sincronizzo appena torna internet.' : 'Sincronizzazione non riuscita: ' + x.lastError.msg;
  return x.lastSyncAt ? `Sincronizzato ${dayKey(x.lastSyncAt) === dayKey() ? 'oggi' : 'il ' + fmtDate(x.lastSyncAt)} alle ${hm(x.lastSyncAt)}` : '';
}
async function linkDevice(repo, token) {
  if (!validRepo(repo)) { toast('Il nome del repository deve essere nel formato utente/nome.'); return false; }
  if (!token || token.length < 20) { toast('La chiave sembra incompleta: copiala di nuovo da GitHub.'); return false; }
  store.state.sync = { ...store.state.sync, repo: repo.trim(), token: token.trim(), lastError: null };
  await store.save(); ui.syncMsg = 'Collegamento in corso…'; render();
  const r = await runSync();
  ui.syncMsg = r ? (r.pulled ? 'Collegato: progressi uniti con quelli già salvati.' : 'Collegato: primo salvataggio fatto.') : 'Non riuscito: ' + (S().sync.lastError?.msg || 'errore sconosciuto');
  if (!r) { store.state.sync.token = ''; await store.save(); }
  if (view.name !== 'home') render();
  return !!r;
}

// ---------- feed delle fonti ufficiali ----------
function newFeedItems(st) { if (!feed?.items?.length) return []; return feed.items.filter(i => !st.feedSeen || i.firstSeen > st.feedSeen); }
async function loadFeed() {
  if (!ONLINE_APP) return;
  try { const r = await fetch('./feed.json', { cache: 'no-cache' }); if (r.ok) { feed = await r.json(); if (view.name === 'home') render(); } } catch { /* offline: nessuna novità */ }
}

// ---------- avvisi automatici ----------
function computeNotices(st) {
  const out = [];
  if (st.user?.hasCIAD === 'no') out.push({ kind: 'urgent', text: 'Ti manca la CIAD. Nel bando 2024 era un requisito di accesso per l\'assistente amministrativo: senza, la domanda veniva esclusa. Va presa prima della scadenza del prossimo bando.', act: 'openProc', id: 'p_ciad' });
  if (st.user?.hasCIAD === 'nonso') out.push({ kind: 'urgent', text: 'Verifica se hai già una certificazione informatica valida come CIAD (ente accreditato). È il punto più importante per il bando 2027.', act: 'openProc', id: 'p_ciad' });
  const dte = daysToExam(st); if (dte != null && dte <= 30) out.push({ kind: 'urgent', text: `Mancano ${dte} giorni alla prossima scadenza che hai inserito.`, act: 'go', to: 'bandi' });
  for (const p of st.procedures) if (!p.verified) { out.push({ kind: 'info', text: `${p.name}: date e requisiti non ancora ufficiali (DA VERIFICARE).`, act: 'openProc', id: p.id }); break; }
  const sx = st.sync || {};
  if (syncOn() && sx.lastError && ['auth', 'repo', 'data', 'config'].includes(sx.lastError.code) && (!sx.lastSyncAt || sx.lastError.at > sx.lastSyncAt)) out.push({ kind: 'urgent', text: 'La sincronizzazione tra dispositivi è ferma: ' + sx.lastError.msg, act: 'go', to: 'settings' });
  const fresh = newFeedItems(st); if (fresh.length) out.push({ kind: 'urgent', text: `${fresh.length} novità dalle fonti ufficiali (Ministero/USR). Controlla se riguardano il tuo bando.`, act: 'go', to: 'news' });
  if (st.sessions.length >= 3 && (!st.lastBackupAt || Date.now() - st.lastBackupAt > 14 * DAY)) out.push({ kind: 'info', text: 'Non salvi una copia dei progressi da più di due settimane.', act: 'go', to: 'settings' });
  return out;
}

function maybeSystemNotification() {
  const st = S(); if (!st.settings.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const h = new Date().getHours(), k = dayKey();
  if (h >= (st.user?.notifyHour ?? 18) && studiedMinutesOn(st) === 0 && st.settings.lastNotified !== k) {
    try { new Notification('ATA Coach', { body: tomorrowLine(st, Date.now() - DAY).replace('DOMANI', 'OGGI') }); } catch { /* alcuni browser richiedono il service worker */ }
    store.mutate(s => { s.settings.lastNotified = k; });
  }
}

// ---------- utilità file, appunti, chiavi ----------
async function copyText(t, okMsg) { try { await navigator.clipboard.writeText(t); toast(okMsg); } catch { prompt('Copia il testo:', t); } }
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = new Promise((res, rej) => {
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    const sc = document.createElement('script'); sc.src = base + 'pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; res(window.pdfjsLib); };
    sc.onerror = () => { pdfjsPromise = null; rej(new Error('Per leggere i PDF serve la connessione la prima volta.')); };
    document.head.appendChild(sc);
  });
  return pdfjsPromise;
}
async function pdfToText(file) {
  const lib = await loadPdfJs(); const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise; let out = '';
  for (let i = 1; i <= Math.min(doc.numPages, 80); i++) { const c = await (await doc.getPage(i)).getTextContent(); out += c.items.map(it => it.str).join(' ').replace(/\s+/g, ' ') + '\n\n'; }
  return out.trim();
}
const fileToBase64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
async function imageToBase64(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85).split(',')[1]; } finally { URL.revokeObjectURL(url); }
}
// Legge testo, PDF (sul dispositivo) e foto/PDF scansionati (con l'AI). Ritorna il testo o null.
async function readAnyFile(f) {
  const setMsg = m => { ui.reading = m; render(); };
  try {
    if (/^text\//.test(f.type) || /\.txt$/i.test(f.name)) { ui.reading = null; return await f.text(); }
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      setMsg('Leggo il PDF…');
      let t = ''; try { t = await pdfToText(f); } catch (e) { if (S().settings.aiMode !== 'on') { setMsg(e.message); return null; } }
      if (t.length > 200) { ui.reading = `PDF letto: ${t.length} caratteri.`; return t; }
      if (S().settings.aiMode !== 'on') { setMsg('Il PDF sembra una scansione: per leggerlo attiva l\'AI nelle impostazioni.'); return null; }
      if (f.size > 15e6) { setMsg('PDF troppo grande per la lettura con AI (massimo 15 MB).'); return null; }
      setMsg('PDF scansionato: lo leggo con l\'AI…');
      const r = await ai.run('readFile', {}, { mimeType: 'application/pdf', data: await fileToBase64(f) });
      if (r.ok) { ui.reading = 'Testo letto con l\'AI: controllalo, può contenere errori.'; return r.text; }
      setMsg('Lettura non riuscita: ' + r.reason); return null;
    }
    if (/^image\//.test(f.type)) {
      if (S().settings.aiMode !== 'on') { setMsg('Per leggere una foto serve l\'AI: attivala nelle impostazioni.'); return null; }
      setMsg('Leggo la foto con l\'AI…');
      const r = await ai.run('readFile', {}, { mimeType: 'image/jpeg', data: await imageToBase64(f) });
      if (r.ok) { ui.reading = 'Testo letto dalla foto: controllalo, può contenere errori.'; return r.text; }
      setMsg('Lettura non riuscita: ' + r.reason); return null;
    }
    setMsg('Formato non supportato. Usa testo, PDF o una foto.'); return null;
  } catch (e) { setMsg('Errore nella lettura del file: ' + (e.message || e)); return null; }
}
const bytesToB64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBytes = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: bytesToB64u(raw), privateKey: jwk.d };
}

// ---------- sessione ----------
function masteryMap() { const m = {}; for (const t of TOPICS) m[t.id] = mastery(S().topicStats[t.id]); return m; }
function stepsFromPlan(plan) {
  const steps = [];
  for (const b of plan.blocks) {
    if (b.kind === 'review' || b.kind === 'quiz') for (const qid of b.qids) steps.push({ t: 'mc', qid, block: b.kind });
    if (b.kind === 'lesson') steps.push({ t: 'lesson', lessonId: b.lessonId });
    if (b.kind === 'open') steps.push({ t: 'open', qid: b.qid });
  }
  return steps;
}
function startRun(plan, opts = {}) {
  const steps = opts.steps || stepsFromPlan(plan);
  if (!steps.length) { toast(opts.emptyMsg || 'Niente da fare qui adesso.'); return; }
  // le opzioni si mescolano ogni volta: la posizione della risposta giusta non deve aiutare a indovinare
  for (const st of steps) if (st.t === 'mc' && !st.order) { const q = questionById(S(), st.qid); if (q) st.order = shuffle(q.options.map((_, i) => i)); }
  run = { id: plan.id || uid('s'), plan: { minutes: plan.minutes, why: plan.why || [], focusTopic: plan.focusTopic || null }, steps, i: 0, mode: opts.mode || plan.mode || 'auto', exam: !!opts.exam, diagnostic: !!opts.diagnostic, procedure: opts.procedure || null, startedAt: Date.now(), stepStart: Date.now(), before: masteryMap(), lessons: [], answered: null, unsure: false, timeLimit: opts.exam ? steps.length * 60000 : null };
  store.mutate(s => { s.current = run; if (run.mode === 'auto') s.plans[dayKey()] = { createdAt: Date.now(), minutes: plan.minutes, focusTopic: plan.focusTopic, why: plan.why }; });
  go('run');
}
function startAuto(minutes, mode = 'auto') { startRun(buildSession(S(), minutes, { mode })); }
function nextStep() {
  run.i++; run.answered = null; run.unsure = false; run.stepStart = Date.now(); ui = {};
  store.mutate(s => { s.current = run; });
  if (run.i >= run.steps.length) finishRun(); else { render(); window.scrollTo(0, 0); }
}
function finishRun() {
  clearInterval(timerId);
  const session = { id: run.id, mode: run.mode, procedure: run.procedure, startedAt: run.startedAt, endedAt: Date.now(), lessons: run.lessons, plan: run.plan, diagnostic: run.diagnostic };
  store.mutate(s => { session.report = sessionReport(s, session, run.before); s.sessions.push(session); recordHistory(s); s.current = null; s.nextPlan = { day: dayKey(Date.now() + DAY), line: session.report.tomorrow }; });
  run = null; go('report', { id: session.id }); syncSoon(2000);
}

// ---------- VIEWS ----------
const VIEWS = {};

VIEWS.onboarding = () => {
  const step = ui.ob || 1, d = ui.obData || (ui.obData = { name: '', goal: 'lavoro', hasCIAD: 'nonso', minutes: 30, weekend: false });
  const head = `<header class="ob-head"><p class="brand">ATA Coach</p><p class="step">Passo ${step} di 4</p></header>`;
  if (step === 1) return `<main class="wrap ob">${head}<h1>Ciao. Da qui in poi organizzo io.</h1><p class="lead">Tu studi e rispondi alle domande. Piano, ripassi, scadenze e report li gestisco io.</p>
    <label class="field">Come ti chiami?<input id="ob-name" value="${esc(d.name)}" autocomplete="given-name" data-autofocus></label>
    <button class="btn primary" data-act="obNext">Avanti</button>
    <details class="today"><summary>Usi già ATA Coach su un altro dispositivo?</summary>
      <p>Sull'altro dispositivo apri Impostazioni → Sincronizzazione → «Collega un altro dispositivo» e copia il codice. Incollalo qui:</p>
      <textarea id="link-code" rows="3"></textarea><button class="btn" data-act="linkCode">Collega e scarica i progressi</button>
      ${ui.syncMsg ? `<p class="notice">${esc(ui.syncMsg)}</p>` : ''}</details></main>`;
  if (step === 2) return `<main class="wrap ob">${head}<h1>Qual è il tuo obiettivo principale?</h1>
    <div class="choices">${GOALS.map(g => `<button class="choice ${d.goal === g.id ? 'on' : ''}" data-act="obSet" data-k="goal" data-v="${g.id}" aria-pressed="${d.goal === g.id}">${esc(g.label)}</button>`).join('')}</div>
    <h2>Hai già la CIAD?</h2><p class="muted">La certificazione di alfabetizzazione digitale richiesta nel bando 2024.</p>
    <div class="choices row">${[['si', 'Sì'], ['no', 'No'], ['nonso', 'Non so']].map(([v, l]) => `<button class="choice ${d.hasCIAD === v ? 'on' : ''}" data-act="obSet" data-k="hasCIAD" data-v="${v}" aria-pressed="${d.hasCIAD === v}">${l}</button>`).join('')}</div>
    <button class="btn primary" data-act="obNext">Avanti</button></main>`;
  if (step === 3) return `<main class="wrap ob">${head}<h1>Quanto tempo hai, di solito?</h1><p class="lead">Meglio poco ma tutti i giorni. Potrai cambiarlo quando vuoi.</p>
    <div class="choices row">${[15, 20, 30, 45, 60].map(m => `<button class="choice ${d.minutes === m ? 'on' : ''}" data-act="obSet" data-k="minutes" data-v="${m}" aria-pressed="${d.minutes === m}">${m} min</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="ob-weekend" ${d.weekend ? 'checked' : ''}> Studio anche nel weekend</label>
    <button class="btn primary" data-act="obNext">Avanti</button></main>`;
  return `<main class="wrap ob">${head}<h1>Ultimo passo: un test per capire da dove partire.</h1><p class="lead">Una domanda per argomento, circa ${TOPICS.length}: sette minuti. Non è un voto. Se non sai una risposta, premi «Non lo so»: mi aiuta più di una risposta a caso.</p>
    <button class="btn primary" data-act="obFinish">Inizia il test</button></main>`;
};

VIEWS.home = () => {
  const st = S(), name = st.user?.name || '';
  const mins = suggestedMinutesToday(st), done = studiedMinutesOn(st), rec = recoveryInfo(st);
  const preview = buildSession(st, mins, { rnd: seededRandom(startOfDay()) });
  const ps = planStats(st, preview);
  const notices = computeNotices(st);
  const openErrors = st.errors.filter(e => !e.resolved).length;
  return `<main class="wrap home">
    <header class="top"><div><p class="brand">ATA Coach</p><h1>Ciao${name ? ' ' + esc(name) : ''}.</h1></div>
      <button class="icon" data-act="go" data-to="settings" aria-label="Impostazioni">⚙︎</button></header>
    ${rec ? `<p class="notice">${esc(rec.message)}</p>` : ''}
    ${done ? `<p class="done-today">Oggi hai già studiato ${fmtMinutes(done)}. ${done >= mins ? 'Obiettivo raggiunto.' : ''}</p>` : ''}
    ${st.current ? `<button class="btn continue" data-act="resume">Continua da dove eri <small>${st.current.i} di ${st.current.steps.length} fatti</small></button>` : ''}
    <button class="fai-tu" data-act="auto" data-min="${mins}"><span class="ft-label">Fai tu</span><span class="ft-sub">${mins} minuti. Decido io cosa studiare.</span></button>
    <p class="time-k">Ho solo:</p><div class="time-row" role="group" aria-label="Ho solo poco tempo">${[10, 20, 30, 45, 60].map(m => `<button class="chip" data-act="auto" data-min="${m}">${m}′</button>`).join('')}</div>
    <button class="btn lazy" data-act="lazy">Non ho voglia: solo 5 minuti</button>
    <details class="today"><summary>Cosa devo fare oggi?</summary>
      <ul>${preview.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="muted">${ps.lessons ? 'Una lezione breve, ' : ''}${ps.mc} domande${ps.open ? ', una domanda a risposta aperta' : ''}.</p></details>
    ${notices.length ? `<section class="notices" aria-label="Avvisi">${notices.map(n => `<button class="notice-item ${n.kind}" data-act="${n.act}" data-to="${n.to || ''}" data-id="${n.id || ''}">${esc(n.text)}</button>`).join('')}</section>` : ''}
    <nav class="more" aria-label="Altre attività">
      <button data-act="go" data-to="tests">Fammi un test</button>
      <button data-act="errors">Ripassa i miei errori${openErrors ? ` <b>${openErrors}</b>` : ''}</button>
      <button data-act="go" data-to="progress">Come sono messa?</button>
      <button data-act="go" data-to="bandi">Bandi e scadenze</button>
      <button data-act="go" data-to="lessons">Lezioni</button>
      <button data-act="go" data-to="calendar">Calendario</button>
    </nav>
    <aside class="stamp" aria-label="Piano di domani"><span class="stamp-k">Prossimo appuntamento</span><span class="stamp-v">${esc(tomorrowLine(st))}</span></aside>
    ${syncOn() ? `<p class="sync-line">${esc(syncStatusText())}</p>` : ''}
  </main>`;
};

function runHeader() {
  const n = run.steps.length, i = Math.min(run.i + 1, n);
  return `<header class="run-head"><button class="link" data-act="exitRun">Esci (salvo dove sei)</button>
    <span class="run-count">${run.exam ? `<span id="timer" aria-live="polite"></span> · ` : ''}${i} di ${n}</span></header>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${run.i}"><span style="width:${(run.i / n) * 100}%"></span></div>`;
}

VIEWS.run = () => {
  if (!run) return VIEWS.home();
  const step = run.steps[run.i];
  if (step.t === 'lesson') return `<main class="wrap run">${runHeader()}${lessonHtml(LESSONS.find(l => l.id === step.lessonId), true)}</main>`;
  if (step.t === 'open') return `<main class="wrap run">${runHeader()}${openHtml(questionById(S(), step.qid))}</main>`;
  return `<main class="wrap run">${runHeader()}${mcHtml(questionById(S(), step.qid), step)}</main>`;
};

function mcHtml(q, step) {
  const a = run.answered, t = topicById(q.topic);
  const order = step.order || q.options.map((_, i) => i);
  const opts = order.map((i, di) => {
    let cls = 'opt';
    if (a && !run.exam) { if (i === q.answer) cls += ' right'; else if (i === a.chosen) cls += ' wrong'; }
    return `<button class="${cls}" data-act="answer" data-i="${di}" ${a ? 'disabled' : ''}><span class="opt-k">${'ABCDE'[di]}</span>${esc(q.options[i])}</button>`;
  }).join('');
  let fb = '';
  if (a && !run.exam) {
    const lesson = lessonForTopic(q.topic);
    const err = a.errorId ? S().errors.find(e => e.id === a.errorId) : null;
    fb = `<section class="feedback ${a.correct ? 'ok' : 'ko'}" aria-live="polite">
      <p class="verdict">${a.correct ? (run.unsure ? 'Giusta, anche se non eri sicura.' : 'Giusta.') : a.dontKnow ? 'Nessun problema, ora la impari.' : 'Non è questa.'}</p>
      <p>${esc(q.explanation)}</p>${sourceChip(q.source)}
      ${q.quote ? `<p class="source">Dal testo: «${esc(q.quote)}»${q.sourceNote ? ` – ${esc(q.sourceNote)}` : ''}</p>` : q.sourceNote ? `<p class="source">Fonte indicata: ${esc(q.sourceNote)}</p>` : ''}
      ${err ? `<div class="why">${ui.whyOpen ? `<p class="why-q">Perché è andata così?</p>
        <div class="chips">${Object.entries(ERROR_TYPES).map(([k, l]) => `<button class="chip small ${(err.userType || err.type) === k ? 'on' : ''}" data-act="errType" data-k="${k}">${esc(l)}</button>`).join('')}</div>`
        : `<p class="small muted">Probabile causa: ${esc(ERROR_TYPES[err.userType || err.type])}. <button class="link" data-act="whyOpen">Non è così</button></p>`}</div>` : ''}
      ${ui.help ? helpHtml(lesson) : `<button class="link" data-act="help">Non ho capito</button>`}
      <button class="btn primary" data-act="next" data-autofocus>Avanti</button>
      <button class="link small" data-act="reportQ" data-q="${q.id}">Segnala un errore in questa domanda</button></section>`;
  }
  return `<p class="crumb">${esc(t.name)}${step.block === 'review' ? ' · ripasso' : ''}</p>
    <h2 class="qtext">${esc(q.text)}</h2>
    ${q.origin !== 'content-pack' ? '<p class="verify">Domanda generata o importata: DA VERIFICARE</p>' : ''}
    <div class="opts">${opts}</div>
    ${a ? '' : `<div class="pre"><button class="chip ${run.unsure ? 'on' : ''}" data-act="unsure" aria-pressed="${run.unsure}">Non sono sicura</button><button class="link" data-act="dontKnow">Non lo so</button></div>`}
    ${fb}`;
}

function helpHtml(lesson) {
  if (!lesson) return '';
  return `<div class="help"><p><strong>Detto semplice:</strong> ${esc(lesson.simple)}</p><ul>${lesson.keyPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul>
    ${ui.aiText ? `<p class="ai-text">${esc(ui.aiText)}</p>` : S().settings.aiMode === 'on' ? `<button class="link" data-act="aiExplain" data-lesson="${lesson.id}">Spiegamelo in un altro modo (AI)</button>` : ''}</div>`;
}

function lessonHtml(l, inRun) {
  const t = topicById(l.topic);
  return `<article class="lesson"><p class="crumb">${esc(subjectById(t.subject).name)} · lezione di ${l.minutes} minuti</p><h2>${esc(t.name)}</h2>
    ${md(l.body)}
    <div class="example"><p class="ex-k">In segreteria</p><p>${esc(l.example)}</p></div>
    <h3>Da ricordare</h3><ul class="keys">${l.keyPoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul>
    ${l.sources.map(sourceChip).join('')}
    ${ui.help ? helpHtml(l) : ''}
    ${ui.nothing ? `<p class="notice">Va bene così. Domani ripasso questi tre punti con domande facili, e la lezione resta nel tuo elenco.</p>` : ''}
    <div class="actions">
      <button class="btn primary" data-act="${inRun ? 'lessonDone' : 'lessonDoneLib'}" data-id="${l.id}" data-ok="1">Ho capito</button>
      ${ui.help ? '' : `<button class="btn" data-act="help">Non ho capito</button>`}
      ${ui.nothing ? `<button class="btn" data-act="${inRun ? 'lessonDone' : 'lessonDoneLib'}" data-id="${l.id}" data-ok="0">Continua</button>` : `<button class="link" data-act="nothing">Non ho capito niente</button>`}
    </div></article>`;
}

function openHtml(q) {
  const g = ui.grade;
  return `<p class="crumb">${esc(topicById(q.topic).name)} · interrogazione</p><h2 class="qtext">${esc(q.text)}</h2>
    ${g ? '' : `<label class="field">Rispondi con parole tue (anche poche righe)<textarea id="open-ans" rows="6" data-autofocus>${esc(ui.openText || '')}</textarea></label>
    <button class="btn primary" data-act="gradeOpen">Correggi</button> <button class="link" data-act="skipOpen">Salta</button>`}
    ${g ? `<section class="feedback">
      ${g.ai ? `<p><strong>Correzione AI:</strong> ${esc(g.ai.feedback || '')}</p>` : ''}
      <p>Hai toccato: ${g.matched.length ? esc(g.matched.join(', ')) : 'nessun punto chiave'}.</p>
      ${g.missing.length ? `<p>Mancava: ${esc(g.missing.join(', '))}.</p>` : ''}
      <div class="example"><p class="ex-k">Una risposta completa</p><p>${esc(q.model)}</p></div>${sourceChip(q.source)}
      ${g.self == null ? `<p class="why-q">Confrontala con la tua: quanto ci sei andata vicino?</p><div class="chips">
        <button class="chip" data-act="selfGrade" data-v="1">Ho detto queste cose</button><button class="chip" data-act="selfGrade" data-v="0.5">In parte</button><button class="chip" data-act="selfGrade" data-v="0">Quasi niente</button></div>`
      : `<button class="btn primary" data-act="next" data-autofocus>Avanti</button>`}</section>` : ''}`;
}

const top3 = (a, sep) => a.slice(0, 3).join(sep) + (a.length > 3 ? ` e altri ${a.length - 3}` : '');
VIEWS.report = ({ id }) => {
  const s = S().sessions.find(x => x.id === id); if (!s) return VIEWS.home();
  const r = s.report;
  const rows = [
    ['Tempo', fmtMinutes(r.minutes)],
    ['Attività', `${r.lessons ? r.lessons + ' lezione' + (r.lessons > 1 ? 'i' : '') + ', ' : ''}${r.quizTotal} domande`],
    ['Punteggio', r.score == null ? '—' : `${r.quizCorrect} su ${r.quizTotal} (${r.score}%)`],
    ['Errori', r.errors ? `${r.errors}: ${Object.entries(r.errorTypes).map(([k, n]) => `${ERROR_TYPES[k].toLowerCase()} (${n})`).join(', ')}` : 'nessuno'],
    ['Miglioramenti', r.improvements.length ? top3(r.improvements, '; ') : 'si vedranno dai prossimi ripassi'],
    ['Criticità', r.critical.length ? top3(r.critical, '; ') : 'nessuna'],
    ['Da ripassare', r.toReview.length ? top3(r.toReview, ', ') : 'niente di urgente']
  ];
  return `<main class="wrap report"><p class="brand">${s.diagnostic ? 'Test iniziale' : s.mode === 'simulation' ? 'Simulazione' : 'Sessione'} del ${fmtDate(s.startedAt)}</p>
    <h1>${r.score == null ? 'Fatto.' : r.score >= 80 ? 'Ottima sessione.' : r.score >= 50 ? 'Buon lavoro.' : 'Sessione utile: ora so dove lavorare.'}</h1>
    <dl class="verbale">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${s.mode === 'simulation' ? simulationReview(s) : ''}
    <aside class="stamp big"><span class="stamp-k">Prossimo appuntamento</span><span class="stamp-v">${esc(r.tomorrow)}</span></aside>
    <button class="btn primary" data-act="go" data-to="home">Torna alla home</button></main>`;
};

function simulationReview(s) {
  const atts = S().attempts.filter(a => a.session === s.id && !a.correct);
  if (!atts.length) return '';
  return `<details class="today"><summary>Rivedi le ${atts.length} risposte sbagliate</summary>${atts.map(a => { const q = questionById(S(), a.qid); return `<div class="simrow"><p><strong>${esc(q.text)}</strong></p><p>Giusta: ${esc(q.options[q.answer])}${a.chosen != null ? ` · tua: ${esc(q.options[a.chosen])}` : ''}</p><p class="muted">${esc(q.explanation)}</p></div>`; }).join('')}</details>`;
}

VIEWS.tests = () => `<main class="wrap">${back()}<h1>Fammi un test</h1>
  <div class="menu">
    <button data-act="test" data-kind="quick"><b>Test veloce</b><span>10 domande scelte sul tuo livello</span></button>
    <button data-act="errors"><b>Sui miei errori</b><span>Solo le domande che hai sbagliato</span></button>
    <button data-act="test" data-kind="sim"><b>Simulazione</b><span>30 domande in 30 minuti, correzione alla fine</span></button>
    <button data-act="test" data-kind="open"><b>Interrogazione</b><span>Una domanda a cui rispondi con parole tue</span></button>
  </div>
  <h2>Per materia</h2><div class="menu compact">${SUBJECTS.map(s => `<button data-act="test" data-kind="subject" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div></main>`;

VIEWS.progress = () => {
  const st = S(), w = periodReport(st, 7), m = periodReport(st, 30);
  const maxMin = Math.max(30, ...w.perDay.map(d => d.minutes));
  const falsePreps = TOPICS.map(t => ({ t, fp: topicSnapshot(st, t.id).falsePrep })).filter(x => x.fp);
  return `<main class="wrap stats">${back()}<h1>Come sei messa</h1>
    <p class="lead">Preparazione ${pct(w.mastery)}: ${esc(w.status)}. Programma visto: ${pct(w.coverage)}.</p>
    <p>${esc(w.forecast.text)}</p>
    ${falsePreps.length ? `<section class="warn"><h2>Attenzione alla falsa preparazione</h2>${falsePreps.map(x => `<p><strong>${esc(x.t.name)}.</strong> ${esc(x.fp)}</p>`).join('')}</section>` : ''}
    <h2>Questa settimana</h2>
    <p>${fmtMinutes(w.minutes)} in ${w.sessions} sessioni · ${w.quiz} domande${w.accuracy != null ? `, ${pct(w.accuracy)} giuste` : ''}.</p>
    <div class="week" aria-label="Minuti per giorno">${w.perDay.map(d => `<div class="day"><span class="col" style="height:${Math.round((d.minutes / maxMin) * 100)}%"></span><small>${fmtShort(d.date).split(' ')[0]}</small></div>`).join('')}</div>
    ${w.recurringErrors.length ? `<p>Errori più frequenti: ${w.recurringErrors.slice(0, 3).map(e => `${esc(e.label.toLowerCase())} (${e.n})`).join(', ')}.</p>` : ''}
    ${w.recurringTopics.length ? `<p>Argomenti con più errori: ${w.recurringTopics.map(e => `${esc(e.name)} (${e.n})`).join(', ')}.</p>` : ''}
    <p class="muted">Ultimi 30 giorni: ${fmtMinutes(m.minutes)}, ${m.quiz} domande${m.accuracy != null ? `, ${pct(m.accuracy)} giuste` : ''}.</p>
    <button class="btn" data-act="share">Condividi il riepilogo</button>
    <h2>Materia per materia</h2>
    ${SUBJECTS.map(s => `<section class="subj"><h3>${esc(s.name)}</h3>${TOPICS.filter(t => t.subject === s.id).map(t => { const x = topicSnapshot(st, t.id); return `<div class="topic-row">
      <div class="tr-head"><span>${esc(t.name)}</span><span>${pct(x.mastery)}</span></div>${bar(x.mastery, t.name)}
      <p class="muted small">${x.n ? `${x.n} risposte${x.acc > 0 ? ` · memoria ${pct(x.retention)}` : ''}${x.errorsOpen ? ` · ${x.errorsOpen} errori aperti` : ''}${x.daysSince != null ? ` · ultimo ripasso ${x.daysSince === 0 ? 'oggi' : x.daysSince + ' g fa'}` : ''}` : 'non ancora iniziato'}</p></div>`; }).join('')}</section>`).join('')}
  </main>`;
};

VIEWS.bandi = () => {
  const st = S();
  return `<main class="wrap">${back()}<h1>Bandi e scadenze</h1>
    <p class="lead">Tengo separate la preparazione generale e quella per ogni procedura. Le date non ufficiali restano segnate come DA VERIFICARE finché non le controlli sul sito del Ministero.</p>
    <div class="menu">${st.procedures.map(p => { const r = procedureReport(st, p); return `<button data-act="openProc" data-id="${p.id}"><b>${esc(p.name)}</b><span>${statusPill(r.status)} ${p.verified ? '' : '<strong class="verify">DA VERIFICARE</strong>'}</span></button>`; }).join('')}</div>
    <button class="btn primary" data-act="go" data-to="analyze">Analizza un bando</button>
    <button class="btn" data-act="go" data-to="news">Novità dalle fonti ufficiali${newFeedItems(st).length ? ` (${newFeedItems(st).length})` : ''}</button></main>`;
};

VIEWS.proc = ({ id }) => {
  const st = S(), p = st.procedures.find(x => x.id === id); if (!p) return VIEWS.bandi();
  const r = procedureReport(st, p);
  return `<main class="wrap">${back('bandi', 'Bandi')}<h1>${esc(p.name)}</h1><p class="muted">${esc(p.profile || '')}</p>
    ${p.verified ? '' : '<p class="verify-box">Contenuti non ancora ufficiali: DA VERIFICARE su mim.gov.it, sito dell\'USR o Gazzetta Ufficiale.</p>'}
    <p>${esc(p.summary || '')}</p>
    <p>Stato: ${statusPill(r.status)}</p>
    ${r.requirements.length ? `<h2>Requisiti</h2><p class="muted">Spunta quelli che hai già.</p>${r.requirements.map(q => `<label class="check"><input type="checkbox" data-change="req" data-proc="${p.id}" data-req="${q.id}" ${q.done ? 'checked' : ''}> ${esc(q.text)}${q.status === 'da_verificare' ? ' <strong class="verify">DA VERIFICARE</strong>' : ''}${q.sourceTitle ? `<small class="muted"> · ${esc(q.sourceTitle)}</small>` : ''}</label>`).join('')}` : ''}
    <h2>Scadenze</h2>${(p.deadlines || []).length ? p.deadlines.map(d => `<div class="deadline"><p><strong>${esc(d.label)}</strong>: ${d.date ? fmtDate(d.date) + (d.byUser ? ' (inserita da te)' : '') : 'data non ancora nota'} ${d.status === 'da_verificare' ? '<strong class="verify">DA VERIFICARE</strong>' : ''}</p>${d.note ? `<p class="muted small">${esc(d.note)}</p>` : ''}
      <label class="field inline">Data ufficiale trovata<input type="date" value="${d.date || ''}" data-change="deadline" data-proc="${p.id}" data-dl="${d.id}"></label></div>`).join('') : '<p class="muted">Nessuna scadenza.</p>'}
    ${r.missing.length ? `<h2>Cosa manca</h2><ul>${r.missing.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h2>Preparazione</h2><p>Generale ATA: ${pct(r.general)} · Specifica per questa procedura (${esc(r.subjects.join(', '))}): ${pct(r.specific)}</p>${bar(r.specific, 'Preparazione specifica')}
    ${r.weak.length ? `<p class="muted">Da rinforzare: ${esc(r.weak.join(', '))}.</p>` : ''}
    <p>Simulazioni fatte: ${r.simulations}${r.bestSimulation != null ? ` · migliore ${r.bestSimulation}%` : ''}</p>
    ${p.type === 'titoli' ? '<p class="muted">Questa graduatoria è per soli titoli: il punteggio non dipende da una prova. Lo studio serve per la CIAD e per lavorare bene quando ti chiamano.</p>' : ''}
    <div class="actions"><button class="btn" data-act="procSim" data-id="${p.id}">Simulazione su queste materie</button>
    ${p.custom ? `<button class="link danger" data-act="delProc" data-id="${p.id}">Rimuovi</button>` : ''}</div></main>`;
};

VIEWS.analyze = () => {
  const r = ui.analysis;
  return `<main class="wrap">${back('bandi', 'Bandi')}<h1>Analizza un bando</h1>
    <p class="lead">Incolla il testo del bando (o di un avviso) oppure carica un file di testo. Estraggo date, requisiti e materie; tutto resta DA VERIFICARE.</p>
    <label class="field">Testo<textarea id="bando-text" rows="8">${esc(ui.bandoText || '')}</textarea></label>
    <label class="field">Oppure un file: testo, PDF o foto<input type="file" accept=".txt,text/plain,.pdf,application/pdf,image/*" data-change="bandoFile"></label>
    <p class="muted small">PDF con testo: letti sul dispositivo. PDF scansionati e foto: servono l'AI e la connessione.</p>
    ${ui.reading ? `<p class="notice">${esc(ui.reading)}</p>` : ''}
    <button class="btn primary" data-act="analyze">Analizza</button> ${S().settings.aiMode === 'on' ? '<button class="btn" data-act="analyzeAI">Analisi approfondita con AI</button>' : ''}
    ${r ? `<section class="analysis"><h2>Risultato (${esc(r.method)})</h2>${r.warnings.map(w => `<p class="verify-box">${esc(w)}</p>`).join('')}
      <p>Tipo: ${esc(r.type)} · Profili: ${esc(r.profiles.join(', ') || 'non trovati')}</p>
      <p>Materie: ${esc(r.subjects.map(s => subjectById(s)?.name || s).join(', ') || 'non trovate')}</p>
      <h3>Date trovate</h3>${r.dates.length ? `<ul>${r.dates.map(d => `<li><strong>${esc(d.raw)}</strong> – ${esc(d.kind)}<br><small class="muted">«${esc(d.context)}»</small></li>`).join('')}</ul>` : '<p class="muted">Nessuna.</p>'}
      <h3>Possibili requisiti</h3>${r.requirements.length ? `<ul>${r.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nessuno riconosciuto.</p>'}
      <label class="field">Nome da dare a questa procedura<input id="bando-name" value="Nuovo bando"></label>
      <button class="btn primary" data-act="saveBando">Aggiungi ai miei bandi</button></section>` : ''}</main>`;
};

VIEWS.lessons = () => `<main class="wrap">${back()}<h1>Lezioni</h1><p class="lead">Brevi, con un esempio pratico. Le apro io quando servono, ma puoi leggerle quando vuoi.</p>
  ${SUBJECTS.map(s => `<section class="subj"><h2>${esc(s.name)}</h2><div class="menu compact">${TOPICS.filter(t => t.subject === s.id).map(t => { const l = lessonForTopic(t.id); return `<button data-act="openLesson" data-id="${l.id}">${S().lessonsRead[l.id] ? '✓ ' : ''}${esc(t.name)} <small>${l.minutes}′</small></button>`; }).join('')}</div></section>`).join('')}</main>`;

VIEWS.news = () => {
  const st = S(), fresh = new Set(newFeedItems(st).map(i => i.id));
  if (feed?.items?.length) { const latest = feed.items[0].firstSeen; if (st.feedSeen !== latest) setTimeout(() => store.mutate(s => { s.feedSeen = latest; }), 0); }
  return `<main class="wrap">${back('bandi', 'Bandi')}<h1>Novità dalle fonti ufficiali</h1>
    ${!feed ? `<p class="lead">${ONLINE_APP ? 'Nessun aggiornamento disponibile per ora.' : 'Questa funzione si attiva quando l\'app è pubblicata online con il controllo automatico (vedi GUIDA.md).'}</p>` : `
    <p class="verify-box">${esc(feed.note || 'Elenco automatico: DA VERIFICARE sulla pagina originale.')}</p>
    <p class="muted small">Ultimo controllo: ${feed.updatedAt ? fmtDate(feed.updatedAt) + ' ' + new Date(feed.updatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'mai'}</p>
    ${(feed.sources || []).filter(x => !x.ok).map(x => `<p class="small">Non sono riuscito a leggere «${esc(x.name)}» (${esc(x.error || 'errore')}). Controllala a mano: <a href="${esc(x.url)}" target="_blank" rel="noopener">apri</a>.</p>`).join('')}
    ${feed.items.length ? `<ul class="news">${feed.items.slice(0, 60).map(i => `<li>${fresh.has(i.id) ? '<span class="pill">nuovo</span> ' : ''}<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><br><small class="muted">${esc(i.source || '')} · visto il ${fmtDate(i.firstSeen)}</small></li>`).join('')}</ul>` : '<p class="muted">Nessun link pertinente trovato finora.</p>'}`}
  </main>`;
};

VIEWS.material = () => {
  const st = S(), custom = st.customQuestions, aiOn = st.settings.aiMode === 'on';
  const byOrigin = {}; custom.forEach(q => { byOrigin[q.origin] = (byOrigin[q.origin] || 0) + 1; });
  return `<main class="wrap">${back('settings', 'Impostazioni')}<h1>Aggiungi domande</h1>
    <p class="lead">Ci sono già ${allMcCount()} domande pronte. Qui puoi aggiungerne altre: tutte quelle aggiunte restano segnate come DA VERIFICARE.</p>
    <section><h2>Crea domande da un testo ufficiale</h2>
      ${aiOn ? '' : '<p class="notice">Serve l\'AI: attivala nelle impostazioni.</p>'}
      <p class="muted small">Incolla un articolo di legge (per esempio da Normattiva) o carica un PDF. L\'AI scrive le domande solo da quel testo e cita la frase usata: se la frase non si trova nel testo, la domanda viene scartata.</p>
      <label class="field">Testo<textarea id="mat-text" rows="7">${esc(ui.matText || '')}</textarea></label>
      <label class="field">Oppure un file (testo, PDF o foto)<input type="file" accept=".txt,text/plain,.pdf,application/pdf,image/*" data-change="matFile"></label>
      ${ui.reading ? `<p class="notice">${esc(ui.reading)}</p>` : ''}
      <label class="field">Da dove viene il testo?<input id="mat-src" placeholder="es. L. 241/1990, art. 2 – Normattiva" value="${esc(ui.matSrc || '')}"></label>
      <label class="field">Argomento<select id="mat-topic">${SUBJECTS.map(sj => `<optgroup label="${esc(sj.name)}">${TOPICS.filter(t => t.subject === sj.id).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="field">Quante domande<select id="mat-n"><option>5</option><option selected>8</option><option>12</option></select></label>
      <button class="btn primary" data-act="genQuestions" ${aiOn ? '' : 'disabled'}>Crea le domande</button>
      ${ui.genResult ? `<p class="notice">${esc(ui.genResult)}</p>` : ''}</section>
    <section><h2>Importa un pacchetto</h2><p class="muted small">File .json preparato con ATA Coach (per esempio da un docente o da un familiare).</p>
      <label class="field">File del pacchetto<input type="file" accept=".json,application/json" data-change="packFile"></label></section>
    <section><h2>Domande aggiunte: ${custom.length}</h2>
      ${Object.entries(byOrigin).map(([o, n]) => `<p class="small">${esc(o)}: ${n} <button class="link danger" data-act="delOrigin" data-o="${esc(o)}">elimina</button></p>`).join('')}
      ${custom.length ? '<button class="btn" data-act="exportPack">Esporta come pacchetto</button>' : ''}</section></main>`;
};
const allMc = () => allQuestions(S()).filter(q => q.type === 'mc');
const allMcCount = () => allMc().length;
const allQuestionsFor = srcId => allQuestions(S()).filter(q => q.source === srcId).length;

VIEWS.lesson = ({ id }) => `<main class="wrap">${back('lessons', 'Lezioni')}${lessonHtml(LESSONS.find(l => l.id === id), false)}</main>`;

VIEWS.calendar = () => {
  const st = S(), cal = projectCalendar(st, 14);
  return `<main class="wrap">${back()}<h1>Calendario</h1><p class="lead">Previsione delle prossime due settimane. Si aggiorna da sola dopo ogni sessione.</p>
    <ol class="cal">${cal.map(d => `<li class="${d.minutes ? '' : 'rest'}"><span class="cal-d">${fmtShort(d.date)}</span><span>${d.minutes ? `${d.minutes} min · ${esc(topicById(d.topic).name)}${d.alsoReview ? ' + ripasso' : ''}` : 'riposo'}</span></li>`).join('')}</ol>
    <button class="btn" data-act="go" data-to="settings">Cambia il tempo disponibile</button>
    <button class="btn" data-act="ics">Aggiungi i promemoria al calendario del telefono</button></main>`;
};

VIEWS.settings = () => {
  const st = S(), u = st.user || {}, s = st.settings, a = u.availability || [0, 30, 30, 30, 30, 30, 0], status = ai.status();
  const order = [1, 2, 3, 4, 5, 6, 0];
  return `<main class="wrap settings">${back()}<h1>Impostazioni</h1>
  <section><h2>Profilo</h2>
    <label class="field">Nome<input data-change="user" data-k="name" value="${esc(u.name || '')}"></label>
    <label class="field">Obiettivo<select data-change="user" data-k="goal">${GOALS.map(g => `<option value="${g.id}" ${u.goal === g.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
    <label class="field">CIAD<select data-change="user" data-k="hasCIAD">${[['si', 'Ce l\'ho'], ['no', 'Non ce l\'ho'], ['nonso', 'Non so']].map(([v, l]) => `<option value="${v}" ${u.hasCIAD === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Data obiettivo (facoltativa)<input type="date" data-change="user" data-k="targetDate" value="${esc(u.targetDate || '')}"></label>
  </section>
  <section><h2>Sincronizzazione tra dispositivi</h2>
    ${syncOn() ? `<p>Collegato al repository privato <strong>${esc(st.sync.repo)}</strong>. Telefono e computer si aggiornano da soli: all'apertura, dopo ogni sessione e poco dopo ogni modifica.</p>
      <p class="muted small">${esc(syncStatusText())}</p>
      <div class="actions"><button class="btn primary" data-act="syncNow">Sincronizza ora</button><button class="btn" data-act="showLink">Collega un altro dispositivo</button></div>
      ${ui.linkCode ? `<div class="pushbox"><p><strong>Codice di collegamento.</strong> Contiene la chiave: trattalo come una password, mandalo solo a te stessa e cancella il messaggio dopo l'uso.</p>
        <label class="field">Codice (da incollare nell'altro dispositivo)<textarea rows="3" readonly>${esc(ui.linkCode)}</textarea></label><button class="btn" data-act="copyVal" data-v="${esc(ui.linkCode)}">Copia il codice</button>
        ${ONLINE_APP ? `<label class="field">Oppure un link (sul computer basta aprirlo)<textarea rows="3" readonly>${esc(ui.linkUrl)}</textarea></label><button class="btn" data-act="copyVal" data-v="${esc(ui.linkUrl)}">Copia il link</button>
        <p class="muted small">Su iPhone l'app installata e Safari hanno memorie separate: lì usa il codice, incollandolo dentro l'app (Impostazioni → Sincronizzazione).</p>` : ''}</div>` : ''}
      <button class="link danger" data-act="unlinkSync">Scollega questo dispositivo</button>`
    : `<p>Per usare ATA Coach su telefono e computer con gli stessi progressi. I dati vanno in un repository GitHub <strong>privato</strong>, visibile solo a te; servono il nome del repository e una chiave (vedi GUIDA, passo 6).</p>
      <label class="field">Repository (utente/nome)<input id="sync-repo" placeholder="nomeutente/ata-coach-dati" value="${esc(st.sync.repo || '')}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label class="field">Chiave di GitHub (inizia con github_pat_)<input id="sync-token" type="password" autocomplete="off"></label>
      <button class="btn primary" data-act="syncLink">Collega e sincronizza</button>
      <details><summary>Ho un codice di collegamento</summary><textarea id="link-code" rows="3"></textarea><button class="btn" data-act="linkCode">Collega</button></details>`}
    ${ui.syncMsg ? `<p class="notice">${esc(ui.syncMsg)}</p>` : ''}</section>
  <section><h2>Tempo per giorno (minuti)</h2><div class="avail">${order.map(i => `<label>${WEEKDAYS[i].slice(0, 3)}<input type="number" min="0" max="240" step="5" value="${a[i]}" data-change="avail" data-i="${i}"></label>`).join('')}</div>
    <label class="field">Ora del promemoria<input type="number" min="6" max="23" value="${u.notifyHour ?? 18}" data-change="user" data-k="notifyHour"></label>
    <div class="actions"><button class="btn" data-act="notif">${s.notifications ? 'Promemoria attivi' : 'Attiva i promemoria'}</button><button class="btn" data-act="ics">Esporta nel calendario (.ics)</button></div>
    <p class="muted small">I promemoria del browser arrivano solo con l'app aperta o installata. Per avvisi sicuri usa l'esportazione nel calendario del telefono.</p></section>
  <section><h2>Intelligenza artificiale</h2>
    <p>L'app funziona completamente anche senza AI. Con l'AI attiva ottieni spiegazioni alternative, correzione delle risposte aperte e analisi approfondita dei bandi.</p>
    <label class="check"><input type="checkbox" data-change="aiMode" ${s.aiMode === 'on' ? 'checked' : ''}> Usa l'AI quando serve</label>
    <label class="field">Chiave API Google AI Studio<input type="password" data-change="setting" data-k="apiKey" value="${esc(s.apiKey)}" autocomplete="off"></label>
    <label class="field">Modello<input data-change="setting" data-k="model" value="${esc(s.model)}"></label>
    <label class="field">Limite token al giorno<input type="number" min="1000" step="1000" data-change="setting" data-k="dailyTokenBudget" value="${s.dailyTokenBudget}"></label>
    <p class="muted small">Usati oggi: ${status.used} su ${status.budget}. Le risposte uguali vengono riusate dalla cache senza costi. La chiave resta solo su questo dispositivo e non viene inclusa nei backup. Se il modello indicato viene dismesso da Google, l'app ne sceglie da sola uno equivalente.</p>
    ${s.aiMode === 'on' && s.apiKey ? '<button class="btn" data-act="aiTest">Prova la connessione</button>' : ''}${ui.aiTest ? `<p class="notice">${esc(ui.aiTest)}</p>` : ''}</section>
  <section><h2>Notifiche push</h2>
    <p>Arrivano anche ad app chiusa: promemoria giornaliero e novità dalle fonti ufficiali. Richiedono l'app pubblicata su GitHub (vedi GUIDA.md). Su iPhone, prima aggiungi l'app alla schermata Home.</p>
    ${ONLINE_APP ? `<details><summary>Le notifiche sono già attive su un altro dispositivo</summary><p class="muted small">Incolla qui i valori VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY usati sull'altro dispositivo (li trovi nella sua schermata di configurazione o nel file salvato), poi premi «Configura».</p>
      <label class="field">VAPID_PUBLIC_KEY<input id="vapid-pub" autocomplete="off" spellcheck="false"></label><label class="field">VAPID_PRIVATE_KEY<input id="vapid-priv" type="password" autocomplete="off"></label></details>
      <button class="btn" data-act="pushSetup">Configura le notifiche push</button>` : '<p class="muted small">Disponibile solo nella versione pubblicata online.</p>'}
    ${ui.push ? `<div class="pushbox"><p>Copia questi tre valori nei «Secrets» del repository GitHub (Settings → Secrets and variables → Actions → New repository secret):</p>
      ${[['VAPID_PUBLIC_KEY', ui.push.pub], ['VAPID_PRIVATE_KEY', ui.push.priv], ['PUSH_SUBSCRIPTION', ui.push.sub]].map(([k, v]) => `<label class="field">${k}<textarea rows="${k === 'PUSH_SUBSCRIPTION' ? 4 : 2}" readonly>${esc(v)}</textarea></label><button class="btn" data-act="copyVal" data-v="${esc(v)}">Copia ${k}</button>`).join('')}
      <p class="muted small">Poi, su GitHub, apri Actions → «Promemoria di studio» → Run workflow per provare.</p></div>` : ''}</section>
  <section><h2>Domande e contenuti</h2>
    <button class="btn" data-act="go" data-to="material">Aggiungi domande (AI o pacchetti)</button>
    <p class="muted small">Segnalazioni di errori nelle domande: ${st.reports.length}. ${st.reports.length ? '<button class="link" data-act="copyReports">Copia le segnalazioni</button>' : ''}</p></section>
  <section><h2>Backup dei progressi</h2>
    <div class="actions"><button class="btn" data-act="export">Scarica il backup</button><button class="btn" data-act="copyExport">Copia il backup</button></div>
    <label class="field">Ripristina da file<input type="file" accept=".json,application/json" data-change="importFile"></label>
    <details><summary>Ripristina incollando il testo</summary><textarea id="import-text" rows="4"></textarea><button class="btn" data-act="importText">Ripristina</button></details>
    <p class="muted small">Copia automatica giornaliera sul dispositivo (ultimi 7 giorni). ${st.lastBackupAt ? 'Ultimo backup esportato: ' + fmtDate(st.lastBackupAt) + '.' : 'Nessun backup esportato finora.'}</p>
    <button class="link" data-act="snapshots">Vedi le copie automatiche</button>${ui.snaps ? `<ul>${ui.snaps.map(k => `<li>${esc(k.replace('snap:', ''))} <button class="link" data-act="restoreSnap" data-k="${esc(k)}">ripristina</button></li>`).join('')}</ul>` : ''}</section>
  <section><h2>Contenuti e fonti</h2><p class="muted small">Versione contenuti: ${CONTENT_VERSION}. Ogni norma ha fonte e stato. Prima di affidarti a un dato, controlla la fonte ufficiale.</p>
    <details><summary>Verifica delle fonti (${SOURCES.filter(x => st.sourceChecks[x.id]).length} di ${SOURCES.length} verificate)</summary>
      <p class="muted small">Una persona apre la fonte ufficiale, controlla che le lezioni e le domande collegate siano corrette e preme «Verificata oggi». Dopo 12 mesi la verifica scade.</p>
      <ul class="sources">${SOURCES.map(x => { const c = st.sourceChecks[x.id], old = c && Date.now() - c > 365 * DAY; return `<li><strong>${esc(x.title)}</strong> – ${esc(x.ref)}${x.status === 'da_verificare' ? ' <strong class="verify">DA VERIFICARE</strong>' : ''}<br>
        <small class="muted">${c ? `verificata il ${fmtDate(c)}${old ? ' – da ricontrollare' : ''}` : 'mai verificata da una persona'} · ${allQuestionsFor(x.id)} domande collegate</small><br>
        ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">Apri la fonte</a> · ` : ''}<button class="link" data-act="checkSource" data-id="${x.id}">Verificata oggi</button></li>`; }).join('')}</ul></details></section>
  <section><h2>Ricomincia</h2><button class="link danger" data-act="reset">Cancella tutti i progressi</button></section></main>`;
};

// ---------- ACTIONS ----------
const A = {};
A.go = d => go(d.to);
A.obSet = d => { ui.obData[d.k] = d.k === 'minutes' ? +d.v : d.v; render(); };
A.obNext = () => {
  const d = ui.obData;
  if (ui.ob === undefined || ui.ob === 1) { d.name = (document.getElementById('ob-name')?.value || '').trim(); }
  if (ui.ob === 3) d.weekend = document.getElementById('ob-weekend')?.checked;
  const keep = d; ui.ob = (ui.ob || 1) + 1; ui.obData = keep; render();
};
A.obFinish = () => {
  const d = ui.obData, m = d.minutes;
  store.mutate(s => {
    s.user = { updatedAt: Date.now(), name: d.name || 'Giorgia', goal: d.goal, hasCIAD: d.hasCIAD, availability: [d.weekend ? Math.round(m * 0.66) : 0, m, m, m, m, m, d.weekend ? Math.round(m * 0.66) : 0], notifyHour: 18, startedAt: Date.now() };
    s.procedures = PROCEDURE_TEMPLATES.map(p => JSON.parse(JSON.stringify({ ...p, checked: d.hasCIAD === 'si' ? { r_ciad: true } : {}, active: true })));
  });
  const qs = diagnosticQuestions(S());
  startRun({ id: uid('s'), minutes: qs.length, mode: 'diagnostic', why: ['Test iniziale'] }, { steps: qs.map(q => ({ t: 'mc', qid: q.id, block: 'quiz' })), diagnostic: true, mode: 'diagnostic' });
};
A.auto = d => startAuto(+d.min);
A.lazy = () => startAuto(5, 'lazy');
A.errors = () => startRun(buildSession(S(), 15, { mode: 'errors' }), { emptyMsg: 'Non hai errori da ripassare. Ottimo.' });
A.resume = () => { run = S().current; run.stepStart = Date.now(); go('run'); };
A.exitRun = () => { store.mutate(s => { s.current = run; }); run = null; go('home'); };
A.unsure = () => { run.unsure = !run.unsure; render(); };
A.answer = d => {
  if (run.answered) return;
  const step = run.steps[run.i], q = questionById(S(), step.qid), chosen = step.order ? step.order[+d.i] : +d.i, ms = Date.now() - run.stepStart;
  if (chosen == null || chosen >= q.options.length) return;
  let res; store.mutate(s => { res = recordAttempt(s, q, { chosen, ms, unsure: run.unsure, sessionId: run.id, diagnostic: run.diagnostic }); });
  run.answered = { chosen, correct: res.correct, errorId: res.error?.id || null };
  if (run.exam) { nextStep(); return; }
  if (run.diagnostic) { setTimeout(nextStep, 0); return; }
  render();
};
A.dontKnow = () => {
  const q = questionById(S(), run.steps[run.i].qid);
  let res; store.mutate(s => { res = recordAttempt(s, q, { chosen: null, dontKnow: true, ms: Date.now() - run.stepStart, sessionId: run.id, diagnostic: run.diagnostic }); });
  run.answered = { chosen: null, correct: false, dontKnow: true, errorId: res.error?.id || null };
  if (run.exam || run.diagnostic) { nextStep(); return; }
  render();
};
A.errType = d => { store.mutate(s => { const e = s.errors.find(x => x.id === run.answered.errorId); if (e) { e.userType = d.k; e.userTypeAt = Date.now(); } }); ui.whyOpen = false; render(); };
A.whyOpen = () => { ui.whyOpen = true; render(); };
A.next = () => nextStep();
A.help = () => {
  ui.help = true;
  const step = run?.steps[run.i]; const topic = step?.qid ? questionById(S(), step.qid).topic : step?.lessonId ? LESSONS.find(l => l.id === step.lessonId).topic : view.params.id ? LESSONS.find(l => l.id === view.params.id).topic : null;
  if (topic) store.mutate(s => { getStat(s, topic).notUnderstood++; });
  render();
};
A.nothing = () => { ui.help = true; ui.nothing = true; render(); };
A.aiExplain = async d => {
  const l = LESSONS.find(x => x.id === d.lesson); ui.aiText = 'Sto preparando una spiegazione…'; render();
  const r = await ai.run(ui.nothing ? 'simplify' : 'explain', { topic: topicById(l.topic).name, lesson: l.body.replace(/==/g, ''), keyPoints: l.keyPoints });
  ui.aiText = r.ok ? r.text : `AI non disponibile (${r.reason}). Usa la versione semplice qui sopra.`; render();
};
A.lessonDone = d => { const ok = d.ok === '1'; store.mutate(s => { markLessonRead(s, d.id, ok); }); run.lessons.push(LESSONS.find(l => l.id === d.id).topic); nextStep(); };
A.lessonDoneLib = d => { store.mutate(s => { markLessonRead(s, d.id, d.ok === '1'); }); toast('Lezione segnata come letta.'); go('lessons'); };
A.gradeOpen = async () => {
  const text = document.getElementById('open-ans').value.trim(); ui.openText = text;
  if (text.length < 5) { toast('Scrivi almeno una frase: anche imprecisa va bene.'); return; }
  const q = questionById(S(), run.steps[run.i].qid);
  const g = gradeOpenOffline(q, text); g.self = null;
  if (S().settings.aiMode === 'on') { toast('Correzione in corso…'); const r = await ai.run('gradeOpen', { question: q.text, model: q.model, answer: text }); if (r.ok && r.data) { g.ai = r.data; if (typeof r.data.score === 'number') g.score = (g.score + r.data.score) / 2; } }
  ui.grade = g; render();
};
A.selfGrade = d => {
  const q = questionById(S(), run.steps[run.i].qid), g = ui.grade; g.self = +d.v;
  const score = g.ai ? (g.score * 2 + g.self) / 3 : (g.score + g.self) / 2;
  store.mutate(s => { recordOpenAnswer(s, q, score, run.id); }); render();
};
A.skipOpen = () => nextStep();
A.test = d => {
  const st = S();
  if (d.kind === 'quick') return startRun(buildSession(st, 10, { mode: 'test' }));
  if (d.kind === 'subject') { const qs = pickQuestions(st, { mode: 'subject', subjectId: d.id, n: 10 }); return startRun({ id: uid('s'), minutes: qs.length, mode: 'test' }, { steps: qs.map(q => ({ t: 'mc', qid: q.id, block: 'quiz' })), mode: 'test' }); }
  if (d.kind === 'sim') { const qs = simulationQuestions(st, 30); return startRun({ id: uid('s'), minutes: qs.length, mode: 'simulation' }, { steps: qs.map(q => ({ t: 'mc', qid: q.id, block: 'quiz' })), exam: true, mode: 'simulation' }); }
  if (d.kind === 'open') { const done = new Set(st.attempts.map(a => a.qid)); const o = OPEN_QUESTIONS.find(x => !done.has(x.id)) || OPEN_QUESTIONS[Math.floor(Math.random() * OPEN_QUESTIONS.length)]; return startRun({ id: uid('s'), minutes: 5, mode: 'test' }, { steps: [{ t: 'open', qid: o.id }], mode: 'test' }); }
};
A.procSim = d => {
  const p = S().procedures.find(x => x.id === d.id); const qs = simulationQuestions(S(), 20, Math.random, p.subjects);
  startRun({ id: uid('s'), minutes: qs.length, mode: 'simulation' }, { steps: qs.map(q => ({ t: 'mc', qid: q.id, block: 'quiz' })), exam: true, mode: 'simulation', procedure: p.id });
};
A.openProc = d => go('proc', { id: d.id });
A.delProc = d => { if (!confirm('Rimuovere questa procedura?')) return; store.mutate(s => { s.procedures = s.procedures.filter(p => p.id !== d.id); s.tombstones[d.id] = Date.now(); }); go('bandi'); };
A.analyze = () => { ui.bandoText = document.getElementById('bando-text').value; if (ui.bandoText.trim().length < 40) { toast('Incolla un testo un po\' più lungo.'); return; } ui.analysis = analyzeBandoOffline(ui.bandoText); render(); };
A.analyzeAI = async () => {
  ui.bandoText = document.getElementById('bando-text').value; if (ui.bandoText.trim().length < 40) { toast('Incolla prima il testo.'); return; }
  const base = analyzeBandoOffline(ui.bandoText); toast('Analisi AI in corso…');
  const r = await ai.run('analyzeBando', { text: ui.bandoText });
  if (r.ok && r.data) { const x = r.data; base.method = 'AI + regole'; base.requirements = (x.requisiti || base.requirements).slice(0, 12); base.profiles = x.profili?.length ? x.profili : base.profiles; base.type = x.tipo || base.type; base.dates = [...(x.scadenze || []).map(s => ({ raw: s.data || 'data non chiara', iso: s.data, kind: s.descrizione || 'scadenza', context: s.citazione || '', verified: false })), ...base.dates]; }
  else base.warnings.unshift(`AI non disponibile (${r.reason}): uso l'analisi a regole.`);
  ui.analysis = base; render();
};
A.saveBando = () => {
  const r = ui.analysis, name = document.getElementById('bando-name').value.trim() || 'Nuovo bando';
  const proc = { id: uid('p'), updatedAt: Date.now(), name, profile: r.profiles.join(', '), type: r.type === 'titoli' ? 'titoli' : 'esame', subjects: r.subjects.length ? r.subjects : SUBJECTS.map(s => s.id), verified: false, custom: true, active: true, checked: {},
    summary: 'Importato da testo incollato. Controlla tutto sul bando ufficiale.',
    requirements: r.requirements.map((t, i) => ({ id: 'r' + i, text: t, source: null, status: 'da_verificare' })),
    deadlines: r.dates.filter(d => d.kind !== 'riferimento normativo').map((d, i) => ({ id: 'd' + i, label: d.kind, date: d.iso, status: 'da_verificare', note: d.context })) };
  store.mutate(s => { s.procedures.push(proc); s.documents.push({ id: uid('doc'), at: Date.now(), kind: 'bando', name, text: ui.bandoText.slice(0, 50000), procedure: proc.id }); });
  toast('Aggiunto ai tuoi bandi.'); go('proc', { id: proc.id });
};
A.openLesson = d => go('lesson', { id: d.id });
A.syncNow = async () => { ui.syncMsg = null; const r = await runSync(); toast(r ? 'Sincronizzato.' : 'Sincronizzazione non riuscita: ' + (S().sync.lastError?.msg || '')); };
A.syncLink = () => linkDevice(document.getElementById('sync-repo').value, document.getElementById('sync-token').value);
A.linkCode = () => { const c = decodeLink(document.getElementById('link-code').value); if (!c) { toast('Codice non valido: copialo di nuovo per intero.'); return; } linkDevice(c.repo, c.token); };
A.showLink = () => { const code = encodeLink(S().sync.repo, S().sync.token); ui.linkCode = code; ui.linkUrl = location.origin + location.pathname + '#collega=' + code; render(); };
A.unlinkSync = async () => { if (!confirm('Scollegare questo dispositivo? I progressi restano qui e nel repository, ma smettono di aggiornarsi.')) return; store.state.sync = { ...store.state.sync, token: '', lastError: null }; await store.save(); ui.linkCode = null; ui.syncMsg = 'Dispositivo scollegato.'; render(); };
A.reportQ = d => { const note = prompt('Cosa non va in questa domanda? (risposta sbagliata, testo poco chiaro, norma cambiata…)'); if (!note) return; store.mutate(s => { s.reports.push({ id: uid('r'), qid: d.q, note: note.slice(0, 500), at: Date.now() }); }); toast('Segnalazione salvata. La trovi nelle impostazioni.'); };
A.copyReports = async () => { const t = S().reports.map(r => { const q = questionById(S(), r.qid); return `[${fmtDate(r.at)}] ${r.qid} – ${q ? q.text : '?'}\n→ ${r.note}`; }).join('\n\n'); await copyText(t, 'Segnalazioni copiate.'); };
A.checkSource = d => { store.mutate(s => { s.sourceChecks[d.id] = Date.now(); }); toast('Fonte segnata come verificata oggi.'); render(); };
A.copyVal = async d => copyText(d.v, 'Copiato.');
A.aiTest = async () => { ui.aiTest = 'Provo…'; render(); const r = await ai.run('explain', { topic: 'prova di connessione ' + Date.now(), lesson: 'Rispondi solo: OK' }); ui.aiTest = r.ok ? `Connessione riuscita (modello: ${S().settings.model}).` : `Non funziona: ${r.reason}.`; render(); };
A.genQuestions = async () => {
  const text = (document.getElementById('mat-text').value || '').trim(); ui.matText = text; ui.matSrc = document.getElementById('mat-src').value.trim();
  const topic = document.getElementById('mat-topic').value, n = +document.getElementById('mat-n').value;
  if (text.length < 200) { toast('Serve un testo più lungo (almeno qualche paragrafo).'); return; }
  ui.genResult = 'Sto creando le domande…'; render();
  const r = await ai.run('generateQuestions', { topic: topicById(topic).name, n, text });
  if (!r.ok) { ui.genResult = `AI non disponibile: ${r.reason}.`; render(); return; }
  const { ok, rejected } = acceptAIQuestions(r.data, text, topic, ui.matSrc || null);
  store.mutate(s => { s.customQuestions.push(...ok); });
  ui.genResult = `Aggiunte ${ok.length} domande a «${topicById(topic).name}».${rejected.length ? ` Scartate ${rejected.length} perché la citazione non era nel testo o il formato era sbagliato.` : ''} Compariranno nelle prossime sessioni, segnate DA VERIFICARE.`; render();
};
A.delOrigin = d => { if (!confirm('Eliminare le domande «' + d.o + '»?')) return; store.mutate(s => { const now = Date.now(); for (const q of s.customQuestions) if (q.origin === d.o) s.tombstones[q.id] = now; s.customQuestions = s.customQuestions.filter(q => q.origin !== d.o); }); render(); };
A.exportPack = () => { const t = exportPack(S().customQuestions, 'Domande di ' + (S().user?.name || 'ATA Coach')); download('ata-coach-pacchetto-' + dayKey() + '.json', t, 'application/json'); };
A.pushSetup = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('Questo browser non supporta le notifiche push. Su iPhone aggiungi prima l\'app alla schermata Home.'); return; }
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('Permesso negato: le notifiche non possono arrivare.'); return; }
    const pub = (document.getElementById('vapid-pub')?.value || '').trim(), priv = (document.getElementById('vapid-priv')?.value || '').trim();
    let keys = pub && priv ? { publicKey: pub, privateKey: priv } : S().settings.vapid;
    if (pub && priv && b64uToBytes(pub).length !== 65) { toast('VAPID_PUBLIC_KEY non valida: copiala di nuovo per intero.'); return; }
    if (!keys) keys = await generateVapidKeys();
    store.mutate(s => { s.settings.vapid = keys; s.settings.notifications = true; });
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(keys.publicKey) });
    ui.push = { pub: keys.publicKey, priv: keys.privateKey, sub: JSON.stringify(sub) }; render();
  } catch (e) { toast('Configurazione non riuscita: ' + (e.message || e)); }
};
A.share = async () => { const t = shareText(S()); try { if (navigator.share) { await navigator.share({ text: t }); return; } await navigator.clipboard.writeText(t); toast('Riepilogo copiato: incollalo dove vuoi.'); } catch { prompt('Copia il riepilogo:', t); } };
function download(name, text, type) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return true; } catch { return false; } }
A.export = () => { download('ata-coach-backup-' + dayKey() + '.json', store.exportJSON(), 'application/json'); store.mutate(s => { s.lastBackupAt = Date.now(); }); toast('Backup pronto. Se il download non parte, usa «Copia il backup».'); };
A.copyExport = async () => { const t = store.exportJSON(); try { await navigator.clipboard.writeText(t); toast('Backup copiato. Incollalo in una nota o in una mail a te stessa.'); } catch { const ta = document.getElementById('import-text'); if (ta) { ta.value = t; ta.closest('details').open = true; ta.select(); toast('Seleziona e copia il testo.'); } } store.mutate(s => { s.lastBackupAt = Date.now(); }); };
A.importText = async () => { try { await store.importJSON(document.getElementById('import-text').value); toast('Progressi ripristinati.'); go('home'); } catch (e) { toast(e.message || 'Backup non valido.'); } };
A.snapshots = async () => { ui.snaps = await store.listSnapshots(); render(); };
A.restoreSnap = async d => { if (!confirm('Ripristinare la copia del ' + d.k.replace('snap:', '') + '? I progressi successivi andranno persi.')) return; await store.restoreSnapshot(d.k); toast('Copia ripristinata.'); go('home'); };
A.reset = async () => { if (!confirm(syncOn() ? 'Cancellare i progressi da QUESTO dispositivo? (Il dispositivo verrà scollegato; i dati nel repository restano.)' : 'Cancellare tutti i progressi?')) return; if (!syncOn() && !confirm('Sicura? Senza backup non si possono recuperare.')) return; const key = S().settings.apiKey; store.state = emptyState(); store.state.settings.apiKey = key; await store.save(); go('onboarding'); };
A.notif = async () => {
  if (typeof Notification === 'undefined') { toast('Questo browser non supporta le notifiche. Usa l\'esportazione nel calendario.'); return; }
  const p = await Notification.requestPermission(); store.mutate(s => { s.settings.notifications = p === 'granted'; });
  toast(p === 'granted' ? 'Promemoria attivi.' : 'Permesso negato. Puoi usare l\'esportazione nel calendario.'); render();
};
A.ics = () => {
  const st = S(), a = st.user?.availability || [], h = st.user?.notifyHour ?? 18, codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const days = codes.filter((_, i) => a[i] > 0).join(','); const dur = Math.max(10, Math.round(a.filter(x => x).reduce((x, y) => x + y, 0) / Math.max(1, a.filter(x => x).length)));
  const d = new Date(); const pad = n => String(n).padStart(2, '0'); const start = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}0000`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ATA Coach//IT', 'BEGIN:VEVENT', 'UID:' + uid('ics') + '@atacoach', 'DTSTAMP:' + start, 'DTSTART:' + start, `DURATION:PT${dur}M`, `RRULE:FREQ=WEEKLY;BYDAY=${days || 'MO,TU,WE,TH,FR'}`, 'SUMMARY:Studio ATA Coach', 'DESCRIPTION:Apri ATA Coach e premi Fai tu.', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Studio ATA Coach', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download('ata-coach-promemoria.ics', ics, 'text/calendar'); toast('Apri il file per aggiungere i promemoria al calendario.');
};

// eventi change
const C = {};
C.user = (el, d) => { store.mutate(s => { s.user[d.k] = d.k === 'notifyHour' ? +el.value : el.value; s.user.updatedAt = Date.now(); }); };
C.avail = (el, d) => { store.mutate(s => { s.user.availability[+d.i] = Math.max(0, Math.min(240, +el.value || 0)); s.user.updatedAt = Date.now(); }); };
C.setting = (el, d) => { store.mutate(s => { s.settings[d.k] = d.k === 'dailyTokenBudget' ? +el.value : el.value.trim(); }); };
C.aiMode = el => { store.mutate(s => { s.settings.aiMode = el.checked ? 'on' : 'off'; }); };
C.req = (el, d) => { store.mutate(s => { const p = s.procedures.find(x => x.id === d.proc); p.checked = p.checked || {}; p.checked[d.req] = el.checked; p.updatedAt = Date.now(); }); render(); };
C.deadline = (el, d) => { store.mutate(s => { const p = s.procedures.find(x => x.id === d.proc); const dl = p.deadlines.find(x => x.id === d.dl); dl.date = el.value || null; dl.byUser = !!el.value; p.updatedAt = Date.now(); }); render(); };
C.bandoFile = async el => { const f = el.files[0]; if (!f) return; ui.bandoText = document.getElementById('bando-text')?.value || ''; const t = await readAnyFile(f); if (t) { ui.bandoText = t; } render(); };
C.matFile = async el => { const f = el.files[0]; if (!f) return; ui.matText = document.getElementById('mat-text')?.value || ''; ui.matSrc = document.getElementById('mat-src')?.value || ''; const t = await readAnyFile(f); if (t) ui.matText = t; render(); };
C.packFile = el => { const f = el.files[0]; if (!f) return; f.text().then(t => { try { const p = validatePack(JSON.parse(t)); const existing = new Set(S().customQuestions.map(q => q.id)); const add = p.questions.filter(q => !existing.has(q.id)); store.mutate(s => { s.customQuestions.push(...add); }); toast(`Importate ${add.length} domande da «${p.name}»${p.rejected.length ? `, scartate ${p.rejected.length} non valide` : ''}.`); render(); } catch (e) { toast(e.message || 'Pacchetto non valido.'); } }); };
C.importFile = el => { const f = el.files[0]; if (!f) return; f.text().then(async t => { try { await store.importJSON(t); toast('Progressi ripristinati.'); go('home'); } catch (e) { toast(e.message || 'Backup non valido.'); } }); };

function bindEvents() {
  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el.dataset, el); } });
  document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (!el) return; const fn = C[el.dataset.change]; if (fn) fn(el, el.dataset); });
  document.addEventListener('keydown', e => {
    if (view.name !== 'run' || !run || run.answered || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase(), idx = 'abcde'.indexOf(k); if (idx >= 0 && run.steps[run.i].t === 'mc') A.answer({ i: String(idx) });
  });
}

export async function boot() {
  store = new Store(await pickAdapter());
  await store.load();
  ai = new AIService(() => store.state, () => store.saveSoon());
  bindEvents();
  store.onChange(() => syncSoon());
  if (location.hash.startsWith('#collega=')) {
    const c = decodeLink(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (c && confirm('Collegare questo dispositivo ai progressi salvati in «' + c.repo + '»?')) { store.state.sync = { ...store.state.sync, repo: c.repo, token: c.token, lastError: null }; await store.save(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncTimer) runSync();
    if (document.visibilityState === 'visible' && syncOn() && Date.now() - (S().sync.lastSyncAt || 0) > 120000) runSync();
  });
  window.addEventListener('online', () => runSync());
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.__SINGLE_FILE__) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (store.state.user && (!store.state.nextPlan || store.state.nextPlan.day < dayKey())) store.mutate(s => { s.nextPlan = { day: dayKey(), line: tomorrowLine(s, Date.now() - DAY) }; });
  if (!store.state.user) go('onboarding'); else go(location.hash === '#news' ? 'news' : 'home');
  maybeSystemNotification();
  loadFeed();
  runSync();
  window.addEventListener('beforeunload', () => { if (run) { store.state.current = run; } store.save(); });
}

if (typeof window !== 'undefined' && !window.__NO_BOOT__) boot();
