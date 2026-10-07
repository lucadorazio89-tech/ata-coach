# ATA Coach — documento di progetto

Versione 0.2 — 7 ottobre 2026 (la sezione 8 elenca cosa è cambiato rispetto alla 0.1)

## 1. Analisi critica

### Il punto più importante: per la terza fascia ATA non c'è un esame da preparare

Le graduatorie ATA di terza fascia, il canale d'ingresso per chi parte da zero, si formano **per soli titoli**: niente prove scritte né orali. Il prossimo aggiornamento (triennio 2027–2030) è atteso dalla stampa specializzata nella primavera 2027, ma **non c'è ancora una data ufficiale** (DA VERIFICARE).

Per il triennio 2024–2027 il D.M. 89/2024 ha chiesto all'assistente amministrativo **diploma + CIAD** (certificazione internazionale di alfabetizzazione digitale) come requisito d'accesso, e chi non l'ha presentata in tempo è stato escluso.

Conseguenze sul prodotto:

1. **Il vero "esame" con scadenza è la CIAD.** Se Giorgia non ce l'ha, è la priorità assoluta, prima di qualsiasi normativa. L'onboarding lo chiede subito, la home lo segnala in rosso, l'obiettivo "CIAD" sposta i pesi del motore sull'informatica.
2. **"Analizza bando" deve produrre una checklist di requisiti e scadenze**, non solo un piano di studio. Per una graduatoria per titoli lo stato "pronta / quasi / non pronta" dipende dai requisiti, non dalla percentuale dei quiz.
3. **Lo studio della normativa serve a lavorare bene quando arriva la convocazione** (e a eventuali concorsi futuri, es. DSGA, o a colloqui). Per questo le lezioni sono costruite su casi di segreteria ("In segreteria…").
4. Il punteggio in graduatoria dipende da titoli e servizio: il software può aiutare a pianificare titoli aggiuntivi, ma i valori dei titoli vanno presi dal bando ufficiale (fase 2, con fonti verificate).

### Altre correzioni al brief

| Idea originale | Problema | Soluzione adottata |
|---|---|---|
| Home con 10 pulsanti equivalenti | Dieci scelte sono esattamente la fatica decisionale che vogliamo togliere | Un solo pulsante dominante **Fai tu**; sotto, "Ho solo 10/20/30/45/60′" e "Non ho voglia: 5 minuti". Le altre voci in una griglia secondaria |
| "Inizia oggi", "Cosa devo fare?", "Continua", "Fai tu" separati | Fanno quasi la stessa cosa | "Inizia oggi" = onboarding; "Fai tu" decide; "Cosa devo fare oggi?" mostra il perché del piano; "Continua da dove eri" compare solo quando serve |
| "Non ho capito" in home | Non ha senso fuori contesto | È dentro ogni lezione e ogni correzione, insieme a "Non ho capito niente" |
| Monitoraggio automatico dei siti ufficiali da app | Un'app nel browser non può leggere mim.gov.it (blocco CORS) | Fase 2: piccolo job programmato (es. GitHub Actions) o versione desktop Tauri, che pubblica un JSON di novità firmato |
| Notifiche affidabili da PWA | Senza server, il browser notifica solo con l'app aperta | Promemoria esportabili nel calendario del telefono (.ics, funziona sempre) + notifiche browser come extra |
| Chiedere sempre "quanto sei sicura?" | Un tap in più per ogni domanda stanca | Pulsante facoltativo "Non sono sicura" prima di rispondere e "Non lo so" sempre visibile |
| Test diagnostico che registra errori | Dopo l'iscrizione comparivano 20+ errori da ripassare | Le risposte sbagliate del test iniziale sono lacune, non errori: aggiornano il profilo ma non creano ripassi |
| Domande generate dall'AI sulla normativa | Rischio di inventare norme | Le domande AI si generano solo da un testo fornito, con citazione obbligatoria, e restano marcate "DA VERIFICARE" |

### Cosa mancava

- **Distinzione tra lacuna ed errore** (vedi sopra).
- **Recupero senza senso di colpa** dopo giorni saltati: sessione corta, ripassi arretrati limitati e distribuiti.
- **Trasparenza del motore**: ogni sessione spiega perché ha scelto quell'argomento.
- **Backup automatico locale** (una copia al giorno, ultime 7) oltre all'export manuale.
- **Condivisione del riepilogo** con un familiare via messaggio, già nell'MVP, al posto di una dashboard che richiederebbe un server.

## 2. Architettura

### Scelta: PWA local-first, impacchettabile con Tauri in fase 2

