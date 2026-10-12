// Ресурсы админки: чтение, валидация, запись с ревизией. Формат тел — как у публичного API
// (имена полей исходного JSON); поля и типы — из общей схемы content-worker.
import { COLLECTIONS, CONTENT_SHAPE, shapeErrors } from '../../content-worker/src/schema.js';
import * as map from '../../content-worker/src/mapping.js';
import { FORM_OPTIONS } from '../../site/src/formOptions.js';
import { HttpError } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const SLUG = /^[a-z0-9-]+$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_TEXT = 20000;

const invalid = (fields) => new HttpError(422, 'validation', { fields });

// Правила сверх типа поля: шаблон или список допустимых значений (из config.yml Decap и
// раздела 6 отчёта этапа 2). Ключ — имя поля в JSON.
const RULES = {
  categories: { slug: SLUG, aspect: ['16:9', '9:12', '1:1', '4:5'] },
  works: { slug: SLUG, youtube_id: YOUTUBE_ID },
  metric_types: { slug: SLUG },
  testimonials: { slug: SLUG },
  contacts: { kind: ['email', 'location', 'telegram', 'twitter'] },
  settings: { showreel_id: YOUTUBE_ID },
};
// Вид медиа, на который обязана указывать ссылка.
const MEDIA_KIND = { thumbnail: 'work', logo: 'client' };
const METRIC_KEYS = [1, 2, 3].flatMap((n) => [`metric_${n}_type`, `metric_${n}_value_ru`, `metric_${n}_value_en`]);

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
const defByTable = (table) => Object.values(DEFS).find((d) => d.table === table);

// ---------- Валидация

function scalar(type, value) {
  if (type === 'text') {
    if (typeof value !== 'string') return 'ожидалась строка';
    if (value.trim() === '') return 'обязательное поле';
    if (value.includes('\0')) return 'недопустимый символ';
    if (value.length > MAX_TEXT) return `длиннее ${MAX_TEXT} символов`;
  } else if (type === 'int') {
    if (!Number.isSafeInteger(value)) return 'ожидалось целое число';
  } else if (type === 'bool') {
    if (typeof value !== 'boolean') return 'ожидался boolean';
  }
  return null;
}

// Тело запроса → строка таблицы. Собирает все ошибки; ссылки на медиа сверяет с таблицей media.
async function toRow(db, table, body, { extra = [], prefix = '' } = {}) {
  const spec = COLLECTIONS[table];
  const errors = [];
  const row = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { row, errors: [{ field: prefix || 'body', message: 'ожидался объект' }] };
  for (const key of Object.keys(body)) {
    if (!(key in spec) && !extra.includes(key)) errors.push({ field: prefix + key, message: 'неизвестное поле' });
  }
  for (const [key, [column, type]] of Object.entries(spec)) {
    const field = prefix + key;
    const value = body[key];
    const optional = type.endsWith('?');
    const base = optional ? type.slice(0, -1) : type;
    if (optional && (value === undefined || value === '' || value === null)) { row[column] = null; continue; }
    if (value === undefined) { errors.push({ field, message: 'поле отсутствует' }); continue; }
    if (base === 'media') {
      const found = typeof value === 'string' ? await db.prepare('SELECT id, kind FROM media WHERE url = ?').bind(value).first() : null;
      if (!found) errors.push({ field, message: 'нет такого медиа' });
      else if (found.kind !== MEDIA_KIND[key]) errors.push({ field, message: `медиа вида ${found.kind}, нужен ${MEDIA_KIND[key]}` });
      else row[column] = found.id;
      continue;
    }
    const problem = scalar(base, value);
    if (problem) { errors.push({ field, message: problem }); continue; }
    const rule = RULES[table]?.[key];
    if (rule instanceof RegExp && !rule.test(value)) { errors.push({ field, message: `не соответствует ${rule.source}` }); continue; }
    if (Array.isArray(rule) && !rule.includes(value)) { errors.push({ field, message: `допустимо: ${rule.join(', ')}` }); continue; }
    row[column] = base === 'bool' ? (value ? 1 : 0) : value;
  }
  return { row, errors };
}

