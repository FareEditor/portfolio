// Пост-сборочный пререндер: вклеивает серверную разметку обеих локалей
// в собранные документы. Запускается из `npm run build` после клиентской
// и SSR-сборок; временная директория dist-ssr в конце удаляется.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { render } from './dist-ssr/entry-server.js';

const EMPTY_ROOT = '<div id="root"></div>';

// Горячие секции (stats, work, testimonials) в HTML не попадают — только форма их
// skeleton: сколько категорий и с какой пропорцией превью, сколько работ в первой,
// есть ли отзывы. Ни текстов, ни чисел, ни адресов. Без формы секции прыгнули бы при
// загрузке данных, поэтому недоступный или битый API роняет сборку: сайт без работ
// не выкладывается. Адрес переопределяется HOT_DATA_URL (стейджинг, проверки).
const HOT_DATA_URL = process.env.HOT_DATA_URL || 'https://fareeditor.com/data/hot.json';
const ASPECTS = ['16:9', '9:12', '1:1', '4:5'];

async function hotShape() {
  const fail = (reason) => new Error(
    `prerender: форма горячих секций не получена — ${reason} (${HOT_DATA_URL}). ` +
    'Сборка остановлена: без формы skeleton сайт выкладывать нельзя. ' +
    'Проверьте Content Worker или задайте HOT_DATA_URL.'
  );
  let hot;
  try {
    const response = await fetch(HOT_DATA_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    hot = await response.json();
  } catch (error) {
    throw fail(error.message);
  }
  const categories = hot?.categories;
  if (!Array.isArray(hot?.stats?.items) || hot.stats.items.length !== 4) throw fail('stats.items — не 4 элемента');
  if (!Array.isArray(categories) || categories.length === 0) throw fail('нет ни одной категории с работами');
  if (!categories.every((c) => ASPECTS.includes(c.aspect) && Array.isArray(c.works) && c.works.length > 0)) {
    throw fail('категория без работ или с неизвестным aspect');
  }
  if (!Array.isArray(hot.testimonials)) throw fail('testimonials — не список');
  return {
    categories: categories.map((c) => c.aspect),
    works: categories[0].works.length,
    testimonials: hot.testimonials.length > 0,
  };
}

// dist-ssr убирается и при сбое: каталог не под .gitignore и иначе остался бы в рабочем дереве.
try {
  const shape = await hotShape();
  console.log(`hot shape: ${JSON.stringify(shape)}`);
  // Клиент читает ту же форму до гидрации: первый рендер обязан совпасть с пререндером.
  const shapeScript = `<script>window.__HOT_SHAPE__=${JSON.stringify(shape).replace(/</g, '\\u003c')}</script>`;

  for (const [lang, file] of [
    ['en', 'dist/index.html'],
    ['ru', 'dist/ru/index.html'],
  ]) {
    const html = readFileSync(file, 'utf8');
    if (!html.includes(EMPTY_ROOT)) {
      throw new Error(`${file}: не найден пустой корневой div — пререндер не применён`);
    }
    const markup = render(lang, shape);
    if (!markup) {
      throw new Error(`${file}: render("${lang}") вернул пустую строку`);
    }
    writeFileSync(file, html.replace(EMPTY_ROOT, shapeScript + '<div id="root">' + markup + '</div>'));
    console.log(`prerendered ${file} (${markup.length} chars of markup)`);
  }
} finally {
  rmSync('dist-ssr', { recursive: true, force: true });
}
