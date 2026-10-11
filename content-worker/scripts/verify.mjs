#!/usr/bin/env node
// Сверка D1 ↔ JSON. Обратный маппинг — src/mapping.js, общий с Worker и отдельный от
// import.mjs намеренно: общая с импортом таблица соответствий скрыла бы перепутанные столбцы.
//
//   node scripts/verify.mjs --manifest <r2-manifest.json> [--data <dir>] [--db fareeditor-content]
//   node scripts/verify.mjs --negative --seed <import.sql>
//
// --negative создаёт временную базу, проверяет на ней ограничения схемы и удаляет её.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as map from '../src/mapping.js';
import { DEFAULT_DATA_DIR, DROPPED, diff, dropPaths, lit, readFolder, readJson } from './import.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_BASE = 'https://media.fareeditor.com/';
const TMP_DB = 'fareeditor-content-verify-tmp';

// Таблица → сортировка для детерминированного чтения.
const TABLES = {
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
};

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: DEFAULT_DATA_DIR },
    manifest: { type: 'string' },
    db: { type: 'string', default: 'fareeditor-content' },
    negative: { type: 'boolean', default: false },
    seed: { type: 'string' },
  },
});

// Идентификаторы аккаунта из сообщений wrangler в вывод не попадают.
const redact = (text) => String(text).replace(/[0-9a-f]{32}/g, '<redacted>').replace(/\x1b\[[0-9;]*m/g, '');

function wrangler(argv) {
  try {
    return { ok: true, out: execFileSync('npx', ['wrangler', ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, out: redact(`${error.stdout ?? ''}${error.stderr ?? ''}`) };
  }
}

// Все SELECT одной командой: массив наборов строк либо { error }.
function query(db, sql) {
  const { ok, out } = wrangler(['d1', 'execute', db, '--remote', '--json', '--command', sql]);
  if (!ok) {
    try {
      const { error } = JSON.parse(out);
      return { error: [error.text, ...(error.notes ?? []).map((n) => n.text)].join(' | ') };
    } catch {
      return { error: out.trim() };
    }
  }
  return { sets: JSON.parse(out).map((set) => set.results) };
}

const execFile = (db, file) => wrangler(['d1', 'execute', db, '--remote', '--yes', '--file', file]);

function readAll(db) {
  const names = Object.keys(TABLES);
  const { sets, error } = query(db, names.map((t) => `SELECT * FROM ${t} ORDER BY ${TABLES[t]}`).join('; '));
  if (error) throw new Error(error);
  return Object.fromEntries(names.map((t, i) => [t, sets[i]]));
}

// Отпечаток состояния без created_at/updated_at: полная замена их обновляет.
function digest(tables) {
  const stripped = Object.fromEntries(Object.entries(tables).map(([name, rows]) =>
    [name, rows.map(({ created_at, updated_at, ...rest }) => rest)]));
  return createHash('sha256').update(JSON.stringify(stripped)).digest('hex');
}

let failed = 0;
function report(name, problems, detail = '') {
  if (problems.length === 0) {
    console.log(`PASS ${name}${detail && ` — ${detail}`}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}`);
    for (const problem of problems.slice(0, 20)) console.log(`     ${problem}`);
  }
}

function verify() {
  if (!args.manifest) {
    console.error('usage: verify.mjs --manifest <r2-manifest.json> [--data <dir>] [--db <name>]');
    process.exit(2);
  }
  const manifest = readJson(args.manifest);
  const db = readAll(args.db);
  const src = (...parts) => join(args.data, ...parts);

  // media.id → исходный путь в данных (/media/…), через ключ манифеста.
  const sourceByKey = new Map(manifest.map((m) => [m.key, m.source.replace(/^site\/public/, '')]));
  const mediaById = new Map(db.media.map((m) => [m.id, m]));
  const mediaPath = (id) => (mediaById.has(id) ? sourceByKey.get(mediaById.get(id).r2_key) : `<нет media ${id}>`);

  // Необязательные строки: в D1 NULL, в JSON пустая строка или поля нет.
  const optional = (record, keys) => ({ ...Object.fromEntries(keys.map((k) => [k, ''])), ...record });

  const bySlug = (name, rows, dir, restore, normalize = (r) => r) => {
    const expected = new Map(readFolder(src(dir)).map(([, record]) => [record.slug, normalize(record)]));
    const actual = new Map(rows.map((row) => [row.slug, restore(row)]));
    const problems = [...new Set([...expected.keys(), ...actual.keys()])].sort().flatMap((slug) =>
      expected.has(slug) && actual.has(slug)
        ? diff(actual.get(slug), expected.get(slug), slug)
        : [`${slug}: есть только в ${expected.has(slug) ? 'JSON' : 'D1'}`]);
    report(name, problems, `${actual.size} записей`);
  };

  bySlug('categories', db.categories, 'categories', map.category, (record) => optional(record, ['blurb_ru', 'blurb_en']));

  bySlug('metric_types', db.metric_types, 'metric-types', map.metricType);

  bySlug('works', db.works, 'works', (r) => map.work(r, mediaPath(r.thumbnail_media_id)));

  bySlug('testimonials + testimonial_metrics', db.testimonials, 'testimonials', (r) => map.testimonial(r,
    db.testimonial_metrics.filter((m) => m.testimonial_slug === r.slug),
    r.logo_media_id === null ? null : mediaPath(r.logo_media_id)), (record) => {
    const { logo, ...rest } = record;
    return logo ? record : rest;
  });
  report('testimonial_metrics без отзыва-владельца',
    db.testimonial_metrics.filter((m) => !db.testimonials.some((t) => t.slug === m.testimonial_slug))
      .map((m) => `${m.testimonial_slug}#${m.position}`));

  const positions = (rows) => rows.flatMap((row, i) => (row.position === i + 1 ? [] : [`position ${row.position} на месте ${i + 1}`]));

  report('stats', [...positions(db.stats), ...diff({
    items: db.stats.map(map.stat),
  }, readJson(src('stats.json')))], `${db.stats.length} строк`);

  const contacts = readJson(src('contacts.json'));
  report('contacts', [...positions(db.contacts), ...diff({
    items: db.contacts.map(map.contact),
  }, { items: contacts.items.map((item) => optional(item, ['subject_ru', 'subject_en'])) })], `${db.contacts.length} строк`);

  const s = db.settings[0] ?? {};
  report('settings', db.settings.length !== 1 ? [`строк: ${db.settings.length}`] : diff(map.settings(s), readJson(src('settings.json'))));

  const beforeId = db.media.find((m) => m.kind === 'before')?.id;
  const afterId = db.media.find((m) => m.kind === 'after')?.id;
  report('settings.before_after', diff(
    { before_after_enabled: s.before_after_enabled, before_media_id: s.before_media_id, after_media_id: s.after_media_id },
    { before_after_enabled: 1, before_media_id: beforeId, after_media_id: afterId }));

  // content.doc: байты в базе = компактная сериализация исходника без DROPPED, порядок ключей сохранён.
  for (const locale of ['ru', 'en']) {
    const source = readJson(src('content', `${locale}.json`));
    const expected = JSON.stringify(dropPaths(source));
    const row = db.content.find((r) => r.locale === locale);
    const problems = [];
    if (!row) problems.push('строки нет');
    else if (row.doc !== expected) problems.push(...diff(JSON.parse(row.doc), JSON.parse(expected), locale), 'байты doc отличаются от канонической сериализации');
    // Отброшено ровно то, что перечислено в DROPPED, и ничего больше.
    if (row) problems.push(...diff({ ...JSON.parse(row.doc), work: { ...JSON.parse(row.doc).work, motionTitle: source.work.motionTitle } }, source, `${locale}+dropped`));
    report(`content.${locale}`, problems, `${Buffer.byteLength(expected)} байт, sha256 ${createHash('sha256').update(expected).digest('hex').slice(0, 12)}, без ${DROPPED.join(', ')}`);
  }
  report('content: только ru и en', db.content.length === 2 ? [] : [`строк: ${db.content.length}`]);

  report('media ↔ manifest', [
    ...diff(db.media.map(({ id, kind, created_at, duration_ms, ...rest }) => rest),
      manifest.map((m) => ({ r2_key: m.key, url: m.url, sha256: m.sha256, bytes: m.bytes, content_type: m.content_type, width: m.width, height: m.height })), 'media'),
    ...db.media.flatMap((m, i) => {
      const entry = manifest[i] ?? {};
      const kind = { 'works/': 'work', 'clients/': 'client' }[m.r2_key.replace(/[^/]*$/, '')] ?? m.r2_key.match(/^before-after\/(before|after)\./)?.[1];
      return [
        m.url === MEDIA_BASE + m.r2_key ? null : `${m.r2_key}: url ${m.url}`,
        m.kind === kind ? null : `${m.r2_key}: kind ${m.kind} ≠ ${kind}`,
        Object.is(m.duration_ms, entry.duration === null ? null : Math.round(entry.duration * 1000)) ? null : `${m.r2_key}: duration_ms ${m.duration_ms}`,
      ].filter(Boolean);
    }),
  ], `${db.media.length} записей`);

  const refs = [
    ...db.works.map((r) => ['works.thumbnail_media_id', r.slug, r.thumbnail_media_id, 'work']),
    ...db.testimonials.filter((r) => r.logo_media_id !== null).map((r) => ['testimonials.logo_media_id', r.slug, r.logo_media_id, 'client']),
    ['settings.before_media_id', 1, s.before_media_id, 'before'],
    ['settings.after_media_id', 1, s.after_media_id, 'after'],
  ];
  report('FK → media', refs.flatMap(([column, key, id, kind]) =>
    mediaById.get(id)?.kind === kind ? [] : [`${column} (${key}) → ${id}: ${mediaById.has(id) ? `kind ${mediaById.get(id).kind}, ожидался ${kind}` : 'записи нет'}`]),
  `${refs.length} ссылок`);

  const slugs = (rows) => new Set(rows.map((r) => r.slug));
  report('FK → categories, metric_types', [
    ...db.works.filter((w) => !slugs(db.categories).has(w.category_slug)).map((w) => `works.${w.slug} → ${w.category_slug}`),
    ...db.testimonial_metrics.filter((m) => !slugs(db.metric_types).has(m.metric_type_slug)).map((m) => `metric ${m.testimonial_slug}#${m.position} → ${m.metric_type_slug}`),
  ]);

  const check = query(args.db, 'PRAGMA foreign_keys; PRAGMA foreign_key_check');
  report('PRAGMA foreign_keys = 1, foreign_key_check пуст', check.error ? [check.error]
    : [...(check.sets[0][0]?.foreign_keys === 1 ? [] : ['foreign_keys выключен']), ...check.sets[1].map((v) => JSON.stringify(v))]);

  console.log(`INFO revisions: ${db.revisions.length} строк`);
  console.log(`INFO строк: ${Object.entries(db).map(([t, rows]) => `${t}=${rows.length}`).join(' ')}`);
  console.log(`INFO digest (без created_at/updated_at): ${digest(db)}`);
}

// Каждая команда должна быть отклонена с ошибкой указанного вида.
const NEGATIVE = [
  ['slug: заглавные и подчёркивание', "INSERT INTO categories (slug, sort_order, title_ru, title_en) VALUES ('Bad_Slug', 9, 'x', 'x')", 'CHECK'],
  ['slug: пустой', "INSERT INTO categories (slug, sort_order, title_ru, title_en) VALUES ('', 9, 'x', 'x')", 'CHECK'],
  ['slug: кириллица', "INSERT INTO metric_types (slug, sort_order, label_ru, label_en) VALUES ('метрика', 9, 'x', 'x')", 'CHECK'],
  ['slug: пробел (works)', "UPDATE works SET slug = 'bad slug'", 'CHECK'],
  ['slug: точка (testimonials)', "UPDATE testimonials SET slug = 'bad.slug'", 'CHECK'],
  ['aspect вне списка', "UPDATE categories SET aspect = '4:3'", 'CHECK'],
  ['contacts.kind вне списка', "UPDATE contacts SET kind = 'phone' WHERE position = 1", 'CHECK'],
  ['media.kind вне списка', "INSERT INTO media (kind, r2_key, url, sha256, bytes, content_type) VALUES ('logo', 'x/y', 'u', '" + '0'.repeat(64) + "', 1, 'image/webp')", 'CHECK'],
  ['media.r2_key дубль', "INSERT INTO media (kind, r2_key, url, sha256, bytes, content_type) SELECT 'work', r2_key, 'u', sha256, 1, 'image/webp' FROM media LIMIT 1", 'UNIQUE'],
  ['дубль метрики в отзыве', 'UPDATE testimonial_metrics SET metric_type_slug = (SELECT t.metric_type_slug FROM testimonial_metrics t WHERE t.testimonial_slug = testimonial_metrics.testimonial_slug AND t.position = 2) WHERE position = 1', 'UNIQUE'],
  ['метрика: position 4', 'UPDATE testimonial_metrics SET position = 4 WHERE position = 3', 'CHECK'],
  ['метрика: дубль position', 'UPDATE testimonial_metrics SET position = 2 WHERE position = 3', 'UNIQUE'],
  ['stats: пятая строка', "INSERT INTO stats (position, value_ru, value_en, label_ru, label_en) VALUES (5, 'x', 'x', 'x', 'x')", 'CHECK'],
  ['stats: дубль position', "INSERT INTO stats (position, value_ru, value_en, label_ru, label_en) VALUES (4, 'x', 'x', 'x', 'x')", 'UNIQUE'],
  ['contacts: пятая строка', "INSERT INTO contacts (position, kind, label_ru, label_en, value_ru, value_en) VALUES (5, 'email', 'x', 'x', 'x', 'x')", 'CHECK'],
  ['settings: вторая строка', "INSERT INTO settings (id, status_ru, status_en, showreel_id, contact_url_ru, contact_url_en) VALUES (2, 'x', 'x', 'x', 'x', 'x')", 'CHECK'],
  ['settings: дубль id = 1', "INSERT INTO settings (id, status_ru, status_en, showreel_id, contact_url_ru, contact_url_en) VALUES (1, 'x', 'x', 'x', 'x', 'x')", 'UNIQUE'],
  ['settings: before_after без media', 'UPDATE settings SET before_media_id = NULL', 'CHECK'],
  ['FK: works.thumbnail_media_id', 'UPDATE works SET thumbnail_media_id = 999999', 'FOREIGN KEY'],
  ['FK: testimonials.logo_media_id', 'UPDATE testimonials SET logo_media_id = 999999', 'FOREIGN KEY'],
  ['FK: settings.before_media_id', 'UPDATE settings SET before_media_id = 999999', 'FOREIGN KEY'],
  ['FK: works.category_slug', "UPDATE works SET category_slug = 'nope'", 'FOREIGN KEY'],
  ['FK: testimonial_metrics.metric_type_slug', "UPDATE testimonial_metrics SET metric_type_slug = 'nope' WHERE position = 1", 'FOREIGN KEY'],
  ['FK: удаление media со ссылками', 'DELETE FROM media', 'FOREIGN KEY'],
  ['FK: удаление категории с работами', 'DELETE FROM categories', 'FOREIGN KEY'],
  ['published вне 0/1', 'UPDATE works SET published = 2', 'CHECK'],
  ['youtube_id: 10 символов', "UPDATE works SET youtube_id = 'abcdefghij'", 'CHECK'],
  ['youtube_id: недопустимый символ', "UPDATE works SET youtube_id = 'abcdefghi!k'", 'CHECK'],
  ['sort_order не целое', "UPDATE works SET sort_order = 'x'", 'CHECK'],
  ['обязательное поле пустое', "UPDATE categories SET title_ru = ''", 'CHECK'],
  ['обязательное поле NULL', 'UPDATE works SET title_en = NULL', 'NOT NULL'],
  ['content.locale вне ru/en', "INSERT INTO content (locale, doc) VALUES ('de', '{}')", 'CHECK'],
  ['content.doc не JSON', "UPDATE content SET doc = '{' WHERE locale = 'ru'", 'CHECK'],
];

function negative() {
  if (!args.seed) {
    console.error('usage: verify.mjs --negative --seed <import.sql>');
    process.exit(2);
  }
  const listed = () => JSON.parse(wrangler(['d1', 'list', '--json']).out).some((d) => d.name === TMP_DB);
  const tmp = mkdtempSync(join(tmpdir(), 'd1-verify-'));
  const sqlFile = (name, sql) => {
    const path = join(tmp, name);
    writeFileSync(path, sql);
    return path;
  };

  if (listed()) throw new Error(`${TMP_DB} уже существует — удалить вручную и повторить`);
  const created = wrangler(['d1', 'create', TMP_DB]);
  if (!created.ok) throw new Error(created.out);
  console.log(`INFO временная база ${TMP_DB} создана`);

  try {
    for (const file of [join(ROOT, 'migrations/0001_init.sql'), args.seed]) {
      const applied = execFile(TMP_DB, file);
      if (!applied.ok) throw new Error(`${file}: ${applied.out}`);
    }
    const before = digest(readAll(TMP_DB));

    for (const [name, sql, expected] of NEGATIVE) {
      const { error } = query(TMP_DB, sql);
      report(`отклонено: ${name}`, error?.includes(expected) ? [] : [error ? `ожидалось ${expected}, получено: ${error}` : 'команда выполнена'],
        error?.match(/[A-Z ]+ constraint failed/)?.[0].trim());
    }
    report('после негативных проверок состояние не изменилось', digest(readAll(TMP_DB)) === before ? [] : ['digest изменился']);

    // Экранирование тем же lit(), что в импорте, и тем же путём — через --file.
    const tricky = `'одинарные' "двойные" \\обратный слэш; -- комментарий\nвторая строка\r\n\tтабуляция 🎬👨‍👩‍👧 Ёё /* */ '' %_`;
    const escaped = execFile(TMP_DB, sqlFile('escape.sql', `INSERT INTO revisions (table_name, row_key, snapshot) VALUES (${lit(tricky)}, 'k', ${lit(JSON.stringify({ tricky }))});\n`));
    const back = escaped.ok ? query(TMP_DB, 'SELECT table_name, snapshot FROM revisions') : { error: escaped.out };
    report('экранирование: кавычки, апострофы, переводы строк, эмодзи, кириллица', back.error ? [back.error] : diff(
      { table_name: back.sets[0][0]?.table_name, tricky: JSON.parse(back.sets[0][0]?.snapshot ?? '{}').tricky }, { table_name: tricky, tricky }));

    // Атомарность --file: рабочая команда, затем сбойная.
    const atomic = execFile(TMP_DB, sqlFile('atomic.sql', "INSERT INTO revisions (table_name, row_key, snapshot) VALUES ('atomic', 'k', '{}');\nINSERT INTO stats (position, value_ru, value_en, label_ru, label_en) VALUES (5, 'x', 'x', 'x', 'x');\n"));
    const leaked = query(TMP_DB, "SELECT count(*) AS n FROM revisions WHERE table_name = 'atomic'").sets?.[0][0].n;
    console.log(`INFO атомарность --file: файл ${atomic.ok ? 'принят' : 'отклонён'}, строк от первой команды осталось: ${leaked}`);
    report('сбой посреди --file откатывает файл целиком', !atomic.ok && leaked === 0 ? [] : ['частичное применение']);

    const tx = execFile(TMP_DB, sqlFile('tx.sql', "BEGIN TRANSACTION;\nINSERT INTO revisions (table_name, row_key, snapshot) VALUES ('tx', 'k', '{}');\nCOMMIT;\n"));
    console.log(`INFO явные BEGIN/COMMIT в --file: ${tx.ok ? 'приняты' : `отклонены — ${tx.out.match(/To execute a transaction[^.]*\./)?.[0] ?? tx.out.trim().split('\n').at(-1)}`}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    const deleted = wrangler(['d1', 'delete', TMP_DB, '--skip-confirmation']);
    report(`временная база ${TMP_DB} удалена`, deleted.ok && !listed() ? [] : [deleted.out || 'всё ещё в списке']);
  }
}

try {
  if (args.negative) negative();
  else verify();
} catch (error) {
  console.error(`verify: ${redact(error.message)}`);
  process.exit(1);
}
console.log(failed === 0 ? 'ИТОГ: PASS' : `ИТОГ: FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
