// Pacchetti di domande importabili ed esportabili, e verifica delle domande generate dall'AI.
import { uid, normalizeText } from '../core/util.js';
import { TOPICS, PACK_SCHEMA } from '../content/seed.js';

function cleanQuestion(raw, defaults = {}) {
  const errors = [];
  const q = {
    id: raw.id && /^[\w-]{2,40}$/.test(raw.id) ? 'x_' + raw.id.replace(/^x_/, '') : uid('qx'),
    topic: raw.topic || defaults.topic, type: 'mc', level: raw.level === 'applicazione' ? 'applicazione' : 'riconoscimento',
    difficulty: [1, 2, 3].includes(raw.difficulty) ? raw.difficulty : 2,
    text: String(raw.text || '').trim(), options: Array.isArray(raw.options) ? raw.options.map(o => String(o).trim()) : [],
    answer: Number(raw.answer), explanation: String(raw.explanation || '').trim(), source: null,
    sourceNote: raw.sourceNote ? String(raw.sourceNote).slice(0, 300) : (defaults.sourceNote || null),
    quote: raw.quote ? String(raw.quote).slice(0, 500) : null, trap: null, origin: defaults.origin || 'pacchetto', verified: false
  };
  if (!TOPICS.find(t => t.id === q.topic)) errors.push('argomento non valido');
  if (q.text.length < 8) errors.push('testo troppo corto');
  if (q.options.length < 2 || q.options.length > 5 || q.options.some(o => !o)) errors.push('opzioni non valide');
  if (new Set(q.options).size !== q.options.length) errors.push('opzioni duplicate');
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) errors.push('risposta non valida');
  return { q, errors };
}

export function validatePack(obj) {
  if (!obj || obj.schema !== PACK_SCHEMA || !Array.isArray(obj.questions)) throw new Error('Il file non è un pacchetto di domande ATA Coach.');
  const ok = [], rejected = [];
  obj.questions.forEach((raw, i) => { const { q, errors } = cleanQuestion(raw, { origin: 'pacchetto: ' + String(obj.name || 'senza nome').slice(0, 60) }); (errors.length ? rejected.push({ i: i + 1, errors }) : ok.push(q)); });
  return { name: obj.name || 'Pacchetto', questions: ok, rejected };
}

export function exportPack(questions, name = 'Le mie domande') {
  return JSON.stringify({ schema: PACK_SCHEMA, name, createdAt: new Date().toISOString(),
    questions: questions.map(({ id, topic, level, difficulty, text, options, answer, explanation, sourceNote, quote }) => ({ id, topic, level, difficulty, text, options, answer, explanation, sourceNote, quote })) }, null, 1);
}

// Una domanda generata dall'AI viene tenuta solo se la citazione si ritrova davvero nel testo fonte.
export function quoteFound(quote, sourceText) {
  const qn = normalizeText(quote), sn = normalizeText(sourceText);
  if (qn.length < 12) return false;
  if (sn.includes(qn)) return true;
  const words = qn.split(' ').filter(w => w.length > 3);
  if (words.length < 3) return false;
  const hit = words.filter(w => sn.includes(w)).length;
  return hit / words.length >= 0.85;
}

export function acceptAIQuestions(data, sourceText, topic, sourceNote) {
  const ok = [], rejected = [];
  for (const raw of (data && data.questions) || []) {
    const { q, errors } = cleanQuestion({ ...raw, topic }, { topic, origin: 'ai', sourceNote });
    if (!raw.quote || !quoteFound(raw.quote, sourceText)) errors.push('citazione non trovata nel testo');
    (errors.length ? rejected.push({ text: q.text, errors }) : ok.push(q));
  }
  return { ok, rejected };
}
