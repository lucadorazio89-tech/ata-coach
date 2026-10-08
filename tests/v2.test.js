import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, migrate } from '../src/core/store.js';
import { QUESTIONS, TOPICS, PACK_SCHEMA } from '../src/content/seed.js';
import { validatePack, exportPack, quoteFound, acceptAIQuestions } from '../src/engine/packs.js';
import { pickModel, GeminiProvider, MODEL_DEFAULT } from '../src/ai/ai.js';
import { extractLinks, parseRss, mergeFeed } from '../monitor/check-sources.mjs';

test('content v2: almeno 150 domande e un percorso CIAD di 8 argomenti', () => {
  assert.ok(QUESTIONS.length >= 150, 'domande: ' + QUESTIONS.length);
  assert.equal(TOPICS.filter(t => t.subject === 'info').length, 8);
  for (const t of TOPICS) assert.ok(QUESTIONS.filter(q => q.topic === t.id).length >= 4, 'poche domande in ' + t.id);
});

test('migrazione v2: il modello Gemini dismesso viene sostituito', () => {
  const m = migrate({ schemaVersion: 1, settings: { model: 'gemini-2.5-flash', apiKey: 'k' } });
  assert.equal(m.settings.model, 'gemini-flash-latest'); assert.equal(m.settings.apiKey, 'k'); assert.equal(m.schemaVersion, 4);
  assert.deepEqual(m.sourceChecks, {}); assert.deepEqual(m.reports, []);
  assert.equal(migrate({ schemaVersion: 1, settings: { model: 'gemini-3.5-flash' } }).settings.model, 'gemini-3.5-flash');
  assert.equal(emptyState().settings.model, MODEL_DEFAULT);
});

test('AI: scelta automatica del modello quando quello configurato non esiste', async () => {
  const models = [
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
  ];
  assert.equal(pickModel(models), 'gemini-3.5-flash');
  const calls = []; let changed = null;
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.includes('/models?')) return { ok: true, status: 200, json: async () => ({ models }) };
    if (url.includes('vecchio-modello')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ciao' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } }) };
  };
  const p = new GeminiProvider({ apiKey: 'k', model: 'vecchio-modello', fetchFn, onModelChange: m => { changed = m; } });
  const r = await p.generate({ system: 's', prompt: 'p' });
  assert.equal(r.text, 'ciao'); assert.equal(changed, 'gemini-3.5-flash'); assert.equal(calls.length, 3);
  const withFile = await p.generate({ system: 's', prompt: 'p', file: { mimeType: 'image/jpeg', data: 'AAAA' } });
  assert.equal(withFile.text, 'ciao');
});

test('pacchetti: validazione, scarti ed esportazione', () => {
  const pack = { schema: PACK_SCHEMA, name: 'Prova', questions: [
    { id: 'p1', topic: 't_241', text: 'Termine generale del procedimento?', options: ['30 giorni', '90 giorni'], answer: 0, explanation: 'Art. 2' },
    { id: 'p2', topic: 'inesistente', text: 'Domanda sbagliata?', options: ['a', 'b'], answer: 0 },
    { id: 'p3', topic: 't_241', text: 'Opzioni doppie?', options: ['a', 'a'], answer: 0 },
    { id: 'p4', topic: 't_241', text: 'Risposta fuori range?', options: ['a', 'b'], answer: 5 }
  ] };
  const r = validatePack(pack);
  assert.equal(r.questions.length, 1); assert.equal(r.rejected.length, 3);
  assert.equal(r.questions[0].verified, false); assert.match(r.questions[0].origin, /pacchetto/);
  assert.throws(() => validatePack({ schema: 'altro', questions: [] }));
  const again = validatePack(JSON.parse(exportPack(r.questions)));
  assert.equal(again.questions.length, 1); assert.equal(again.questions[0].id, r.questions[0].id);
});

test('domande AI: tenute solo se la citazione è davvero nel testo', () => {
  const text = 'Ove il procedimento consegua obbligatoriamente ad una istanza, ovvero debba essere iniziato d\'ufficio, le pubbliche amministrazioni hanno il dovere di concluderlo mediante l\'adozione di un provvedimento espresso. Nei casi in cui disposizioni di legge non prevedono un termine diverso, i procedimenti devono concludersi entro il termine di trenta giorni.';
  assert.ok(quoteFound('i procedimenti devono concludersi entro il termine di trenta giorni', text));
  assert.ok(!quoteFound('i procedimenti devono concludersi entro novanta giorni lavorativi dal protocollo', text));
  const data = { questions: [
    { text: 'Termine generale?', options: ['30 giorni', '60 giorni', '90 giorni', '120 giorni'], answer: 0, explanation: 'x', quote: 'devono concludersi entro il termine di trenta giorni' },
    { text: 'Domanda inventata?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'x', quote: 'il silenzio vale sempre come rigetto definitivo' }
  ] };
  const r = acceptAIQuestions(data, text, 't_241', 'L. 241/1990 art. 2');
  assert.equal(r.ok.length, 1); assert.equal(r.rejected.length, 1);
  assert.equal(r.ok[0].origin, 'ai'); assert.equal(r.ok[0].sourceNote, 'L. 241/1990 art. 2');
});

test('monitor: estrae solo i link pertinenti e riconosce le novità', () => {
  const kws = ['ata', 'graduatori', 'ciad'];
  const html = `<a href="/news/2027/aggiornamento-graduatorie-terza-fascia-ata">Aggiornamento graduatorie di terza fascia ATA 2027-2030</a>
    <a href="https://www.mim.gov.it/contatti">Contatti</a><a href="/x">ATA</a>
    <a href='/doc/nota-ciad.pdf'>Nota sulla certificazione CIAD &amp; requisiti</a>`;
  const links = extractLinks(html, 'https://www.mim.gov.it/home', kws);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://www.mim.gov.it/news/2027/aggiornamento-graduatorie-terza-fascia-ata');
  assert.match(links[1].title, /& requisiti/);
  const rss = `<rss><channel><item><title><![CDATA[Graduatorie ATA: avviso]]></title><link>https://usr.example.it/a</link><pubDate>Mon, 01 Mar 2027</pubDate></item><item><title>Concorso docenti</title><link>https://usr.example.it/b</link></item></channel></rss>`;
  const items = parseRss(rss, kws);
  assert.equal(items.length, 1); assert.equal(items[0].url, 'https://usr.example.it/a');
  const first = mergeFeed({ items: [] }, links, [], '2027-03-01T10:00:00Z');
  assert.equal(first.added.length, 2);
  const second = mergeFeed(first.feed, [...links, { title: 'Nuovo avviso graduatorie ATA', url: 'https://www.mim.gov.it/nuovo' }], [], '2027-03-02T10:00:00Z');
  assert.equal(second.added.length, 1); assert.equal(second.feed.items[0].url, 'https://www.mim.gov.it/nuovo');
});

test('monitor: "ata" non scatta su parole come "giornata"', () => {
  const html = `<a href="/a">Giornata della memoria approvata dal consiglio</a><a href="/b">Personale ATA: nuove supplenze dal 1 settembre</a>`;
  const links = extractLinks(html, 'https://x.it/', ['ata']);
  assert.equal(links.length, 1); assert.equal(links[0].url, 'https://x.it/b');
});
