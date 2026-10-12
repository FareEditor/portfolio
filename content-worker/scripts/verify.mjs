#!/usr/bin/env node
// Сверка D1 с бэкапом (файл `wrangler d1 export`) и проверка целостности данных.
// Расхождение с бэкапом — не обязательно ошибка: так видно, что изменилось с момента бэкапа.
//
//   node scripts/verify.mjs --backup <d1-….sql> [--db fareeditor-content]
//   node scripts/verify.mjs --negative --seed <d1-….sql>
//
// --negative создаёт временную базу из бэкапа, проверяет на ней ограничения схемы и удаляет её.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TABLES, loadBackup, selectAll } from './backup.mjs';
import { diff, lit } from './import.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_BASE = 'https://media.fareeditor.com/';
const TMP_DB = 'fareeditor-content-verify-tmp';

const { values: args } = parseArgs({
  options: {
    backup: { type: 'string' },
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
  const { sets, error } = query(db, selectAll().join('; '));
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
  if (!args.backup) {
    console.error('usage: verify.mjs --backup <d1-….sql> [--db <name>]');
    process.exit(2);
  }
  const expected = loadBackup(args.backup);
  const db = readAll(args.db);

  // Строка в строку, включая created_at / updated_at и ревизии.
  for (const table of Object.keys(TABLES)) {
    report(`${table} = бэкап`, diff(db[table], expected[table], table), `${db[table].length} строк`);
  }

  for (const locale of ['ru', 'en']) {
    const row = db.content.find((r) => r.locale === locale);
    report(`content.${locale}`, row ? [] : ['строки нет'],
      row && `${Buffer.byteLength(row.doc)} байт, sha256 ${createHash('sha256').update(row.doc).digest('hex').slice(0, 12)}`);
  }
  report('content: только ru и en', db.content.length === 2 ? [] : [`строк: ${db.content.length}`]);

  const positions = (rows) => rows.flatMap((row, i) => (row.position === i + 1 ? [] : [`position ${row.position} на месте ${i + 1}`]));
  report('stats и contacts: ровно четыре позиции подряд', [
    ...positions(db.stats), ...positions(db.contacts),
    ...(db.stats.length === 4 ? [] : [`stats: ${db.stats.length}`]), ...(db.contacts.length === 4 ? [] : [`contacts: ${db.contacts.length}`]),
  ]);
  report('testimonial_metrics: по три на отзыв', db.testimonials.flatMap((t) => {
    const n = db.testimonial_metrics.filter((m) => m.testimonial_slug === t.slug).length;
    return n === 3 ? [] : [`${t.slug}: ${n}`];
  }));
  report('media: url и kind соответствуют ключу', db.media.flatMap((m) => {
    const kind = { 'works/': 'work', 'clients/': 'client' }[m.r2_key.replace(/[^/]*$/, '')] ?? m.r2_key.match(/^before-after\/(before|after)\./)?.[1];
    return [m.url === MEDIA_BASE + m.r2_key ? null : `${m.r2_key}: url ${m.url}`, m.kind === kind ? null : `${m.r2_key}: kind ${m.kind} ≠ ${kind}`].filter(Boolean);
  }), `${db.media.length} записей`);

  const s = db.settings[0] ?? {};
  const mediaById = new Map(db.media.map((m) => [m.id, m]));
  const refs = [
    ...db.works.map((r) => ['works.thumbnail_media_id', r.slug, r.thumbnail_media_id, 'work']),
    ...db.testimonials.filter((r) => r.logo_media_id !== null).map((r) => ['testimonials.logo_media_id', r.slug, r.logo_media_id, 'client']),
    ...[['before_media_id', 'before'], ['after_media_id', 'after']].filter(([column]) => s[column] !== null && s[column] !== undefined)
      .map(([column, kind]) => [`settings.${column}`, 1, s[column], kind]),
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
    console.error('usage: verify.mjs --negative --seed <d1-….sql>');
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
    // Бэкап несёт и схему, и данные: миграции отдельно не применяются.
    const applied = execFile(TMP_DB, args.seed);
    if (!applied.ok) throw new Error(`${args.seed}: ${applied.out}`);
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
    const back = escaped.ok ? query(TMP_DB, "SELECT table_name, snapshot FROM revisions WHERE row_key = 'k' ORDER BY id DESC LIMIT 1") : { error: escaped.out };
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
