# AnkiNaturalist Web

Crea un mazzo **AnkiDroid** (`.apkg`) a partire dalle osservazioni pubbliche di
un utente **iNaturalist**, direttamente dal browser. Niente account, niente
sincronizzazioni Anki: il file viene generato sul dispositivo e scaricato.

Il progetto riprende il modello di note e l'idea dell'app Android
[AnkiNaturalist](../AnkiNaturalist), aggiungendo attribuzione delle foto e
classe di qualità alle carte.

## Cosa genera

- Un mazzo con note del tipo **AnkiNaturalist Observation** e 18 campi:
  `ObservationID`, `ScientificName`, `CommonName`, `Taxonomy`, `Photo`,
  `ObservationDate`, `Location`, `Description`, `CommunityTaxon`,
  `IdentificationStatus`, `QualityGrade`, `Identifications`, `Agreements`,
  `Disagreements`, `ObservationURL`, `PersonalNotes`, `PhotoCredit`,
  `QualityClass`.
- Una sola carta per osservazione, con fronte fotografico e retro con nome
  scientifico, nome comune, tassonomia, stato della community, descrizione e
  identificazioni.
- Foto incorporate nel pacchetto, ridimensionate da iNaturalist (`small`,
  `medium` o `large`).
- Attribuzione e licenza della foto su ogni carta.
- Tag `ankinaturalist`, `inat`, `inat::<qualità>` e
  `inat::user::<nickname>`.
- ID nota deterministici basati sull'ID dell'osservazione: reimportando lo
  stesso mazzo, Anki aggiorna le note esistenti invece di duplicarle.

## Avvio

Requisiti: **Node.js >= 22.12**.

```bash
npm install
npm run dev
```

Apri <http://localhost:4321>. Il comando `postinstall` copia il WASM
`sql-wasm-browser.wasm` di `sql.js` in `public/sql-wasm.wasm`, perché il
generatore SQLite/JSZip viene caricato nel browser solo al momento della
creazione. Il file deve corrispondere al build `sql-wasm-browser.js` scelto da
Vite (condizione `browser` di `sql.js`), non a quello incluso in
`anki-apkg-export`.

### Produzione

```bash
npm run build
npm run start:prod
```

Il server Node ascolta per default sulla porta `4321`; puoi configurare
`HOST` e `PORT` tramite variabili d'ambiente.

> È necessario un runtime Node: la generazione dell'APKG avviene nel browser,
> ma il proxy delle foto richiede un endpoint server. L'app **non** può essere
> esportata come sito statico.

## Come funziona

1. Il browser interroga l'API pubblica `https://api.inaturalist.org/v1` per
   profilo, anteprima, osservazioni e tassonomia. Le richieste sono
   serializzate con almeno 1,1 secondi tra una e l'altra, nel rispetto delle
   linee guida iNaturalist.
2. Le immagini vengono richieste al proxy same-origin `/api/photo`, che
   accetta soltanto URL HTTPS dei CDN fotografici iNaturalist e percorsi
   `/photos/<id>/<dimensione>.<estensione>`.
3. `anki-apkg-export` (sql.js + JSZip) costruisce nel browser il database
   SQLite `collection.anki2` e l'archivio `.apkg` con foto e metadati.
4. Il file viene scaricato tramite un blob locale; nessun mazzo viene inviato
   a un server.

### Proxy foto

`src/pages/api/photo.ts` è limitato a:

- host `inaturalist-open-data.s3.amazonaws.com`,
  `inaturalist-open-data.s3.us-east-1.amazonaws.com`, `static.inaturalist.org`;
- protocollo HTTPS, senza credenziali né porte alternative;
- path delle foto iNaturalist nelle varianti `square`, `small`, `medium`,
  `large`.

Le risposte sono memorizzabili in cache e vengono restituite in streaming.
Il proxy serve solo a superare l'assenza di header CORS su
`static.inaturalist.org`; le richieste all'API iNaturalist partono
direttamente dal browser.

## Struttura

```text
src/
  layouts/Layout.astro       layout e metadati
  pages/index.astro          interfaccia e sezioni dell'app
  pages/api/photo.ts         proxy immagini con allowlist
  scripts/app.ts             stato UI, ricerca, anteprima, download
  lib/types.ts               tipi condivisi, campi, opzioni
  lib/inat.ts                client API iNaturalist e rate limit
  lib/format.ts              formattazione, tassonomia, licenze
  lib/cards.ts               modello Anki, template e CSS delle carte
  lib/generate.ts            download foto e generazione APKG
  styles/global.css          design system dell'interfaccia
public/
  sql-wasm.wasm              copiato da sql.js (build browser)
  favicon.svg
scripts/copy-wasm.mjs        copia automatica del WASM
```

## Privacy e licenze

- Non ci sono login, cookie, analytics o database applicativo.
- Il server vede soltanto le richieste al proxy fotografico (URL dell'immagine
  e normale traffico HTTP); non conserva nickname, osservazioni o mazzi.
- Le osservazioni e le foto restano dei rispettivi autori iNaturalist. Ogni
  carta riporta l'attribuzione e la licenza fornite dall'API. Verifica la
  licenza prima di ridistribuire foto o mazzi.
- Progetto non affiliato a iNaturalist, Anki o AnkiDroid.

## Note e limiti

- Massimo 2.000 osservazioni per mazzo; il valore predefinito è 300.
- Le osservazioni senza foto vengono saltate, a meno che non si attivi
  l'opzione dedicata (in tal caso usano un'immagine segnaposto).
- Un mazzo molto grande può richiedere tempo e memoria: la generazione avviene
  interamente nel browser.
- L'API iNaturalist può rallentare o rispondere `429`; l'app mostra un messaggio
  e permette di riprovare.
- Le immagini vengono richieste nella dimensione scelta, con ripiego sulle
  varianti più piccole se una non è disponibile.

## Comandi

| Comando             | Descrizione                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | server di sviluppo Astro                         |
| `npm run build`     | build di produzione                              |
| `npm run start:prod`| avvio del server Node compilato                  |
| `npm run check`     | controllo TypeScript e template Astro            |
| `npm run copy:wasm` | ricopia manualmente `sql-wasm.wasm` in `public/` |
