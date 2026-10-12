// Тестовые данные: собственный набор записей и файлов, не связанный с контентом сайта.
// Локальные тесты поднимают его в памяти; для прогона в Cloudflare —
//   node test/fixture.mjs > seed.sql   (после миграций content-worker/migrations/*.sql)
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { toSql } from '../../content-worker/scripts/import.mjs';
import { CONTENT_SHAPE } from '../../content-worker/src/schema.js';
import { FORM_OPTIONS } from '../../site/src/formOptions.js';
import { keyFor } from '../src/media-rules.js';

const MEDIA_BASE = 'https://media.fareeditor.com/';
const MB = 1024 * 1024;

// Файлы с настоящими сигнатурами; содержимое — заполнитель. Ролики по 18 МБ: на них
// проверяется потоковая загрузка большого тела.
function webp(label) {
  const b = Buffer.alloc(256);
  b.write('RIFF', 0); b.writeUInt32LE(248, 4); b.write('WEBPVP8 ', 8); b.write(label, 32);
  return b;
}
function mp4(label) {
  const b = Buffer.alloc(18 * MB);
  b.writeUInt32BE(24, 0); b.write('ftypisom', 4); b.write(label, 32);
  return b;
}
const FILES = {
  'before-after/before.mp4': () => mp4('fixture before'),
  'before-after/after.mp4': () => mp4('fixture after'),
  'works/fl-1.webp': () => webp('fixture fl-1'),
  'works/fl-2.webp': () => webp('fixture fl-2'),
  'works/mg-1.webp': () => webp('fixture mg-1'),
  'works/logo.webp': () => webp('fixture logo'),
};
const cache = new Map();
// Байты тестового файла по имени.
export const media = (name) => { if (!cache.has(name)) cache.set(name, FILES[name]()); return cache.get(name); };

const MEDIA = [
  ['before-after/before.mp4', 'before', 'video/mp4', 1280, 720, 48120],
  ['before-after/after.mp4', 'after', 'video/mp4', 1280, 720, 48120],
  ['works/fl-1.webp', 'work', 'image/webp', 1280, 720, null],
  ['works/fl-2.webp', 'work', 'image/webp', 1280, 720, null],
  ['works/mg-1.webp', 'work', 'image/webp', 1280, 720, null],
  ['works/logo.webp', 'client', 'image/webp', 800, 800, null],
];

const fill = (shape, path) => (shape === 's' ? `Текст ${path}`
  : Array.isArray(shape) ? Array.from({ length: shape[0] }, (_, i) => fill(shape[1], `${path}[${i}]`))
    : Object.fromEntries(Object.entries(shape).map(([key, child]) => [key, fill(child, path ? `${path}.${key}` : key)])));
function contentDoc(locale) {
  const doc = fill(CONTENT_SHAPE, '');
  doc.cta = `CTA ${locale}`;
  for (const [name, keys] of Object.entries(FORM_OPTIONS)) keys.forEach((value, i) => { doc.contact[name][i].value = value; });
  return doc;
}

const work = (slug, category, order, thumbnail, extra = {}) => ({
  slug, published: 1, category_slug: category, featured: 0, sort_order: order,
  client_ru: `Клиент ${slug}`, client_en: `Client ${slug}`, format_ru: 'Ролик', format_en: 'Video', duration_ru: '10 мин', duration_en: '10 min',
  title_ru: `Работа ${slug}`, title_en: `Work ${slug}`, body_ru: `Описание ${slug}`, body_en: `About ${slug}`,
  youtube_id: 'dQw4w9WgXcQ', thumbnail_media_id: thumbnail, ...extra,
});

// Таблицы в порядке, совместимом с внешними ключами.
export function tables() {
  const rows = MEDIA.map(([name, kind, type, width, height, duration], i) => {
    const bytes = media(name);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = keyFor(kind, name.split('/').pop(), sha256, type);
    return { id: i + 1, kind, r2_key: key, url: MEDIA_BASE + key, sha256, bytes: bytes.length, content_type: type, width, height, duration_ms: duration };
  });
  const types = ['views', 'retention', 'subscribers', 'ctr-rate'];
  return {
    media: rows,
    categories: [
      { slug: 'talking-head', published: 1, sort_order: 1, title_ru: 'Говорящая голова', title_en: 'Talking head', blurb_ru: 'Вводный текст', blurb_en: null, aspect: '16:9' },
      { slug: 'motion-graphics', published: 1, sort_order: 2, title_ru: 'Моушн', title_en: 'Motion', blurb_ru: null, blurb_en: null, aspect: '16:9' },
      { slug: 'hidden', published: 0, sort_order: 3, title_ru: 'Скрытая', title_en: 'Hidden', blurb_ru: null, blurb_en: null, aspect: '1:1' },
    ],
    metric_types: types.map((slug, i) => ({ slug, sort_order: i + 1, label_ru: `Метрика ${slug}`, label_en: `Metric ${slug}` })),
    works: [work('first', 'talking-head', 1, 3), work('second', 'talking-head', 2, 4, { featured: 1 }), work('third', 'motion-graphics', 1, 5)],
    testimonials: [{
      slug: 'client-one', published: 1, sort_order: 1, channel_name: 'Channel One', quote_ru: 'Цитата', quote_en: 'Quote',
      channel_topic_ru: 'Тема', channel_topic_en: 'Topic', logo_media_id: 6, top_metric_value: '+120%', top_metric_label_ru: 'рост', top_metric_label_en: 'growth',
    }],
    testimonial_metrics: [1, 2, 3].map((position) => ({ testimonial_slug: 'client-one', position, metric_type_slug: types[position - 1], value_ru: `${position}0%`, value_en: `${position}0%` })),
    stats: [1, 2, 3, 4].map((position) => ({ position, value_ru: `${position}00`, value_en: `${position}00`, label_ru: `Показатель ${position}`, label_en: `Stat ${position}` })),
    contacts: ['email', 'telegram', 'twitter', 'location'].map((kind, i) => ({
      position: i + 1, kind, label_ru: `Подпись ${kind}`, label_en: `Label ${kind}`, value_ru: `значение ${kind}`, value_en: `value ${kind}`,
      subject_ru: kind === 'email' ? 'Тема письма' : null, subject_en: kind === 'email' ? 'Subject' : null,
    })),
    settings: [{
      id: 1, status_ru: 'Открыт для проектов', status_en: 'Available', showreel_enabled: 0, showreel_id: 'dQw4w9WgXcQ',
      contact_url_ru: 'https://t.me/example', contact_url_en: 'https://x.com/example', before_after_enabled: 1, before_media_id: 1, after_media_id: 2,
    }],
    content: ['ru', 'en'].map((locale) => ({ locale, doc: JSON.stringify(contentDoc(locale)) })),
  };
}

export const seedSql = () => toSql(tables());

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.stdout.write(seedSql());
