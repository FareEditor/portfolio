import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Интерфейс админки. Сборка кладётся в ../public — оттуда её раздаёт Worker (static assets).
// Каталог public в репозиторий не попадает: wrangler собирает его перед dev и deploy
// (build.command в wrangler.jsonc).
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [react()],
  build: { outDir: resolve(import.meta.dirname, '../public'), emptyOutDir: true },
  // Локальная разработка: API — у `wrangler dev` на 8798.
  server: { proxy: { '/api': 'http://127.0.0.1:8798' } },
});