| Opzione | Pro | Contro |
|---|---|---|
| **PWA** (scelta) | Un solo codice per PC e telefono, installabile, offline, aggiornamenti automatici, zero installazione | Notifiche limitate, niente accesso libero alla rete (CORS), storage del browser |
| Tauri | Leggero (~10 MB), SQLite, notifiche native, rete senza CORS | Build per piattaforma, aggiornamenti da gestire |
| Electron | Maturo | Pesante (~150 MB), più manutenzione |

Giorgia probabilmente studia anche dal telefono: la PWA copre tutti i dispositivi da subito. Il codice è separato in moduli senza dipendenze dal browser (tranne UI e adapter), quindi in fase 2 si può avvolgere in Tauri per monitoraggio fonti, SQLite e notifiche native senza riscrivere nulla.

Nessun framework e nessuna dipendenza npm: meno manutenzione, niente build complessa, codice leggibile.

### Moduli (separati come richiesto)

```
src/
  core/util.js         utilità
  core/store.js        database locale (IndexedDB → localStorage → memoria), migrazioni, backup
  content/seed.js      content pack: materie, argomenti, lezioni, domande, fonti, template bandi
  engine/learning.js   motore didattico (modello per argomento, memoria, cause d'errore, falsa preparazione)
  engine/srs.js        spaced repetition
  engine/quiz.js       motore quiz (modalità, diagnostico, simulazione, correzione aperte offline)
  engine/scheduler.js  motore di pianificazione (priorità, sessioni, calendario, recupero, "DOMANI")
  engine/reporting.js  report sessione / settimana / mese / bando, previsione
  engine/bando.js      document processing: analisi bandi a regole
  ai/ai.js             provider AI astratto, Gemini, cache, budget token
  ui/                  interfaccia (unico modulo che tocca il DOM)
  sw.js                service worker (offline)
```

Verifica delle fonti: ogni fonte ha `official`, `status` (`consolidata` / `da_verificare`) e `reviewedAt`; ogni domanda e requisito punta a una fonte. Le notifiche "DA VERIFICARE" sono generate dallo stato delle fonti e dei bandi.

## 3. Modello dati

Lo **stato utente** (progressi) è separato dal **content pack** (contenuti versionati). Così si possono aggiornare le lezioni senza toccare i progressi, e viceversa.

| Entità richiesta | Dove vive |
|---|---|
| User, Goal | `state.user` (profilo, obiettivo, disponibilità per giorno, CIAD sì/no) · `GOALS` con pesi per materia |
| Procedure/Bando | `PROCEDURE_TEMPLATES` → copiati in `state.procedures` (requisiti spuntabili, scadenze, stato verifica) |
| Topic, Subtopic | `SUBJECTS` (materia) → `TOPICS` (argomento, importanza, prerequisiti) |
| Lesson, Resource | `LESSONS` (testo, esempio pratico, punti chiave, versione semplice, fonti) |
| Source, Regulation | `SOURCES` (titolo, riferimento, URL Normattiva/EUR-Lex, ufficiale sì/no, stato, data revisione) |
| Question | `QUESTIONS` (scelta multipla, livello, difficoltà, distrattore) · `OPEN_QUESTIONS` · `state.customQuestions` |
| Attempt | `state.attempts` (risposta, tempo, incertezza, sessione) |
| Error | `state.errors` (causa stimata, causa scelta dall'utente, risolto) |
| Review | `state.cards` (stato spaced repetition per domanda) |
| StudySession, Report | `state.sessions` con `report` incorporato |
| DailyPlan, WeeklyPlan | `state.plans[giorno]` · calendario proiettato calcolato al volo |
| Notification | calcolate da regole (`computeNotices`) + `state.notifications` |
| Document | `state.documents` (testi di bandi importati) |
| AIRequest/Response | `state.aiLog` (token, provider, cache) · `state.aiCache` |

Statistiche per argomento (`state.topicStats`): livello teorico, capacità pratica, accuratezza quiz (media mobile), stabilità della memoria, ultimo ripasso, errori aperti, risultati per livello (riconoscimento / applicazione / spiegazione), risposte indovinate, "non ho capito".

## 4. Motore didattico e di pianificazione

**Memoria stimata**: curva dell'oblio `R = e^(−giorni/S)`. La stabilità `S` cresce con le risposte giuste (di più se arrivano dopo un intervallo) e cala con quelle sbagliate.

**Padronanza** di un argomento: `(0,45·accuratezza·confidenza + 0,25·teoria + 0,30·pratica) × (0,6 + 0,4·R)`. La "confidenza" pesa poco l'accuratezza finché le risposte sono poche.

**Priorità** (come richiesto, come prodotto di fattori):

```
importanza × debolezza × errori × memoria × urgenza × prerequisiti × varietà
```

- importanza = importanza argomento × peso della materia per l'obiettivo scelto
- debolezza = 0,15 + 0,85·(1 − padronanza)
- errori = 1 + 0,25 per errore aperto (max 4)
- memoria = 0,3 + 0,7·(1 − R)
- urgenza = 1 + 1,5/(1 + giorni alla scadenza/21)
- prerequisiti = 0,3 se un argomento di base è sotto il 30%
- varietà = 0,5 se già studiato oggi

**Tempo disponibile**: entra nella costruzione della sessione. Con 10 minuti metà ripasso e niente lezione lunga (se esiste un argomento già avviato); con 30+ minuti ripasso 25–30%, lezione se l'argomento è nuovo, quiz, una domanda aperta se avanzano almeno 15 minuti.

**Cause d'errore** (stimate senza AI, modificabili dall'utente): concetto mai visto, confusione, dimenticanza, distrattore (ogni domanda indica il distrattore più insidioso), lettura frettolosa (<3,5 s), applicazione, tempo, falsa sicurezza.

