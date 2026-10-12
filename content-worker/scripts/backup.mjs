// Чтение бэкапа D1 (файл `wrangler d1 export`): SQL поднимается в SQLite в памяти.
// Общий модуль для verify.mjs и check-api.mjs. Нужен Node.js с node:sqlite (22.5+).
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Таблица → сортировка для детерминированного чтения.
export const TABLES = {
  media: 'id',
  categories: 'slug',
  metric_types: 'slug',
  works: 'slug',
  testimonials: 'slug',
  testimonial_metrics: 'testimonial_slug, position',
  stats: 'position',
  contacts: 'position',
  settings: 'id',
  content: 'locale',
  revisions: 'id',
  publishes: 'id',
};

export const selectAll = () => Object.keys(TABLES).map((t) => `SELECT * FROM ${t} ORDER BY ${TABLES[t]}`);

// { таблица: [строки] } — в том же виде, в каком строки отдаёт D1.
export function loadBackup(path) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path, 'utf8'));
  return Object.fromEntries(Object.keys(TABLES).map((t, i) => [t, db.prepare(selectAll()[i]).all().map((row) => ({ ...row }))]));
}
