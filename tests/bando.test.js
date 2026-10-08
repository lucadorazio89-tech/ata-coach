// v0.4: avviso del bando a Giorgia — classificazione delle novità, notifica solo per ciò che conta, migrazione delle procedure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, mergeFeed } from '../monitor/check-sources.mjs';
import { migrate, emptyState } from '../src/core/store.js';
import { mergePayloads } from '../src/core/sync.js';
import { PROCEDURE_TEMPLATES } from '../src/content/seed.js';

test('il bando di terza fascia viene riconosciuto in tutte le forme tipiche dei titoli', () => {
  for (const t of [
    "Graduatorie di circolo e d'istituto di terza fascia personale ATA: decreto per il triennio 2027/30",
    'Personale ATA, presentazione delle domande di inserimento nelle graduatorie di III fascia',
    'Aggiornamento graduatorie ATA 2027: le istruzioni',
    'Graduatorie ATA terza fascia: apertura delle istanze'
  ]) assert.equal(classify(t), 'bando', t);
});

test('CIAD e contratto firmato sono «requisiti»; il resto non fa notifica', () => {
  assert.equal(classify('Certificazione internazionale di alfabetizzazione digitale (CIAD): chiarimenti'), 'requisiti');
  assert.equal(classify('Ipotesi di CCNL Istruzione e Ricerca 2025-2027 sottoscritta'), 'requisiti');
  for (const t of ['Graduatorie ATA 24 mesi: pubblicato il bando per l\'a.s. 2027/28', 'Supplenze docenti: convocazioni del 12 settembre',
    'Giornata della memoria nelle scuole', 'Personale ATA: mobilità 2027/28', 'Approvata la graduatoria del concorso docenti'])
    assert.equal(classify(t), 'notizia', t);
});

test('il feed salva il tipo di ogni novità e non contiene più «DA VERIFICARE»', () => {
  const { feed, added } = mergeFeed({ items: [] }, [{ title: 'Personale ATA: domande per le graduatorie di terza fascia 2027', url: 'https://www.mim.gov.it/x' }], []);
  assert.equal(added[0].kind, 'bando');
  assert.doesNotMatch(feed.note, /VERIFICARE/);
});

test('migrazione v4: procedure aggiornate, spunte e date scritte da Giorgia conservate', () => {
  const old = emptyState(); old.schemaVersion = 3;
  old.procedures = [{ id: 'p_terza2027', name: 'vecchio', verified: false, type: 'titoli', subjects: [], requirements: [], checked: { r_ciad: true },
    deadlines: [{ id: 'd_open', label: 'Apertura domande', date: '2027-05-20', byUser: true, status: 'da_verificare' }] },
    { id: 'p_mio', name: 'Bando importato', custom: true, requirements: [], deadlines: [], subjects: [] }];
  const m = migrate(old);
  const p = m.procedures.find(x => x.id === 'p_terza2027');
  assert.equal(p.verified, true); assert.equal(p.rev, 2); assert.doesNotMatch(p.summary, /VERIFICARE/);
  assert.equal(p.checked.r_ciad, true);
  assert.equal(p.deadlines[0].date, '2027-05-20'); assert.equal(p.deadlines[0].byUser, true);
  assert.ok(m.procedures.find(x => x.id === 'p_mio'), 'le procedure di Giorgia restano');
  assert.deepEqual(m.alertsDone, {});
  assert.equal(migrate(JSON.parse(JSON.stringify(m))).procedures.find(x => x.id === 'p_terza2027').updatedAt, p.updatedAt, 'non rimigra');
});

test('nessuna procedura ufficiale mostra «da verificare»', () => {
  for (const p of PROCEDURE_TEMPLATES) {
    assert.doesNotMatch(JSON.stringify(p), /verificar/i, p.id);
  }
});

test('«avviso letto» si sincronizza tra telefono e computer', () => {
  const m = mergePayloads({ alertsDone: { a: 5 } }, { alertsDone: { b: 7, a: 3 } });
  assert.deepEqual(m.alertsDone, { a: 5, b: 7 });
});
