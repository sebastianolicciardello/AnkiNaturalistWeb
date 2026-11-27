import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Vite usa la condizione "browser" di sql.js, che carica
// sql-wasm-browser.js e si aspetta il relativo sql-wasm-browser.wasm.
// Il file incluso in anki-apkg-export non è compatibile con quel runtime.
const candidates = [
  resolve(root, 'node_modules/sql.js/dist/sql-wasm-browser.wasm'),
  resolve(root, 'node_modules/anki-apkg-export/dist/sql-wasm.wasm'),
];

const source = candidates.find((candidate) => existsSync(candidate));
if (!source) {
  console.error(
    `[copy-wasm] Nessun file WASM trovato. Cercato in:\n${candidates
      .map((candidate) => `  - ${candidate}`)
      .join('\n')}\n` + 'Installa le dipendenze con `npm install` prima di avviare il progetto.'
  );
  process.exit(1);
}

const destination = resolve(root, 'public/sql-wasm.wasm');
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`[copy-wasm] Copiato ${source} in ${destination}`);