function contentErrors(doc) {
  const fields = shapeErrors(doc, CONTENT_SHAPE, 'content').map((line) => {
    const cut = line.indexOf(': ');
    return { field: line.slice(0, cut).replace(/^content\.?/, '') || 'body', message: line.slice(cut + 2) };
  });
  if (fields.length) return fields;
  // Форма сошлась: все листья — строки. Пустых и чрезмерно длинных быть не должно.
  const walk = (value, path) => {
    if (typeof value === 'string') {
      const problem = scalar('text', value);
      if (problem) fields.push({ field: path, message: problem });
    } else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
  };
  walk(doc, '');
  // Ключи опций формы — контракт с воркером контакт-формы: меняются только подписи.
  for (const [name, keys] of Object.entries(FORM_OPTIONS)) {
    doc.contact[name].forEach((option, i) => {
      if (option.value !== keys[i]) fields.push({ field: `contact.${name}[${i}].value`, message: `ключ опции неизменяем: ${keys[i]}` });
    });
  }
  return fields;
}

// ---------- Чтение

const mediaInfo = ({ url, width, height, duration_ms }) => ({ url, width, height, duration_ms });

const READ = {
  categories: (db, slug) => rows(db, 'SELECT * FROM categories', 'slug', slug, 'sort_order, slug', map.category),
  'metric-types': (db, slug) => rows(db, 'SELECT * FROM metric_types', 'slug', slug, 'sort_order, slug', map.metricType),
  works: (db, slug) => rows(db, 'SELECT w.*, m.url AS thumbnail_url FROM works w JOIN media m ON m.id = w.thumbnail_media_id',
    'w.slug', slug, 'w.sort_order, w.slug', (w) => map.work(w, w.thumbnail_url)),
  stats: (db, position) => rows(db, 'SELECT * FROM stats', 'position', position, 'position', map.stat),
  contacts: (db, position) => rows(db, 'SELECT * FROM contacts', 'position', position, 'position', map.contact),
  async testimonials(db, slug) {
    const where = slug === undefined ? '' : ' WHERE t.slug = ?1';
    const [list, metrics] = await db.batch([
      db.prepare(`SELECT t.*, m.url AS logo_url FROM testimonials t LEFT JOIN media m ON m.id = t.logo_media_id${where} ORDER BY t.sort_order, t.slug`).bind(...(slug === undefined ? [] : [slug])),
      db.prepare('SELECT * FROM testimonial_metrics ORDER BY testimonial_slug, position'),
    ]);
    return list.results.map((t) => map.testimonial(t, metrics.results.filter((m) => m.testimonial_slug === t.slug), t.logo_url));
  },
  async settings(db) {
    const [settings, media] = await db.batch([
      db.prepare('SELECT * FROM settings WHERE id = 1'),
      db.prepare('SELECT * FROM media WHERE id IN (SELECT before_media_id FROM settings UNION SELECT after_media_id FROM settings)'),
    ]);
    const s = settings.results[0];
    const pick = (id) => { const m = media.results.find((x) => x.id === id); return m ? mediaInfo(m) : null; };
    const pair = { before: pick(s.before_media_id), after: pick(s.after_media_id) };
    return [{ ...map.settings(s), before_after_enabled: map.bool(s.before_after_enabled), beforeAfter: pair.before && pair.after ? pair : null }];
  },
  async content(db, locale) {
    const { results } = await db.prepare('SELECT locale, doc FROM content ORDER BY locale').all();
    return results.filter((r) => locale === undefined || r.locale === locale).map((r) => ({ locale: r.locale, doc: JSON.parse(r.doc) }));
  },
};

async function rows(db, select, keyColumn, key, order, mapper) {
  const statement = key === undefined
    ? db.prepare(`${select} ORDER BY ${order}`)
    : db.prepare(`${select} WHERE ${keyColumn} = ?1`).bind(key);
  return (await statement.all()).results.map(mapper);
}

export const list = async (db, name) => {
  if (name === 'settings') return (await READ.settings(db))[0];
  if (name === 'content') return Object.fromEntries((await READ.content(db)).map((r) => [r.locale, r.doc]));
  return { items: await READ[name](db) };
};

export async function get(db, name, key) {
  const [record] = await READ[name](db, normalizeKey(name, key));
  if (record === undefined) throw new HttpError(404, 'not_found');
  return name === 'content' ? record.doc : record;
}

function normalizeKey(name, key) {
  if (name === 'stats' || name === 'contacts') {
    if (!/^[1-4]$/.test(key)) throw new HttpError(404, 'not_found');
    return Number(key);
  }
  if (name === 'content' && !['ru', 'en'].includes(key)) throw new HttpError(404, 'not_found');
  return key;
}

