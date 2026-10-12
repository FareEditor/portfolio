import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { SNAPSHOT_FILE, fetchSnapshot } from './scripts/static-snapshot.mjs';

// Продакшен требует явного флага: только DEPLOY_ENV=production убирает
// noindex и Disallow. Любая другая сборка (стейджинг, опечатка в CI,
// отсутствие переменной) закрыта от индексации — ошибка конфигурации
// прячет недоделанный сайт, а не сливает его в индекс.
const isProduction = process.env.DEPLOY_ENV === 'production';

// Горячие данные отдаёт Content Worker на проде; локально /data проксируется туда.
// Только dev и preview — в production-сборку прокси не попадает.
const HOT_PROXY = { target: 'https://fareeditor.com', changeOrigin: true };

// Статичный контент приходит модулями virtual:static/ru и virtual:static/en: документ
// content своей локали плюс общие settings и contacts. Каждый entry импортирует только
// свой модуль, поэтому тексты чужой локали в его чанк не попадают. На сборке читается
// файл снимка, который только что положил scripts/static-snapshot.mjs; в dev файла нет —
// снимок берётся из API при первом обращении.
const staticData = (command) => {
  let snapshot;
  return {
    name: 'static-data',
    resolveId(id) {
      if (/^virtual:static\/(ru|en)$/.test(id)) return '\0' + id;
    },
    async load(id) {
      const match = /^\0virtual:static\/(ru|en)$/.exec(id);
      if (!match) return;
      snapshot ??= command === 'build' ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) : await fetchSnapshot();
      const { content, settings, contacts } = snapshot;
      return `export default ${JSON.stringify({ content: content[match[1]], settings, contacts })};`;
    },
  };
};

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

export default defineConfig(({ command, isSsrBuild, mode }) => {
  // Продакшен без ключа Turnstile — мёртвая форма: воркер отвергнет каждую
  // заявку как turnstile_failed, а сборка при этом «зелёная». Лучше упасть.
  //
  // Проверяем ровно тот источник, из которого значение получает Contact.jsx:
  // loadEnv читает .env-файлы и перекрывает их переменными процесса — то же,
  // что Vite подставляет в import.meta.env. Голый process.env здесь не годится:
  // в него VITE_*-переменные из .env.local не попадают, и guard падал при
  // работающем ключе.
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  if (isProduction && !env.VITE_TURNSTILE_SITE_KEY) {
    throw new Error(
      'DEPLOY_ENV=production, но VITE_TURNSTILE_SITE_KEY пуст или не задан. ' +
      'Продакшен-сборка без ключа Turnstile не может принимать заявки — задайте переменную.'
    );
  }

  return {
    // Absolute base so hashed assets resolve from both / and /ru/
    base: '/',
    plugins: [react(), staticData(command), ...(isSsrBuild ? [] : [robotsGuard()])],
    server: {
      // Локально /api уходит в `wrangler dev` (worker/), форма работает без CORS
      proxy: { '/api': 'http://localhost:8787', '/data': HOT_PROXY },
    },
    // vite preview отдаёт dist без воркера: /data берётся с прода так же, как в dev
    preview: { proxy: { '/data': HOT_PROXY } },
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
  };
});
