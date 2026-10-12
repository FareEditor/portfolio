// Правила валидации записей. Чистый модуль без обращений к базе и сети: его импортируют и
// Worker, и интерфейс, поэтому проверка в браузере и на сервере — один и тот же код.
import { COLLECTIONS, CONTENT_SHAPE, shapeErrors } from '../../content-worker/src/schema.js';
import { FORM_OPTIONS } from '../../site/src/formOptions.js';

export const SLUG = /^[a-z0-9-]+$/;
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_TEXT = 20000;
export const ASPECTS = ['16:9', '9:12', '1:1', '4:5'];
export const CONTACT_KINDS = ['email', 'location', 'telegram', 'twitter'];
export { CONTENT_SHAPE, FORM_OPTIONS };

// Правила сверх типа поля: шаблон или список допустимых значений. Ключ — имя поля в JSON.
const RULES = {
  categories: { slug: SLUG, aspect: ASPECTS },
  works: { slug: SLUG, youtube_id: YOUTUBE_ID },
  metric_types: { slug: SLUG },
  testimonials: { slug: SLUG },
  contacts: { kind: CONTACT_KINDS },
  settings: { showreel_id: YOUTUBE_ID },
};
// Вид медиа, на который обязана указывать ссылка.
const MEDIA_KIND = { thumbnail: 'work', logo: 'client' };
const METRIC_KEYS = [1, 2, 3].flatMap((n) => [`metric_${n}_type`, `metric_${n}_value_ru`, `metric_${n}_value_en`]);
const TABLE = { 'metric-types': 'metric_types' };

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

function mediaRef(ctx, url, kind, field, errors) {
  const found = typeof url === 'string' ? ctx.media.find((m) => m.url === url) : null;
  if (!found) errors.push({ field, message: 'нет такого медиа' });
  else if (found.kind !== kind) errors.push({ field, message: `медиа вида ${found.kind}, нужен ${kind}` });
  else return found.id;
  return null;
}

// Тело запроса → строка таблицы. Собирает все ошибки сразу.
function toRow(table, body, ctx, { extra = [], prefix = '' } = {}) {
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
    if (base === 'media') { row[column] = mediaRef(ctx, value, MEDIA_KIND[key], field, errors); continue; }
    const problem = scalar(base, value);
    if (problem) { errors.push({ field, message: problem }); continue; }
    const rule = RULES[table]?.[key];
    if (rule instanceof RegExp && !rule.test(value)) { errors.push({ field, message: `не соответствует ${rule.source}` }); continue; }
    if (Array.isArray(rule) && !rule.includes(value)) { errors.push({ field, message: `допустимо: ${rule.join(', ')}` }); continue; }
    row[column] = base === 'bool' ? (value ? 1 : 0) : value;
  }
  return { row, errors };
}

export function contentErrors(doc) {
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

function testimonial(body, ctx) {
  const { row, errors } = toRow('testimonials', body, ctx, { extra: METRIC_KEYS });
  const metrics = [];
  for (const n of [1, 2, 3]) {
    const metric = { type: body?.[`metric_${n}_type`], value_ru: body?.[`metric_${n}_value_ru`], value_en: body?.[`metric_${n}_value_en`] };
    const part = toRow('testimonial_metrics', metric, ctx, { prefix: `metric_${n}_` });
    errors.push(...part.errors);
    metrics.push({ position: n, ...part.row });
  }
  const types = metrics.map((m) => m.metric_type_slug).filter((t) => typeof t === 'string');
  if (types.length === 3) {
    metrics.forEach((m, i) => {
      if (!ctx.metricTypes.includes(m.metric_type_slug)) errors.push({ field: `metric_${m.position}_type`, message: 'нет такого типа метрики' });
      else if (types.indexOf(m.metric_type_slug) !== i) errors.push({ field: `metric_${m.position}_type`, message: 'тип метрики повторяется' });
    });
  }
  return { row, errors, metrics };
}

function settings(body, ctx) {
  const { row, errors } = toRow('settings', body, ctx, { extra: ['before_after_enabled', 'beforeAfter'] });
  const enabled = body?.before_after_enabled;
  if (typeof enabled !== 'boolean') errors.push({ field: 'before_after_enabled', message: 'ожидался boolean' });
  const pair = body?.beforeAfter ?? null;
  row.before_after_enabled = enabled ? 1 : 0;
  row.before_media_id = null;
  row.after_media_id = null;
  if (pair !== null) {
    for (const kind of ['before', 'after']) row[`${kind}_media_id`] = mediaRef(ctx, pair?.[kind]?.url, kind, `beforeAfter.${kind}.url`, errors);
  } else if (enabled === true) {
    errors.push({ field: 'beforeAfter', message: 'для включённого сравнения нужны оба ролика' });
  }
  return { row, errors };
}

// name — имя ресурса API. ctx: { media: [{ id, url, kind }], categories: [slug], metricTypes: [slug] }.
// Возвращает { errors: [{ field, message }], row, metrics? }; для content row — { doc }.
export function validate(name, body, ctx) {
  if (name === 'content') return { errors: contentErrors(body), row: { doc: body } };
  if (name === 'testimonials') return testimonial(body, ctx);
  if (name === 'settings') return settings(body, ctx);
  const result = toRow(TABLE[name] ?? name, body, ctx);
  if (name === 'works' && typeof result.row.category_slug === 'string' && !ctx.categories.includes(result.row.category_slug)) {
    result.errors.push({ field: 'category', message: 'нет такой категории' });
  }
  return result;
}
