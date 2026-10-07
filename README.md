# ATA Coach

Assistente di studio autonomo per le procedure ATA, profilo **Assistente Amministrativo**.
Principio: *Giorgia non organizza la preparazione, lo fa il software.*

- Funziona **senza AI** e **offline**. L'AI (Google Gemini) è opzionale.
- Dati salvati sul dispositivo (IndexedDB), con copia automatica giornaliera ed export.
- **Sincronizzazione automatica** tra telefono e computer tramite un repository GitHub privato: i dati dei dispositivi vengono uniti (nessuna risposta persa) e i progressi ricalcolati.
- Nessuna dipendenza npm.

**Per installarla senza competenze tecniche: [`GUIDA.md`](GUIDA.md).**
Il documento di analisi e progetto è in [`docs/PROGETTO.md`](docs/PROGETTO.md).

## Avvio rapido

**Senza installare niente:** apri `dist/ata-coach.html` con un browser (Chrome, Edge, Safari, Firefox). È un file unico che contiene tutta l'app.

**Come app installabile (PWA, consigliato):**

```bash
node serve.mjs          # richiede Node 18+
# apri http://localhost:5173 → menu del browser → "Installa app"
```

Per usarla dal telefono, pubblica la cartella `src/` su un hosting statico con HTTPS (GitHub Pages, Netlify, Cloudflare Pages: tutti gratuiti), apri l'indirizzo dal telefono e scegli "Aggiungi a schermata Home". Dopo la prima apertura funziona anche offline.

## Comandi

```bash
npm test        # 38 test automatici (node:test)
npm run build   # rigenera dist/ata-coach.html da src/
npm start       # build + server locale
```

## Attivare l'AI (facoltativo)

1. Crea una chiave gratuita su Google AI Studio (aistudio.google.com).
2. In ATA Coach: Impostazioni → Intelligenza artificiale → spunta "Usa l'AI quando serve" e incolla la chiave.
3. Imposta un limite di token al giorno (default 20.000).

Il modello predefinito è l'alias `gemini-flash-latest`, che Google aggiorna da solo. Se un modello viene dismesso (risposta 404), l'app interroga l'elenco dei modelli e ne sceglie uno Flash funzionante. La chiave resta solo sul dispositivo e non finisce nei backup.

## Struttura

```
src/core        utilità, database locale (adapter, migrazioni, backup), sincronizzazione
src/content     content pack: materie, lezioni, domande, fonti, template bandi
src/engine      motore didattico, spaced repetition, quiz, pianificazione, report, analisi bandi
src/ai          livello AI astratto (Gemini + offline), cache, budget
src/ui          interfaccia
src/sw.js       service worker: offline e notifiche push
src/feed.json   novità dalle fonti ufficiali (scritto dal monitor)
monitor/        controllo delle fonti e invio notifiche (gira su GitHub Actions)
.github/        pubblicazione del sito, controllo fonti 3 volte al giorno, promemoria giornaliero
tests/          test automatici
dist/           build a file unico
```

## Aggiungere contenuti

Senza toccare il codice: dall'app, **Impostazioni → Aggiungi domande** (creazione con AI da un testo ufficiale, con citazione verificata, oppure import di un pacchetto `.json`).

Nel codice: le domande stanno in `src/content/seed.js`. Ogni domanda deve avere argomento, livello (`riconoscimento` o `applicazione`), difficoltà 1–3, spiegazione e, se normativa, una fonte presente in `SOURCES`. I contenuti che possono cambiare nel tempo vanno marcati `status: 'da_verificare'`. I test controllano automaticamente la coerenza del content pack.

## Avvertenze

- I contenuti normativi sono stati redatti il 6–7 ottobre 2026. L'app include una procedura di verifica fonte per fonte (Impostazioni → Verifica delle fonti) e la segnalazione degli errori: usatela prima di affidarvi a un dato.
- Date e requisiti del bando di terza fascia 2027 **non sono ufficiali**: l'app li mostra come DA VERIFICARE.
- Notifiche ad app chiusa e controllo delle fonti richiedono la pubblicazione su GitHub (gratuita, vedi GUIDA.md). Con il solo file HTML restano disponibili i promemoria nel calendario (.ics).
