// Ресурсы админки: чтение, запись с ревизией и оптимистичной блокировкой. Формат тел — как у
// публичного API (имена полей исходного JSON); правила валидации — в rules.js.
import { COLLECTIONS } from '../../content-worker/src/schema.js';
import * as map from '../../content-worker/src/mapping.js';
import { HttpError } from './http.js';
import { validate } from './rules.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const invalid = (fields) => new HttpError(422, 'validation', { fields });

const columns = (table) => Object.values(COLLECTIONS[table]).map(([column]) => column);

// name — сегмент URL; pk — первичный ключ; extra — столбцы вне COLLECTIONS.
const DEFS = {
  categories: { table: 'categories', pk: 'slug', extra: [] },
  works: { table: 'works', pk: 'slug', extra: [] },
  'metric-types': { table: 'metric_types', pk: 'slug', extra: [] },
  testimonials: { table: 'testimonials', pk: 'slug', extra: [] },
  stats: { table: 'stats', pk: 'position', extra: ['position'], fixed: true },
  contacts: { table: 'contacts', pk: 'position', extra: ['position'], fixed: true },
  settings: { table: 'settings', pk: 'id', extra: ['id', 'before_after_enabled', 'before_media_id', 'after_media_id'], fixed: true },
  content: { table: 'content', pk: 'locale', extra: [], cols: ['locale', 'doc'], fixed: true },
};
for (const def of Object.values(DEFS)) def.cols ??= [...new Set([...def.extra, ...columns(def.table)])];
export const RESOURCES = Object.keys(DEFS);
// Набор строк задан раскладкой сайта: такие записи только правятся.
export const FIXED = RESOURCES.filter((name) => DEFS[name].fixed);
const nameByTable = (table) => RESOURCES.find((name) => DEFS[name].table === table);

// ---------- Строка базы → запись API

const mediaInfo = ({ url, width, height, duration_ms }) => ({ url, width, height, duration_ms });
const loadMedia = async (db) => new Map((await db.prepare('SELECT * FROM media').all()).results.map((m) => [m.id, m]));

// row — строка таблицы (для отзыва с полем metrics, для content — с разобранным doc).
function toApi(name, row, media) {
  const url = (id) => media.get(id)?.url ?? null;
  switch (name) {
    case 'categories': return map.category(row);
    case 'metric-types': return map.metricType(row);
    case 'works': return map.work(row, url(row.thumbnail_media_id));
    case 'testimonials': return map.testimonial(row, row.metrics, url(row.logo_media_id));
    case 'stats': return map.stat(row);
    case 'contacts': return map.contact(row);
    case 'content': return row.doc;
    default: {
      const pick = (id) => (media.has(id) ? mediaInfo(media.get(id)) : null);
      const pair = { before: pick(row.before_media_id), after: pick(row.after_media_id) };
      return { ...map.settings(row), before_after_enabled: map.bool(row.before_after_enabled), beforeAfter: pair.before && pair.after ? pair : null };
    }
  }
}

// ---------- Чтение. Каждая запись несёт updated_at — его возвращают в expected_updated_at.

const ORDER = {
  categories: 'sort_order, slug', 'metric-types': 'sort_order, slug', works: 'sort_order, slug',
  testimonials: 'sort_order, slug', stats: 'position', contacts: 'position', settings: 'id', content: 'locale',
};

async function read(db, name, key) {
  const def = DEFS[name];
  const one = key !== undefined && name !== 'settings';
  const [rows, metrics, media] = await Promise.all([
    (one ? db.prepare(`SELECT * FROM ${def.table} WHERE ${def.pk} = ?1`).bind(key) : db.prepare(`SELECT * FROM ${def.table} ORDER BY ${ORDER[name]}`)).all(),
    name === 'testimonials' ? db.prepare('SELECT * FROM testimonial_metrics ORDER BY testimonial_slug, position').all() : null,
    ['works', 'testimonials', 'settings'].includes(name) ? loadMedia(db) : null,
  ]);
  return rows.results.map((row) => {
    if (name === 'content') return { locale: row.locale, doc: JSON.parse(row.doc), updated_at: row.updated_at };
    const full = metrics ? { ...row, metrics: metrics.results.filter((m) => m.testimonial_slug === row.slug) } : row;
    return { ...toApi(name, full, media), updated_at: row.updated_at };
  });
}

export const list = async (db, name) => {
  const records = await read(db, name);
  if (name === 'settings') return records[0];
  if (name === 'content') return Object.fromEntries(records.map(({ locale, ...rest }) => [locale, rest]));
  return { items: records };
};

export async function get(db, name, key) {
  const [record] = await read(db, name, normalizeKey(name, key));
  if (record === undefined) throw new HttpError(404, 'not_found');
  if (name === 'content') return { doc: record.doc, updated_at: record.updated_at };
  return record;
}