**Falsa preparazione**: segnalata quando l'accuratezza in riconoscimento è alta (≥75%) ma bassa nelle domande di applicazione o nelle spiegazioni a parole, oppure quando oltre il 40% delle risposte giuste era dichiarata "non sicura".

**Spaced repetition**: SM-2 semplificato (1 → 3 → intervallo × facilità), risposte incerte con intervallo ridotto, massimo 120 giorni.

**Fine sessione**: report automatico (tempo, attività, punteggio, errori per causa, miglioramenti, criticità, cosa ripassare) che termina sempre con
`DOMANI: X minuti – argomento A – ripasso: B – N quiz`.

## 5. Integrazione AI

- Interfaccia unica `provider.generate({system, prompt, maxTokens, json})`; oggi `GeminiProvider` (API Google AI Studio, header `x-goog-api-key`) e `OfflineProvider`. Aggiungere un altro provider = una classe.
- Il modello è un'impostazione (default `gemini-flash-latest`, alias aggiornato da Google). Se il modello configurato risponde 404, il provider legge l'elenco dei modelli e passa a un Flash disponibile, salvando la scelta.
- **Zero AI di default.** Ogni task ha un fallback offline: versione semplice della lezione, correzione a parole chiave + autovalutazione, analisi bando a regole.
- Risparmio: cache per hash del prompt (risposte uguali gratis), prompt compatti, `maxOutputTokens` bassi per task, limite giornaliero di token, log dei consumi, batching dove ha senso (le domande si generano a gruppi in una chiamata).
- Regole anti-invenzione nel prompt di sistema; le scadenze estratte dall'AI devono includere la frase citata dal testo.
- Limite noto: con la chiave nel browser, chi ha accesso al dispositivo può leggerla. Per un uso familiare è accettabile; in fase 2 un piccolo proxy la tiene sul server.

## 6. MVP (questa versione)

Fatto e funzionante senza AI: onboarding, test diagnostico, profilo per argomento, 8 materie / 14 argomenti / 14 lezioni / 56 domande a scelta multipla / 6 domande aperte, piano automatico "Fai tu", sessioni da 5 a 60 minuti, modalità "non ho voglia", ripasso errori, test per materia, simulazione a tempo, interrogazione, registro errori con cause, spaced repetition, calendario a 14 giorni, recupero dopo assenze, report di sessione / settimana / mese / bando, previsione, bandi con requisiti e scadenze, analisi bandi a regole, avvisi, backup automatico + export/import, promemoria .ics, tema chiaro/scuro, AI opzionale con cache e budget. 22 test automatici.

## 7. Roadmap

**Fase 2**
- Content pack più ampio (obiettivo: 400+ domande), rivisto da una persona su Normattiva; editor dei contenuti.
- Import PDF (pdf.js) e foto (AI vision) per bandi e appunti.
- Monitoraggio fonti: job programmato che controlla le pagine del Ministero/USR e pubblica un feed; l'app mostra "contenuto aggiornato".
- Wrapper Tauri: SQLite, notifiche native, monitoraggio dalla macchina.
- Audio di ripasso (sintesi vocale del browser, gratis e offline).
- Simulazioni per bando con distribuzione per materia dal bando reale; previsioni per materia.
- Dashboard familiare con sincronizzazione opzionale e consenso di Giorgia.

