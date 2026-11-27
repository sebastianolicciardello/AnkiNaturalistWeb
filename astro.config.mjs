import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: true,
  },
  vite: {
    build: {
      // Il generatore di .apkg include sql.js + JSZip: un chunk separato
      // viene caricato solo quando l'utente avvia la generazione.
      chunkSizeWarningLimit: 1800,
    },
  },
});
