// Livello AI astratto. L'app funziona con ZERO chiamate: ogni task ha un fallback offline.
import { hashStr, dayKey, uid } from '../core/util.js';

export class AIUnavailable extends Error { constructor(reason) { super(reason); this.reason = reason; } }
export const estimateTokens = s => Math.ceil(String(s || '').length / 4);

export class OfflineProvider {
  constructor() { this.name = 'offline'; }
  async generate() { throw new AIUnavailable('offline'); }
}

// Google Gemini (AI Studio). Default: alias "gemini-flash-latest", che punta sempre al Flash più recente.
// Se il modello configurato non esiste più (404), interroga l'elenco dei modelli e ne sceglie uno Flash funzionante.
export const MODEL_DEFAULT = 'gemini-flash-latest';
export function pickModel(models) {
  const ok = models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  const score = n => (n.includes('flash') ? 100 : 0) - (n.includes('lite') ? 5 : 0) - (/preview|exp|image|tts|live|audio|embedding|robotics/.test(n) ? 50 : 0) + (parseFloat((n.match(/(\d+(\.\d+)?)/) || [0, 0])[1]) || 0);
  return ok.sort((a, b) => score(b) - score(a))[0] || null;
}
export class GeminiProvider {
  constructor({ apiKey, model = MODEL_DEFAULT, fetchFn = null, onModelChange = null }) { this.name = 'gemini'; this.apiKey = apiKey; this.model = model || MODEL_DEFAULT; this.fetch = fetchFn || ((...a) => fetch(...a)); this.onModelChange = onModelChange; }
  async call(model, body) {
    try { return await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body) }); }
    catch { throw new AIUnavailable('rete non disponibile'); }
  }
  async discover() {
    try {
      const r = await this.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': this.apiKey } });
      if (!r.ok) return null; const d = await r.json(); return pickModel(d.models || []);
    } catch { return null; }
  }
  async generate({ system, prompt, maxTokens = 400, json = false, file = null }) {
    if (!this.apiKey) throw new AIUnavailable('chiave API mancante');
    const parts = [{ text: prompt }];
    if (file) parts.unshift({ inlineData: { mimeType: file.mimeType, data: file.data } });
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) } };
    let res = await this.call(this.model, body);
    if (res.status === 404) {                      // modello dismesso: ne cerco uno valido
      const m = await this.discover();
      if (!m || m === this.model) throw new AIUnavailable('nessun modello disponibile');
      this.model = m; if (this.onModelChange) this.onModelChange(m);
      res = await this.call(m, body);
    }
    if (res.status === 400) throw new AIUnavailable('richiesta non valida o chiave errata');
    if (res.status === 403) throw new AIUnavailable('chiave API non autorizzata');
    if (res.status === 429) throw new AIUnavailable('limite di richieste di Google raggiunto, riprova più tardi');
    if (!res.ok) throw new AIUnavailable(`errore ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return { text, tokensIn: data.usageMetadata?.promptTokenCount ?? estimateTokens(system + prompt), tokensOut: data.usageMetadata?.candidatesTokenCount ?? estimateTokens(text) };
  }
}

const RULES = 'Rispondi in italiano semplice. Non inventare norme, date o numeri. Se non sei certo scrivi "DA VERIFICARE". Cita la norma solo se è nel contesto fornito.';

// Prompt compatti per task. maxTokens bassi di default.
export const TASKS = {
  explain: { maxTokens: 350, system: `Sei un tutor per il concorso ATA. ${RULES}`, build: i => `Argomento: ${i.topic}\nTesto lezione: ${i.lesson}\nSpiega di nuovo in massimo 120 parole con un esempio pratico di segreteria scolastica.` },
  simplify: { maxTokens: 250, system: `Sei un tutor paziente. ${RULES}`, build: i => `La studentessa non ha capito niente di: ${i.topic}. Punti chiave: ${i.keyPoints.join('; ')}. Spiega come a chi parte da zero, max 90 parole, una sola analogia.` },
  gradeOpen: { maxTokens: 300, json: true, system: `Correggi risposte aperte. ${RULES} Rispondi SOLO JSON: {"score":0-1,"ok":[..],"missing":[..],"feedback":"max 40 parole"}`, build: i => `Domanda: ${i.question}\nRisposta modello: ${i.model}\nRisposta studentessa: ${i.answer}` },
  analyzeBando: { maxTokens: 900, json: true, system: `Estrai dati da un bando pubblico. ${RULES} Rispondi SOLO JSON: {"titolo":"","ente":"","tipo":"titoli|esame|altro","profili":[],"requisiti":[],"scadenze":[{"descrizione":"","data":"AAAA-MM-GG o null","citazione":""}],"materie":[],"note":[]}. Per ogni scadenza riporta la frase del testo in "citazione".`, build: i => `Testo del bando:\n${i.text.slice(0, 12000)}` },
  readFile: { maxTokens: 4000, system: `Trascrivi fedelmente il testo del documento o della foto allegata, senza riassumere e senza aggiungere nulla. ${RULES}`, build: () => 'Trascrivi il testo.' },
  generateQuestions: { maxTokens: 1200, json: true, system: `Crea domande a scelta multipla SOLO dal testo fornito. ${RULES} Rispondi SOLO JSON: {"questions":[{"text":"","options":["","","",""],"answer":0,"explanation":"","quote":"frase del testo che giustifica la risposta"}]}`, build: i => `Argomento: ${i.topic}\nCrea ${i.n} domande.\nTesto fonte:\n${i.text.slice(0, 6000)}` }
};

export class AIService {
  // getState: () => state ; persist: () => void ; providerFactory: settings => provider
  constructor(getState, persist, providerFactory = null) {
    this.getState = getState; this.persist = persist;
    this.providerFactory = providerFactory || (s => s.aiMode === 'on' && s.apiKey ? new GeminiProvider({ apiKey: s.apiKey, model: s.model, onModelChange: m => { s.model = m; this.persist(); } }) : new OfflineProvider());
  }
  usedToday() { const k = dayKey(); return this.getState().aiLog.filter(l => dayKey(l.at) === k && !l.cached).reduce((a, l) => a + l.tokensIn + l.tokensOut, 0); }
  status() { const s = this.getState().settings; return { mode: s.aiMode, hasKey: !!s.apiKey, used: this.usedToday(), budget: s.dailyTokenBudget }; }

  // Ritorna { ok, text|data, cached } oppure { ok:false, reason } → il chiamante usa il fallback offline.
  async run(taskName, input, file = null) {
    const state = this.getState(), s = state.settings, task = TASKS[taskName];
    if (!task) throw new Error('Task AI sconosciuto: ' + taskName);
    if (s.aiMode !== 'on') return { ok: false, reason: 'AI disattivata' };
    const prompt = task.build(input);
    const key = hashStr(taskName + '|' + s.model + '|' + prompt + (file ? '|' + hashStr(file.data) : ''));
    const hit = state.aiCache[key];
    if (hit) { state.aiLog.push({ id: uid('ai'), at: Date.now(), task: taskName, tokensIn: 0, tokensOut: 0, cached: true, provider: 'cache' }); this.persist(); return { ok: true, cached: true, ...hit.output }; }
    const estimate = estimateTokens(task.system + prompt) + task.maxTokens + (file ? 1500 : 0);
    if (this.usedToday() + estimate > s.dailyTokenBudget) return { ok: false, reason: 'limite giornaliero di token raggiunto' };
    try {
      const provider = this.providerFactory(s);
      const r = await provider.generate({ system: task.system, prompt, maxTokens: task.maxTokens, json: !!task.json, file });
      let output = { text: r.text };
      if (task.json) { try { output = { data: JSON.parse(r.text.replace(/```json|```/g, '').trim()) }; } catch { return { ok: false, reason: 'risposta AI non valida' }; } }
      state.aiCache[key] = { at: Date.now(), output };
      state.aiLog.push({ id: uid('ai'), at: Date.now(), task: taskName, tokensIn: r.tokensIn, tokensOut: r.tokensOut, cached: false, provider: provider.name });
      this.trimCache(state);
      this.persist();
      return { ok: true, cached: false, ...output };
    } catch (e) {
      return { ok: false, reason: e instanceof AIUnavailable ? e.reason : 'errore imprevisto' };
    }
  }
  trimCache(state, max = 300) {
    const keys = Object.keys(state.aiCache);
    if (keys.length > max) keys.sort((a, b) => state.aiCache[a].at - state.aiCache[b].at).slice(0, keys.length - max).forEach(k => delete state.aiCache[k]);
    if (state.aiLog.length > 2000) state.aiLog.splice(0, state.aiLog.length - 2000);
  }
}
