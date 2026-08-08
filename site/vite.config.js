import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Продакшен требует явного флага: только DEPLOY_ENV=production убирает
// noindex и Disallow. Любая другая сборка (стейджинг, опечатка в CI,
// отсутствие переменной) закрыта от индексации — ошибка конфигурации
// прячет недоделанный сайт, а не сливает его в индекс.
const isProduction = process.env.DEPLOY_ENV === 'production';

// Продакшен без ключа Turnstile — мёртвая форма: воркер отвергнет каждую
// заявку как turnstile_failed, а сборка при этом «зелёная». Лучше упасть.
if (isProduction && !process.env.VITE_TURNSTILE_SITE_KEY) {
  throw new Error(
    'DEPLOY_ENV=production, но VITE_TURNSTILE_SITE_KEY пуст или не задан. ' +
    'Продакшен-сборка без ключа Turnstile не может принимать заявки — задайте переменную.'
  );
}

const robotsGuard = () => ({
  name: 'robots-guard',
  transformIndexHtml() {
    if (isProduction) return;
    return [
      { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' },
    ];
  },
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'robots.txt',
      source: isProduction ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n',
    });
  },
});

export default defineConfig(({ isSsrBuild }) => ({
  // Absolute base so hashed assets resolve from both / and /ru/
  base: '/',
  plugins: [react(), ...(isSsrBuild ? [] : [robotsGuard()])],
  server: {
    // Локально /api уходит в `wrangler dev` (worker/), форма работает без CORS
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: isSsrBuild
    ? // SSR-сборка для пререндера; prerender.js удаляет dist-ssr после вклейки
      { outDir: 'dist-ssr' }
    : {
        rollupOptions: {
          input: {
            en: resolve(import.meta.dirname, 'index.html'),
            ru: resolve(import.meta.dirname, 'ru/index.html'),
          },
        },
      },
}));
