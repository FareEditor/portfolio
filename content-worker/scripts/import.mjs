#!/usr/bin/env node
// Генерирует SQL полной замены контента в D1 из site/src/data/** и манифеста R2.
// Сам в базу не ходит: печатает файл, применяется он через `wrangler d1 execute --file`.
//
//   node scripts/import.mjs --manifest <r2-manifest.json> --out <import.sql> [--data <site/src/data>]
//
// Любое поле JSON либо описано ниже, либо перечислено в DROPPED. Неизвестное поле — ошибка.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { COLLECTIONS, CONTENT_SHAPE, checkShape } from '../src/schema.js';

export const DEFAULT_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../site/src/data');

// Отброшенные поля документа content (путь через точку).
export const DROPPED = ['work.motionTitle'];

const MANIFEST_KEYS = ['source', 'key', 'url', 'sha256', 'bytes', 'content_type', 'width', 'height', 'duration'];

const TOP_LEVEL = ['categories', 'works', 'metric-types', 'testimonials', 'content',
  'stats.json', 'contacts.json', 'settings.json', 'works.js', '.DS_Store'];

// SQL-литерал. Строки — в одинарных кавычках с удвоением; NUL в SQLite-литерале невыразим.
export function lit(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`не целое число: ${value}`);
    return String(value);
  }
  if (typeof value !== 'string') throw new Error(`неподдерживаемый тип: ${typeof value}`);
  if (value.includes('\0')) throw new Error('строка содержит NUL');
  return `'${value.replaceAll("'", "''")}'`;
}

