# ATA Coach — guida all'installazione

Tempo: circa 45 minuti, una volta sola. Si segue dall'alto in basso.
Alla fine Giorgia avrà l'app sul telefono e sul computer, con gli stessi progressi sincronizzati da soli.

## Prima di iniziare

Ti servono:
- un computer con Chrome o Edge;
- il telefono di Giorgia;
- un indirizzo email per creare l'account GitHub (può essere il tuo);
- lo zip `ata-coach.zip` scaricato ed **estratto** sul computer (tasto destro → «Estrai tutto» su Windows, doppio clic su Mac).

Durante la guida useremo due nomi. Sostituisci `TUONOME` con il nome utente che sceglierai su GitHub.
- Sito dell'app: `https://TUONOME.github.io/ata-coach/`
- Spazio privato dei progressi: `TUONOME/ata-coach-dati`

---

## Parte 1 — Pubblicare l'app (20 minuti)

### 1. Crea l'account GitHub
1. Vai su **github.com** → **Sign up**.
2. Scegli un nome utente semplice, senza spazi (è il `TUONOME` della guida). Conferma l'email.

### 2. Crea il repository dell'app
1. In alto a destra: **+** → **New repository**.
2. *Repository name*: `ata-coach`
3. Scegli **Public**. (Con l'account gratuito il sito funziona solo così. È pubblico il codice, non i dati di Giorgia.)
4. Premi **Create repository**.

### 3. Carica i file
1. Nella pagina che si apre, clicca il link **uploading an existing file**.
2. Apri la cartella `ata-coach` estratta dallo zip, seleziona **tutto il suo contenuto** e trascinalo nella pagina.
   - Su **Mac** la cartella `.github` è nascosta: nel Finder premi **Cmd + Maiusc + .** (punto) per vederla, poi seleziona tutto.
3. Aspetta che finisca il caricamento e premi **Commit changes**.
4. **Controllo:** nell'elenco dei file del repository devono comparire le cartelle `.github`, `src`, `monitor`. Se `.github` manca, vedi «Se qualcosa va storto», punto A.

### 4. Attiva il sito
1. Nel repository apri **Settings** (in alto, icona ingranaggio).
2. Menu a sinistra → **Pages** → alla voce *Source* scegli **GitHub Actions**.
3. Menu a sinistra → **Actions** → **General** → scorri in fondo fino a *Workflow permissions* → scegli **Read and write permissions** → **Save**.

### 5. Pubblica
1. Apri la scheda **Actions** (in alto). Se compare un pulsante verde per abilitare i workflow, premilo.
2. A sinistra clicca **Pubblica l'app** → a destra **Run workflow** → di nuovo **Run workflow**.
3. Aspetta 2–3 minuti finché compare la spunta verde ✅.
4. Apri `https://TUONOME.github.io/ata-coach/` nel browser: deve comparire ATA Coach. **Non creare ancora il profilo**: prima prepariamo la sincronizzazione.

---

## Parte 2 — Lo spazio privato per i progressi (10 minuti)

### 6. Crea il repository privato
1. **+** → **New repository**.
2. *Repository name*: `ata-coach-dati`
3. Scegli **Private**.
4. Spunta **Add a README file**.
5. **Create repository**.

### 7. Crea la chiave di sincronizzazione
1. Clicca la tua foto in alto a destra → **Settings**.
2. Menu a sinistra, in fondo → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Compila così:
   - *Token name*: `ATA Coach sincronizzazione`
   - *Expiration*: scegli **No expiration** se c'è; altrimenti la durata più lunga disponibile, e segnati in calendario la data di scadenza.
   - *Repository access*: **Only select repositories** → scegli **ata-coach-dati** (solo quello).
   - *Permissions* → *Repository permissions* → **Contents** → **Read and write**. Non toccare altro.
5. **Generate token** e conferma.
6. Compare una chiave che inizia con `github_pat_`. **Copiala subito** (GitHub la mostra una volta sola) e tienila a portata di mano per il passo 9. Non mandarla a nessuno.

La chiave può solo leggere e scrivere i file di `ata-coach-dati`: non può toccare nient'altro dell'account.

---

## Parte 3 — Il computer (10 minuti)

### 8. Installa l'app sul computer
1. Apri `https://TUONOME.github.io/ata-coach/` con Chrome o Edge.
2. Nella barra dell'indirizzo, a destra, clicca l'icona **Installa** (un monitor con una freccia) → **Installa**. Da ora l'app si apre come un programma.
3. Crea il profilo di Giorgia: nome, obiettivo, CIAD, tempo disponibile. Il test iniziale può farlo Giorgia stessa (circa 7 minuti) oppure si può interrompere con «Esci» e riprendere dopo.

### 9. Collega la sincronizzazione
1. Nell'app: **⚙︎ Impostazioni** → sezione **Sincronizzazione tra dispositivi**.
2. *Repository*: `TUONOME/ata-coach-dati`
3. *Chiave di GitHub*: incolla la chiave del passo 7.
4. **Collega e sincronizza**. Deve comparire «Collegato: primo salvataggio fatto».

---

## Parte 4 — Il telefono (5 minuti)

### 10. Installa l'app sul telefono
Sul telefono di Giorgia apri `https://TUONOME.github.io/ata-coach/`:
- **Android (Chrome):** menu ⋮ → **Installa app** (o «Aggiungi a schermata Home»).
- **iPhone (Safari):** pulsante Condividi (quadrato con freccia) → **Aggiungi alla schermata Home**.

Poi **chiudi il browser e apri l'app dall'icona** sulla schermata Home.

### 11. Collega il telefono ai progressi
1. **Sul computer**, nell'app: Impostazioni → Sincronizzazione → **Collega un altro dispositivo** → **Copia il codice**.
2. Manda il codice a te stessa (per esempio un'email al tuo indirizzo) e aprilo sul telefono. Copialo.
3. **Sul telefono**, nella prima schermata dell'app: tocca **Usi già ATA Coach su un altro dispositivo?** → incolla il codice → **Collega e scarica i progressi**.
4. Deve comparire **«Ciao Giorgia.»** con i progressi del computer.
5. Cancella il messaggio con il codice: contiene la chiave.

### ✅ Controllo finale
- [ ] L'app si apre dall'icona sul telefono e sul computer.
- [ ] In fondo alla schermata principale c'è scritto «Sincronizzato oggi alle …».
- [ ] Fai 5 domande sul telefono («Non ho voglia: solo 5 minuti»), poi apri l'app sul computer: in «Come sono messa?» la sessione compare.

Fatto. Da qui Giorgia deve solo aprire l'app e premere **Fai tu**.

---

## Parte 5 — Facoltativa (anche un altro giorno)

### 12. Intelligenza artificiale
1. Su **aistudio.google.com**, con un account Google → **Get API key** → **Create API key** → copia.
2. Nell'app: Impostazioni → *Intelligenza artificiale* → spunta «Usa l'AI quando serve» → incolla la chiave → **Prova la connessione**.
3. Ripeti sull'altro dispositivo: la chiave AI resta sul singolo dispositivo e non viene sincronizzata.

Con il piano gratuito Google può usare i testi inviati per migliorare i suoi servizi. L'app manda solo testi di studio e bandi, mai i progressi.

### 13. Notifiche (promemoria giornaliero e novità dai siti ufficiali)
1. **Sul telefono**, nell'app installata: Impostazioni → **Configura le notifiche push** → consenti. Compaiono tre valori.
2. Su GitHub, nel repository **ata-coach**: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crea tre secret con questi nomi, copiando i valori dal telefono:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `PUSH_SUBSCRIPTION`
3. Prova: scheda **Actions** → **Promemoria di studio** → **Run workflow**. Entro un minuto arriva la notifica.

Per riceverle **anche sul computer**: tutti i dispositivi devono usare le stesse due chiavi `VAPID`.
1. Sul computer, nell'app: Impostazioni → *Notifiche push* → apri **Le notifiche sono già attive su un altro dispositivo** → incolla `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (gli stessi valori che hai salvato su GitHub al punto 2) → **Configura le notifiche push**.
2. Copia il nuovo `PUSH_SUBSCRIPTION` del computer.
3. Su GitHub modifica il secret `PUSH_SUBSCRIPTION` (Update) scrivendo i due codici tra parentesi quadre, separati da una virgola: `[codice-del-telefono,codice-del-computer]`. Il codice del telefono è quello già salvato: se non l'hai più, rifai il punto 1 sul telefono incollando le stesse chiavi.

Orario del promemoria: nel repository apri `.github/workflows/reminder.yml` → matita ✏️ → cambia `'0 16 * * *'`. È in orario UTC: 16 = 18:00 con l'ora legale, 17:00 con l'ora solare.

### 14. Pagina del proprio Ufficio scolastico
Il controllo dei siti ufficiali parte da solo tre volte al giorno. Per aggiungere la pagina dell'Ufficio scolastico regionale o provinciale: nel repository **ata-coach** apri `monitor/sources.json` → matita ✏️ → aggiungi una riga come le altre → **Commit changes**.

---

## Se qualcosa va storto

**A. Nel repository manca la cartella `.github`.** Creala a mano, un file alla volta: **Add file** → **Create new file** → come nome scrivi `.github/workflows/deploy.yml` → incolla il contenuto del file con lo stesso nome che trovi nello zip → **Commit changes**. Ripeti per `monitor.yml` e `reminder.yml`.

**B. Il sito dà «404».** Aspetta 5 minuti dopo il primo «Pubblica l'app». Controlla il passo 4.2 (*Source* = GitHub Actions) e che in **Actions** ci sia la spunta verde.

**C. «Pubblica l'app» ha la croce rossa.** Clicca sull'esecuzione per vedere il passo fallito. Se è «Test», i file non sono stati caricati tutti: ricaricali (passo 3).

**D. Collegamento: «Repository non trovato».** Il nome va scritto `TUONOME/ata-coach-dati`, esattamente. Controlla che al passo 7 la chiave abbia accesso proprio a quel repository.

**E. Collegamento: «La chiave non ha il permesso di scrivere».** Rifai il passo 7 con **Contents: Read and write**.

**F. «La chiave non è valida o è scaduta».** Crea una nuova chiave (passo 7) e incollala sul computer (passo 9). Poi, sul telefono: Impostazioni → Sincronizzazione → «Scollega questo dispositivo» e ricollegalo con un nuovo codice (passo 11). I progressi non si perdono.

**G. Su iPhone il collegamento non resta.** Su iPhone l'app installata e Safari hanno memorie separate: il codice va incollato **dentro l'app aperta dall'icona**, non in Safari.

**H. Le notifiche non arrivano su iPhone.** Servono iOS 16.4 o successivo e l'app aperta dall'icona sulla schermata Home.

## Da sapere

- **Senza internet** l'app funziona lo stesso; sincronizza appena torna la connessione.
- **Backup in più:** Impostazioni → «Scarica il backup». L'app fa anche una copia automatica al giorno su ogni dispositivo.
- **Aggiornare l'app** con una versione nuova: ricarica i file nel repository `ata-coach` (passo 3). I progressi restano.
- **Contenuti:** ogni domanda ha una fonte; in Impostazioni → «Verifica delle fonti» si possono controllare e segnare come verificate. Giorgia può segnalare una domanda sbagliata dal pulsante «Segnala un errore».
