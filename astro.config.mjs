import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// Vercel espone la variabile VERCEL durante la build: in quel caso usiamo
// l'adapter Vercel (serverless), altrimenti l'adapter Node standalone per
// l'auto-hosting locale (npm run start:prod).
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  output: 'server',
  adapter: isVercel ? vercel() : node({ mode: 'standalone' }),
  server: {
    host: true,
  },
  vite: {
    build: {
      chunkSizeWarningLimit: 1800,
    },
  },
});
