// Правила загрузки медиа. Чистый модуль: общий для Worker'а и интерфейса.

const MB = 1024 * 1024;
export const LIMITS = { image: 5 * MB, video: 60 * MB };
const IMAGES = ['image/webp', 'image/png', 'image/jpeg'];
export const KINDS = {
  work: { prefix: 'works/', types: IMAGES },
  client: { prefix: 'clients/', types: IMAGES },
  before: { prefix: 'before-after/', types: ['video/mp4'] },
  after: { prefix: 'before-after/', types: ['video/mp4'] },
};
export const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4' };
// Сколько первых байт нужно, чтобы опознать тип.
export const SNIFF_BYTES = 12;
const MAX_SIDE = 16384;
const MAX_DURATION_MS = 60 * 60 * 1000;

export const isVideoKind = (kind) => kind === 'before' || kind === 'after';
export const limitFor = (kind) => (isVideoKind(kind) ? LIMITS.video : LIMITS.image);

// Тип по первым байтам; имя файла и заявленный Content-Type не учитываются.
export function sniff(bytes) {
  const at = (i) => bytes[i];
  const text = (from, length) => String.fromCharCode(...bytes.subarray(from, from + length));
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png';
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && text(4, 4) === 'ftyp') return 'video/mp4';
  return null;
}

export const slugify = (name) =>
  name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

// Ролики сравнения лежат под фиксированными именами — по ним импорт определяет вид.
export const keyFor = (kind, name, sha256, type) =>
  `${KINDS[kind].prefix}${isVideoKind(kind) ? kind : slugify(name)}.${sha256.slice(0, 12)}.${EXT[type]}`;

const side = (value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_SIDE;

// meta: { kind, sha256, size, width, height, duration_ms } — то, что браузер посчитал сам.
// Размеры и длительность проверить на сервере нечем, поэтому только правдоподобие.
export function uploadErrors(meta) {
  const errors = [];
  const known = Object.hasOwn(KINDS, meta.kind);
  if (!known) errors.push({ field: 'kind', message: `допустимо: ${Object.keys(KINDS).join(', ')}` });
  if (typeof meta.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(meta.sha256)) errors.push({ field: 'sha256', message: 'ожидался sha256 в hex' });
  if (!Number.isSafeInteger(meta.size) || meta.size < 1) errors.push({ field: 'file', message: 'пустой файл или неизвестный размер' });
  if (!side(meta.width)) errors.push({ field: 'width', message: `ожидалась ширина 1…${MAX_SIDE}` });
  if (!side(meta.height)) errors.push({ field: 'height', message: `ожидалась высота 1…${MAX_SIDE}` });
  if (known && isVideoKind(meta.kind)) {
    if (!Number.isSafeInteger(meta.duration_ms) || meta.duration_ms < 1 || meta.duration_ms > MAX_DURATION_MS) errors.push({ field: 'duration_ms', message: 'ожидалась длительность до часа' });
  } else if (known && meta.duration_ms !== null) errors.push({ field: 'duration_ms', message: 'у изображения длительности нет' });
  return errors;
}

export const typeError = (kind, type) =>
  (type && KINDS[kind].types.includes(type) ? null
    : { field: 'file', message: `для ${kind} допустимо: ${KINDS[kind].types.join(', ')} (тип по сигнатуре: ${type ?? 'не опознан'})` });