**Da decidere insieme**
- Quale ente CIAD scegliere (va verificato l'accreditamento) e se l'app debba includere un percorso CIAD dedicato.
- Se esistono concorsi con prove a cui Giorgia vuole puntare (il concorso DSGA, per esempio, richiede una laurea specifica: da verificare sul bando).


## 8. Versione 0.2: i limiti della 0.1 superati

| Limite della 0.1 | Soluzione nella 0.2 |
|---|---|
| Uso legato a Claude (artifact) | Sito personale gratuito su GitHub Pages, installabile come app su telefono e PC; in alternativa il file unico `dist/ata-coach.html`. Guida passo passo in `GUIDA.md` |
| AI e download bloccati nell'artifact | Fuori da Claude funzionano entrambi. Inoltre: modello predefinito `gemini-flash-latest` (il precedente `gemini-2.5-flash` viene spento il 16/10/2026), scoperta automatica di un modello valido, pulsante «Prova la connessione», messaggi d'errore chiari |
| Poche domande | Da 56 a 161 domande a scelta multipla e da 6 a 11 aperte, da 14 a 24 argomenti, 25 fonti. Nuovo percorso CIAD in 8 argomenti sul modello europeo DigComp e nuova materia «Il lavoro in segreteria». Opzioni mescolate a ogni presentazione. Domande illimitate con l'AI da testi ufficiali (scartate se la citazione non è nel testo) e pacchetti `.json` importabili/esportabili |
| Norme da verificare | Procedura di verifica fonte per fonte con data e scadenza a 12 mesi, numero di domande collegate a ogni fonte, segnalazione degli errori dalla singola domanda |
| Monitoraggio dei siti impossibile dal browser | `monitor/check-sources.mjs` gira su GitHub Actions tre volte al giorno, estrae i link pertinenti (parole chiave, «ata» solo come parola intera), aggiorna `feed.json`, ripubblica il sito; l'app mostra le novità e i siti che hanno rifiutato il controllo. Segno di vita ogni 25 giorni perché GitHub non disattivi le azioni |
| Notifiche affidabili solo via calendario | Web Push: l'app genera le chiavi VAPID sul dispositivo; GitHub Actions invia il promemoria giornaliero e gli avvisi sulle novità; il service worker personalizza il testo con i dati locali («OGGI: 30 minuti – …» oppure «oggi hai già studiato») |
| PDF e foto non importabili | PDF con testo letti sul dispositivo (pdf.js); PDF scansionati e foto letti con Gemini |

Limiti che restano, per onestà:
- La correttezza giuridica finale la garantisce solo una persona che verifica le fonti: l'app ora lo rende semplice e tracciabile, ma non lo sostituisce.
- Alcuni siti pubblici rifiutano i controlli automatici dai server di GitHub; in quel caso l'app lo segnala e rimanda al controllo manuale.
- Su iPhone le notifiche push richiedono l'app aggiunta alla schermata Home (iOS 16.4+).
- La chiave Gemini sta sul dispositivo di Giorgia; con il piano gratuito Google può usare i testi inviati per migliorare i propri servizi.


## 9. Versione 0.3: sincronizzazione tra dispositivi

- **Dove:** un repository GitHub **privato** (es. `utente/ata-coach-dati`), file `ata-coach-sync.json`, tramite l'API Contents. Scelto al posto di Google Drive perché non richiede un progetto Google Cloud né riautorizzazioni periodiche, e usa lo stesso account del sito.
- **Chiave:** token GitHub *fine-grained* limitato a quel solo repository, permesso Contents: lettura e scrittura. Resta sul dispositivo e non finisce nei backup. Un secondo dispositivo si collega con un codice (o un link) che contiene repository e chiave.
- **Unione, non copia:** risposte, sessioni, lezioni ed errori vengono uniti per identificativo; profilo e bandi vincono per data di modifica; le cancellazioni viaggiano come «lapidi» (tombstones). Statistiche e ripassi non vengono sincronizzati ma **ricalcolati** rigiocando la storia (`rebuildDerived`): due dispositivi che hanno studiato offline arrivano allo stesso stato, identico a quello che si avrebbe studiando su uno solo (verificato dai test).
- **Conflitti:** se l'altro dispositivo scrive nel frattempo (HTTP 409), si rilegge, si riunisce e si riprova (fino a 3 volte). Se nulla è cambiato non si scrive.
- **Quando:** all'apertura, al ritorno sull'app dopo più di 2 minuti, 2 secondi dopo la fine di una sessione, 45 secondi dopo una modifica, alla chiusura se c'è una modifica in sospeso, al ritorno della connessione.
- **Primo collegamento:** il profilo già salvato vince su quello appena creato sul nuovo dispositivo.
- **Restano locali:** impostazioni, chiavi (AI, notifiche, sincronizzazione), cache AI, sessione in corso.