export const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(lit).join(', ')});`;

export function mediaKind(key) {
  if (key.startsWith('works/')) return 'work';
  if (key.startsWith('clients/')) return 'client';
  if (key.startsWith('before-after/before.')) return 'before';
  if (key.startsWith('before-after/after.')) return 'after';
  throw new Error(`media: неизвестный префикс ключа ${key}`);
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const readFolder = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => [f, readJson(join(dir, f))]);

// Строгое сравнение: типы, порядок в списках; порядок ключей объекта не значим.
export function diff(actual, expected, path = '') {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [`${path}: список против не-списка`];
    if (actual.length !== expected.length) return [`${path}: длина ${actual.length} ≠ ${expected.length}`];
    return expected.flatMap((item, i) => diff(actual[i], item, `${path}[${i}]`));
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap((key) =>
      key in expected && key in actual
        ? diff(actual[key], expected[key], `${path}.${key}`)
        : [`${path}.${key}: есть только в ${key in expected ? 'JSON' : 'D1'}`]);
  }
  return Object.is(actual, expected) ? [] : [`${path}: D1 ${JSON.stringify(actual)} (${typeof actual}) ≠ JSON ${JSON.stringify(expected)} (${typeof expected})`];
}

export function dropPaths(doc, paths = DROPPED) {
  const copy = structuredClone(doc);
  for (const path of paths) {
    const keys = path.split('.');
    const parent = keys.slice(0, -1).reduce((node, key) => node?.[key], copy);
    if (parent) delete parent[keys.at(-1)];
  }
  return copy;
}

export function build(dataDir, manifestPath) {
  for (const name of readdirSync(dataDir)) {
    if (!TOP_LEVEL.includes(name)) throw new Error(`${dataDir}/${name}: неизвестный источник данных`);
  }

  const manifest = readJson(manifestPath);
  const mediaBySource = new Map();
  const media = manifest.map((entry, i) => {
    for (const key of Object.keys(entry)) if (!MANIFEST_KEYS.includes(key)) throw new Error(`manifest[${i}].${key}: неизвестное поле`);
    for (const key of MANIFEST_KEYS) if (!(key in entry)) throw new Error(`manifest[${i}].${key}: поле отсутствует`);
    const row = {
      id: i + 1,
      kind: mediaKind(entry.key),
      r2_key: entry.key,
      url: entry.url,
      sha256: entry.sha256,
      bytes: entry.bytes,
      content_type: entry.content_type,
      width: entry.width,
      height: entry.height,
      duration_ms: entry.duration === null ? null : Math.round(entry.duration * 1000),
    };
    mediaBySource.set(entry.source, row.id);
    return row;
  });

  // JSON-запись → строка таблицы. extra — ключи, которые разбирает вызывающий код.
  function toRow(table, record, where, extra = []) {
    const spec = COLLECTIONS[table];
    for (const key of Object.keys(record)) {
      if (!(key in spec) && !extra.includes(key)) throw new Error(`${where}.${key}: неизвестное поле`);
    }
    const row = {};
    for (const [key, [column, type]] of Object.entries(spec)) {
      const value = record[key];
      const optional = type.endsWith('?');
      if (optional && (value === undefined || value === '')) {
        row[column] = null;
        continue;
      }
      if (value === undefined) throw new Error(`${where}.${key}: поле отсутствует`);
      const base = optional ? type.slice(0, -1) : type;
      if (base === 'text') {
        if (typeof value !== 'string') throw new Error(`${where}.${key}: ожидалась строка`);
        row[column] = value;
      } else if (base === 'int') {
        if (!Number.isInteger(value)) throw new Error(`${where}.${key}: ожидалось целое`);
        row[column] = value;
      } else if (base === 'bool') {
        if (typeof value !== 'boolean') throw new Error(`${where}.${key}: ожидался boolean`);
        row[column] = value ? 1 : 0;
      } else {
        // Сопоставление по исходному пути, а не по ключу: логотип в R2 лежит под clients/.
        const id = mediaBySource.get(`site/public${value}`);
        if (id === undefined) throw new Error(`${where}.${key}: ${value} нет в манифесте`);
        row[column] = id;
      }
    }
    return row;
  }

  const folder = (table, dir = table) =>
    readFolder(join(dataDir, dir)).map(([file, record]) => toRow(table, record, `${dir}/${file}`));

  const list = (table, file) => {
    const doc = readJson(join(dataDir, file));
    if (Object.keys(doc).join() !== 'items' || !Array.isArray(doc.items)) throw new Error(`${file}: ожидался объект { items: [] }`);
    return doc.items.map((item, i) => ({ position: i + 1, ...toRow(table, item, `${file}.items[${i}]`) }));
  };

  const testimonials = [];
  const testimonialMetrics = [];
  for (const [file, record] of readFolder(join(dataDir, 'testimonials'))) {
    const where = `testimonials/${file}`;
    const metricKeys = [1, 2, 3].flatMap((n) => [`metric_${n}_type`, `metric_${n}_value_ru`, `metric_${n}_value_en`]);
    const row = toRow('testimonials', record, where, metricKeys);
    testimonials.push(row);
    for (const n of [1, 2, 3]) {
      const metric = { type: record[`metric_${n}_type`], value_ru: record[`metric_${n}_value_ru`], value_en: record[`metric_${n}_value_en`] };
      testimonialMetrics.push({ testimonial_slug: row.slug, position: n, ...toRow('testimonial_metrics', metric, `${where}.metric_${n}`) });
    }
  }

  // Пара before/after включена, когда в манифесте есть оба файла.
  const before = media.find((m) => m.kind === 'before');
  const after = media.find((m) => m.kind === 'after');
  const settings = {
    id: 1,
    ...toRow('settings', readJson(join(dataDir, 'settings.json')), 'settings.json'),
    before_after_enabled: before && after ? 1 : 0,
    before_media_id: before && after ? before.id : null,
    after_media_id: before && after ? after.id : null,
  };

  const content = ['ru', 'en'].map((locale) => {
    const doc = dropPaths(readJson(join(dataDir, 'content', `${locale}.json`)));
    checkShape(doc, CONTENT_SHAPE, `content/${locale}.json`);
    return { locale, doc: JSON.stringify(doc) };
  });
  const contentFiles = readdirSync(join(dataDir, 'content')).filter((f) => f.endsWith('.json')).sort().join();
  if (contentFiles !== 'en.json,ru.json') throw new Error(`content/: ожидались en.json и ru.json, найдено ${contentFiles}`);

  // Порядок вставки совместим с FK; удаление — в обратном.
  return {
    media,
    categories: folder('categories'),
    metric_types: folder('metric_types', 'metric-types'),
    works: folder('works'),
    testimonials,
    testimonial_metrics: testimonialMetrics,
    stats: list('stats', 'stats.json'),
    contacts: list('contacts', 'contacts.json'),
    settings: [settings],
    content,
  };
}

export function toSql(tables) {
  const names = Object.keys(tables);
  return [
    '-- Сгенерировано scripts/import.mjs. Полная замена контента; revisions не затрагивается.',
    ...names.toReversed().map((table) => `DELETE FROM ${table};`),
    ...names.flatMap((table) => tables[table].map((row) => insert(table, row))),
    '',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: args } = parseArgs({
    options: { data: { type: 'string', default: DEFAULT_DATA_DIR }, manifest: { type: 'string' }, out: { type: 'string' } },
  });
  if (!args.manifest || !args.out) {
    console.error('usage: import.mjs --manifest <r2-manifest.json> --out <import.sql> [--data <site/src/data>]');
    process.exit(2);
  }
  try {
    const tables = build(args.data, args.manifest);
    writeFileSync(args.out, toSql(tables));
    for (const [table, rows] of Object.entries(tables)) console.log(`${table.padEnd(20)} ${rows.length}`);
    console.log(`→ ${args.out}`);
  } catch (error) {
    console.error(`import: ${error.message}`);
    process.exit(1);
  }
}