function normalizeKey(name, key) {
  if (name === 'stats' || name === 'contacts') {
    if (!/^[1-4]$/.test(key)) throw new HttpError(404, 'not_found');
    return Number(key);
  }
  if (name === 'content' && !['ru', 'en'].includes(key)) throw new HttpError(404, 'not_found');
  return key;
}

// ---------- Запись: блокировка, ревизия и изменение одним batch

// Снимок строки как JSON-текст; для отзыва — вместе с метриками. Строки нет → 'null'.
function snapshotSql(def) {
  const pairs = def.cols.map((c) => `'${c}', ${c === 'doc' ? 'json(doc)' : c}`);
  if (def.table === 'testimonials') {
    pairs.push(`'metrics', json((SELECT json_group_array(json_object('position', position, 'metric_type_slug', metric_type_slug, 'value_ru', value_ru, 'value_en', value_en))
      FROM (SELECT * FROM testimonial_metrics WHERE testimonial_slug = ?2 ORDER BY position)))`);
  }
  return `COALESCE((SELECT json_object(${pairs.join(', ')}) FROM ${def.table} WHERE ${def.pk} = ?2), 'null')`;
}

// row === null — удаление. present — есть ли строка сейчас. metrics — три метрики отзыва.
// expected — updated_at, с которым клиент получил запись.
function writeStatements(db, def, key, row, present, metrics, expected) {
  const statements = [];
  if (expected !== undefined) {
    // Оптимистичная блокировка внутри той же транзакции. Если строка с таким updated_at не
    // нашлась, выражение пытается вставить в revisions не-JSON: CHECK (json_valid) отклоняет
    // вставку, и batch откатывается целиком. Если нашлась — не делает ничего.
    statements.push(db.prepare(`INSERT INTO revisions (table_name, row_key, snapshot) SELECT 'conflict', ?1, 'stale'
      WHERE NOT EXISTS (SELECT 1 FROM ${def.table} WHERE ${def.pk} = ?2 AND updated_at = ?3)`).bind(String(key), key, expected));
  }
  statements.push(db.prepare(`INSERT INTO revisions (table_name, row_key, snapshot) VALUES (?1, ?2, ${snapshotSql(def)})`).bind(def.table, String(key)));
  if (row === null) {
    statements.push(db.prepare(`DELETE FROM ${def.table} WHERE ${def.pk} = ?1`).bind(key));
    return statements;
  }
  const cols = Object.keys(row).filter((c) => c !== def.pk);
  const values = cols.map((c) => row[c]);
  statements.push(present
    ? db.prepare(`UPDATE ${def.table} SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(', ')}, updated_at = ${NOW} WHERE ${def.pk} = ?1`).bind(key, ...values)
    : db.prepare(`INSERT INTO ${def.table} (${[def.pk, ...cols].join(', ')}) VALUES (${['?1', ...cols.map((_, i) => `?${i + 2}`)].join(', ')})`).bind(key, ...values));
  if (metrics) {
    statements.push(db.prepare('DELETE FROM testimonial_metrics WHERE testimonial_slug = ?1').bind(key));
    for (const m of metrics) {
      statements.push(db.prepare('INSERT INTO testimonial_metrics (testimonial_slug, position, metric_type_slug, value_ru, value_en) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(key, m.position, m.metric_type_slug, m.value_ru, m.value_en));
    }
  }
  return statements;
}

// Ошибка ограничения базы (FK, CHECK, UNIQUE, устаревший updated_at) — конфликт, а не сбой сервера.
async function commit(db, statements) {
  try {
    await db.batch(statements);
  } catch (error) {
    if (/constraint|SQLITE_CONSTRAINT/i.test(String(error?.message ?? error))) throw new HttpError(409, 'conflict');
    throw error;
  }
}

const exists = async (db, def, key) =>
  (await db.prepare(`SELECT 1 AS x FROM ${def.table} WHERE ${def.pk} = ?1`).bind(key).first()) !== null;

// То, с чем правила сверяют ссылки: медиа, категории, типы метрик.
async function context(db) {
  const [media, categories, metricTypes] = await db.batch([
    db.prepare('SELECT id, url, kind FROM media'),
    db.prepare('SELECT slug FROM categories'),
    db.prepare('SELECT slug FROM metric_types'),
  ]);
  return { media: media.results, categories: categories.results.map((r) => r.slug), metricTypes: metricTypes.results.map((r) => r.slug) };
}

// Отделяет expected_updated_at от полей записи.
function takeExpected(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('expected_updated_at' in body)) return { fields: body };
  const { expected_updated_at: expected, ...fields } = body;
  if (typeof expected !== 'string' || expected === '') throw invalid([{ field: 'expected_updated_at', message: 'ожидалась строка updated_at' }]);
  return { expected, fields };
}

// create: key === undefined. Возвращает запись в формате API.
export async function save(db, name, key, body) {
  const def = DEFS[name];
  const creating = key === undefined;
  if (!creating) key = normalizeKey(name, key);
  const { expected, fields } = takeExpected(body);
  // Тело content — { doc, expected_updated_at }: у самого документа своих служебных полей нет.
  const payload = name === 'content' ? fields?.doc : fields;
  const { row, errors, metrics } = validate(name, payload, name === 'content' ? null : await context(db));
  if (name === 'content') {
    if (fields && typeof fields === 'object') for (const extra of Object.keys(fields).filter((k) => k !== 'doc')) errors.push({ field: extra, message: 'неизвестное поле' });
    row.doc = JSON.stringify(row.doc);
  }
  if (creating && expected !== undefined) errors.push({ field: 'expected_updated_at', message: 'при создании не передаётся' });

  if (def.pk === 'slug') {
    // slug задаётся при создании и больше не меняется.
    if (!creating && payload?.slug !== undefined && payload.slug !== key) errors.push({ field: 'slug', message: 'slug неизменяем' });
    if (creating && typeof row.slug === 'string') key = row.slug;
    delete row.slug;
  }
  if (errors.length) throw invalid(errors);

  if (name === 'settings') key = 1;
  const present = await exists(db, def, key);
  if (creating && present) throw new HttpError(409, 'exists');
  if (!creating && !present) throw new HttpError(404, 'not_found');
  await commit(db, writeStatements(db, def, key, row, present, metrics, expected));
  return get(db, name, String(key));
}

export async function remove(db, name, key) {
  const def = DEFS[name];
  if (!await exists(db, def, key)) throw new HttpError(404, 'not_found');
  const uses = {
    categories: 'SELECT count(*) AS n FROM works WHERE category_slug = ?1',
    'metric-types': 'SELECT count(*) AS n FROM testimonial_metrics WHERE metric_type_slug = ?1',
  }[name];
  if (uses && (await db.prepare(uses).bind(key).first()).n > 0) throw new HttpError(409, 'in_use');
  await commit(db, writeStatements(db, def, key, null, true));
}

// ---------- Ревизии

// Снимки отдаются в формате API (record), как записи самих ресурсов: интерфейс сравнивает их
// с текущей версией поле в поле. Ссылка на удалённое с тех пор медиа — null.
export async function revisions(db, name, key) {
  const def = DEFS[name];
  if (!def || typeof key !== 'string' || key === '') throw new HttpError(404, 'not_found');
  const [{ results }, media] = await Promise.all([
    db.prepare('SELECT id, created_at, snapshot FROM revisions WHERE table_name = ?1 AND row_key = ?2 ORDER BY id DESC')
      .bind(def.table, name === 'settings' ? '1' : key).all(),
    loadMedia(db),
  ]);
  return { items: results.map((r) => {
    const snapshot = JSON.parse(r.snapshot);
    return { id: r.id, created_at: r.created_at, record: snapshot === null ? null : toApi(name, snapshot, media) };
  }) };
}

// Возвращает строку к состоянию из снимка. Сама — запись через тот же механизм: текущее
// состояние уходит в новую ревизию. Снимок null (строки не было) — удаление.
export async function restore(db, id, body) {
  if (!/^[1-9][0-9]*$/.test(id)) throw new HttpError(404, 'not_found');
  const { expected, fields } = takeExpected(body);
  if (fields && Object.keys(fields).length) throw invalid(Object.keys(fields).map((field) => ({ field, message: 'неизвестное поле' })));
  const revision = await db.prepare('SELECT table_name, row_key, snapshot FROM revisions WHERE id = ?1').bind(Number(id)).first();
  const name = revision && nameByTable(revision.table_name);
  if (!name) throw new HttpError(404, 'not_found');
  const def = DEFS[name];
  const snapshot = JSON.parse(revision.snapshot);
  const key = def.pk === 'slug' || def.pk === 'locale' ? revision.row_key : Number(revision.row_key);
  const present = await exists(db, def, key);
  const result = { resource: name, key: revision.row_key, deleted: snapshot === null };

  if (snapshot === null) {
    if (def.fixed) throw new HttpError(409, 'conflict');
    if (present) await commit(db, writeStatements(db, def, key, null, true, undefined, expected));
    return result;
  }
  if (name === 'content') {
    const { errors } = validate('content', snapshot.doc);
    if (errors.length) throw invalid(errors);
  }
  const row = Object.fromEntries(def.cols.filter((c) => c !== def.pk && c in snapshot)
    .map((c) => [c, c === 'doc' ? JSON.stringify(snapshot.doc) : snapshot[c]]));
  const metrics = name === 'testimonials' ? snapshot.metrics ?? [] : undefined;
  await commit(db, writeStatements(db, def, key, row, present, metrics, expected));
  return result;
}

// Только для окружения test: batch, во втором выражении которого заведомая ошибка.
export const brokenBatch = (db) =>
  db.batch(writeStatements(db, DEFS.stats, 9, { value_ru: 'x', value_en: 'x', label_ru: 'x', label_en: 'x' }, false));
