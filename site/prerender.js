// Пост-сборочный пререндер: вклеивает серверную разметку обеих локалей
// в собранные документы. Запускается из `npm run build` после клиентской
// и SSR-сборок; временная директория dist-ssr в конце удаляется.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { render } from './dist-ssr/entry-server.js';

const EMPTY_ROOT = '<div id="root"></div>';

for (const [lang, file] of [
  ['en', 'dist/index.html'],
  ['ru', 'dist/ru/index.html'],
]) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes(EMPTY_ROOT)) {
    throw new Error(`${file}: не найден пустой корневой div — пререндер не применён`);
  }
  const markup = render(lang);
  if (!markup) {
    throw new Error(`${file}: render("${lang}") вернул пустую строку`);
  }
  writeFileSync(file, html.replace(EMPTY_ROOT, '<div id="root">' + markup + '</div>'));
  console.log(`prerendered ${file} (${markup.length} chars of markup)`);
}

rmSync('dist-ssr', { recursive: true, force: true });