// ---------- Запись: ревизия и изменение одним batch

// Снимок строки как JSON-текст; для отзыва — вместе с метриками. Строки нет → 'null'.
function snapshotSql(def) {
  const pairs = def.cols.map((c) => `'${c}', ${c === 'doc' ? 'json(doc)' : c}`);
  if (def.table === 'testimonials') {
    pairs.push(`'metrics', json((SELECT json_group_array(json_object('position', position, 'metric_type_slug', metric_type_slug, 'value_ru', value_ru, 'value_en', value_en))
      FROM (SELECT * FROM testimonial_metrics WHERE testimonial_slug = ?2 ORDER BY position)))`);
  }
  return `COALESCE((SELECT json_object(${pairs.join(', ')}) FROM ${def.table} WHERE ${def.pk} = ?2), 'null')`;
}

const revisionStatement = (db, def, key) =>
  db.prepare(`INSERT INTO revisions (table_name, row_key, snapshot) VALUES (?1, ?2, ${snapshotSql(def)})`).bind(def.table, String(key));

// row === null — удаление. exists — есть ли строка сейчас. metrics — три метрики отзыва.
function writeStatements(db, def, key, row, exists, metrics) {
  const statements = [revisionStatement(db, def, key)];
  if (row === null) {
    statements.push(db.prepare(`DELETE FROM ${def.table} WHERE ${def.pk} = ?1`).bind(key));
    return statements;
  }
  const cols = Object.keys(row).filter((c) => c !== def.pk);
  const values = cols.map((c) => row[c]);
  statements.push(exists
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

// Ошибка ограничения базы (FK, CHECK, UNIQUE) — конфликт данных, а не сбой сервера.
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

async function testimonialRow(db, body) {
  const { row, errors } = await toRow(db, 'testimonials', body, { extra: METRIC_KEYS });
  const metrics = [];
  for (const n of [1, 2, 3]) {
    const metric = { type: body?.[`metric_${n}_type`], value_ru: body?.[`metric_${n}_value_ru`], value_en: body?.[`metric_${n}_value_en`] };
    const part = await toRow(db, 'testimonial_metrics', metric, { prefix: `metric_${n}_` });
    errors.push(...part.errors);
    metrics.push({ position: n, ...part.row });
  }
  const types = metrics.map((m) => m.metric_type_slug).filter((t) => typeof t === 'string');
  if (types.length === 3) {
    const known = (await db.prepare('SELECT slug FROM metric_types').all()).results.map((r) => r.slug);
    metrics.forEach((m, i) => {
      if (!known.includes(m.metric_type_slug)) errors.push({ field: `metric_${m.position}_type`, message: 'нет такого типа метрики' });
      else if (types.indexOf(m.metric_type_slug) !== i) errors.push({ field: `metric_${m.position}_type`, message: 'тип метрики повторяется' });
    });
  }
  return { row, errors, metrics };
}

async function settingsRow(db, body) {
  const { row, errors } = await toRow(db, 'settings', body, { extra: ['before_after_enabled', 'beforeAfter'] });
  const enabled = body?.before_after_enabled;
  if (typeof enabled !== 'boolean') errors.push({ field: 'before_after_enabled', message: 'ожидался boolean' });
  const pair = body?.beforeAfter ?? null;
  row.before_after_enabled = enabled ? 1 : 0;
  row.before_media_id = null;
  row.after_media_id = null;
  if (pair !== null) {
    for (const kind of ['before', 'after']) {
      const url = pair?.[kind]?.url;
      const found = typeof url === 'string' ? await db.prepare('SELECT id, kind FROM media WHERE url = ?').bind(url).first() : null;
      if (!found) errors.push({ field: `beforeAfter.${kind}.url`, message: 'нет такого медиа' });
      else if (found.kind !== kind) errors.push({ field: `beforeAfter.${kind}.url`, message: `медиа вида ${found.kind}, нужен ${kind}` });
      else row[`${kind}_media_id`] = found.id;
    }
  } else if (enabled === true) {
    errors.push({ field: 'beforeAfter', message: 'для включённого сравнения нужны оба ролика' });
  }
  return { row, errors };
}

// create: key === undefined. Возвращает запись в формате API.
export async function save(db, name, key, body) {
  const def = DEFS[name];
  const creating = key === undefined;
  if (creating && def.fixed) throw new HttpError(405, 'method_not_allowed');
  if (!creating) key = normalizeKey(name, key);

  let row;
  let errors;
  let metrics;
  if (name === 'content') {
    errors = contentErrors(body);
    row = { doc: JSON.stringify(body) };
  } else if (name === 'testimonials') ({ row, errors, metrics } = await testimonialRow(db, body));
  else if (name === 'settings') ({ row, errors } = await settingsRow(db, body));
  else ({ row, errors } = await toRow(db, def.table, body));

  if (def.pk === 'slug') {
    // slug задаётся при создании и больше не меняется.
    if (!creating && body?.slug !== undefined && body.slug !== key) errors.push({ field: 'slug', message: 'slug неизменяем' });
    if (creating && typeof row.slug === 'string') key = row.slug;
    delete row.slug;
  }
  if (name === 'works' && typeof row.category_slug === 'string'
    && !await exists(db, DEFS.categories, row.category_slug)) errors.push({ field: 'category', message: 'нет такой категории' });
  if (errors.length) throw invalid(errors);

  if (name === 'settings') key = 1;
  const present = await exists(db, def, key);
  if (creating && present) throw new HttpError(409, 'exists');
  if (!creating && !present) throw new HttpError(404, 'not_found');
  await commit(db, writeStatements(db, def, key, row, present, metrics));
  return get(db, name, String(key));
}

export async function remove(db, name, key) {
  const def = DEFS[name];
  if (def.fixed) throw new HttpError(405, 'method_not_allowed');
  if (!await exists(db, def, key)) throw new HttpError(404, 'not_found');
  const uses = {
    categories: 'SELECT count(*) AS n FROM works WHERE category_slug = ?1',
    'metric-types': 'SELECT count(*) AS n FROM testimonial_metrics WHERE metric_type_slug = ?1',
  }[name];
  if (uses && (await db.prepare(uses).bind(key).first()).n > 0) throw new HttpError(409, 'in_use');
  await commit(db, writeStatements(db, def, key, null, true));
}

// ---------- Ревизии

export async function revisions(db, name, key) {
  const def = DEFS[name];
  if (!def || typeof key !== 'string' || key === '') throw new HttpError(404, 'not_found');
  const { results } = await db.prepare('SELECT id, created_at, snapshot FROM revisions WHERE table_name = ?1 AND row_key = ?2 ORDER BY id DESC')
    .bind(def.table, name === 'settings' ? '1' : key).all();
  return { items: results.map((r) => ({ id: r.id, created_at: r.created_at, snapshot: JSON.parse(r.snapshot) })) };
}

// Возвращает строку к состоянию из снимка. Сама — запись через тот же механизм: текущее
// состояние уходит в новую ревизию. Снимок null (строки не было) — удаление.
export async function restore(db, id) {
  if (!/^[1-9][0-9]*$/.test(id)) throw new HttpError(404, 'not_found');
  const revision = await db.prepare('SELECT table_name, row_key, snapshot FROM revisions WHERE id = ?1').bind(Number(id)).first();
  const def = revision && defByTable(revision.table_name);
  if (!def) throw new HttpError(404, 'not_found');
  const snapshot = JSON.parse(revision.snapshot);
  const key = def.pk === 'slug' || def.pk === 'locale' ? revision.row_key : Number(revision.row_key);
  const present = await exists(db, def, key);

  if (snapshot === null) {
    if (def.fixed) throw new HttpError(409, 'conflict');
    if (present) await commit(db, writeStatements(db, def, key, null, true));
    return { restored: revision.table_name, key: revision.row_key, deleted: true };
  }
  if (def.table === 'content') {
    const errors = contentErrors(snapshot.doc);
    if (errors.length) throw invalid(errors);
  }
  const row = Object.fromEntries(def.cols.filter((c) => c !== def.pk && c in snapshot)
    .map((c) => [c, c === 'doc' ? JSON.stringify(snapshot.doc) : snapshot[c]]));
  const metrics = def.table === 'testimonials' ? snapshot.metrics ?? [] : undefined;
  await commit(db, writeStatements(db, def, key, row, present, metrics));
  return { restored: revision.table_name, key: revision.row_key, deleted: false };
}

// Только для окружения test: batch, во втором выражении которого заведомая ошибка.
export const brokenBatch = (db) =>
  db.batch(writeStatements(db, DEFS.stats, 9, { value_ru: 'x', value_en: 'x', label_ru: 'x', label_en: 'x' }, false));
