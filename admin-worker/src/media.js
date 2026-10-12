// Медиа: определение типа по сигнатуре, размеры из заголовков файла, загрузка в R2.
import { HttpError } from './http.js';

const MB = 1024 * 1024;
export const LIMITS = { image: 5 * MB, video: 60 * MB };
// Запас на границы и поля multipart поверх самого файла.
export const MAX_UPLOAD_BODY = LIMITS.video + MB;
const HEAD_BYTES = 256 * 1024;
const MAX_MOOV = 8 * MB;

const KINDS = {
  work: { prefix: 'works/', types: ['image/webp', 'image/png', 'image/jpeg'] },
  client: { prefix: 'clients/', types: ['image/webp', 'image/png', 'image/jpeg'] },
  before: { prefix: 'before-after/', types: ['video/mp4'] },
  after: { prefix: 'before-after/', types: ['video/mp4'] },
};
const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4' };

const ascii = (view, offset, length) => {
  let text = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
};

// Тип по первым байтам; заголовок Content-Type части не учитывается.
export function sniff(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength >= 12 && ascii(v, 0, 4) === 'RIFF' && ascii(v, 8, 4) === 'WEBP') return 'image/webp';
  if (v.byteLength >= 8 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) return 'image/png';
  if (v.byteLength >= 3 && v.getUint8(0) === 0xff && v.getUint8(1) === 0xd8 && v.getUint8(2) === 0xff) return 'image/jpeg';
  if (v.byteLength >= 12 && ascii(v, 4, 4) === 'ftyp') return 'video/mp4';
  return null;
}

// Ширина и высота изображения из начала файла; null, если заголовок не разобран.
export function imageSize(type, bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'image/png') {
      if (ascii(v, 12, 4) !== 'IHDR') return null;
      return { width: v.getUint32(16), height: v.getUint32(20) };
    }
    if (type === 'image/webp') {
      const chunk = ascii(v, 12, 4);
      if (chunk === 'VP8X') return { width: 1 + (v.getUint8(24) | v.getUint8(25) << 8 | v.getUint8(26) << 16), height: 1 + (v.getUint8(27) | v.getUint8(28) << 8 | v.getUint8(29) << 16) };
      if (chunk === 'VP8L') {
        if (v.getUint8(20) !== 0x2f) return null;
        const bits = v.getUint32(21, true);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      if (chunk === 'VP8 ') {
        if (v.getUint8(23) !== 0x9d || v.getUint8(24) !== 0x01 || v.getUint8(25) !== 0x2a) return null;
        return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
      }
      return null;
    }
    if (type === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < v.byteLength) {
        if (v.getUint8(offset) !== 0xff) return null;
        const marker = v.getUint8(offset + 1);
        if (marker === 0xff) { offset += 1; continue; }
        // SOF0..SOF15, кроме DHT (C4), JPG (C8) и DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: v.getUint16(offset + 7), height: v.getUint16(offset + 5) };
        }
        offset += 2 + v.getUint16(offset + 2);
      }
    }
  } catch { /* заголовок короче ожидаемого */ }
  return null;
}

// Дочерние атомы в диапазоне [start, end): [{ type, start (тело), end }].
function boxes(view, start, end) {
  const found = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) break;
    found.push({ type: ascii(view, offset + 4, 4), start: offset + header, end: offset + size });
    offset += size;
  }
  return found;
}

// Ширина, высота и длительность из moov (mvhd и первый tkhd с ненулевым кадром).
export function moovInfo(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const info = { width: null, height: null, duration_ms: null };
  try {
    const top = boxes(v, 0, v.byteLength);
    const mvhd = top.find((b) => b.type === 'mvhd');
    if (mvhd) {
      const v1 = v.getUint8(mvhd.start) === 1;
      const timescale = v.getUint32(mvhd.start + (v1 ? 20 : 12));
      const duration = v1 ? Number(v.getBigUint64(mvhd.start + 24)) : v.getUint32(mvhd.start + 16);
      if (timescale > 0 && duration > 0) info.duration_ms = Math.round(duration / timescale * 1000);
    }
    for (const trak of top.filter((b) => b.type === 'trak')) {
      const tkhd = boxes(v, trak.start, trak.end).find((b) => b.type === 'tkhd');
      if (!tkhd) continue;
      // Размер кадра — два последних поля tkhd, 16.16 fixed point.
      const width = v.getUint32(tkhd.end - 8) >>> 16;
      const height = v.getUint32(tkhd.end - 4) >>> 16;
      if (width > 0 && height > 0) { info.width = width; info.height = height; break; }
    }
  } catch { /* повреждённый moov — размеры остаются NULL */ }
  return info;
}

// Находит moov среди атомов верхнего уровня, читая файл срезами, и разбирает его.
async function mp4Info(file) {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const head = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    let size = head.getUint32(0);
    let header = 8;
    if (size === 1 && head.byteLength >= 16) { size = Number(head.getBigUint64(8)); header = 16; }
    else if (size === 0) size = file.size - offset;
    if (size < header) break;
    if (ascii(head, 4, 4) === 'moov') {
      if (size - header > MAX_MOOV) break;
      return moovInfo(new Uint8Array(await file.slice(offset + header, offset + size).arrayBuffer()));
    }
    offset += size;
  }
  return { width: null, height: null, duration_ms: null };
}

async function sha256Hex(file) {
  const digest = new crypto.DigestStream('SHA-256');
  await file.stream().pipeTo(digest);
  return [...new Uint8Array(await digest.digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const slugify = (name) =>
  name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

const inUse = `EXISTS (SELECT 1 FROM works WHERE thumbnail_media_id = media.id)
  OR EXISTS (SELECT 1 FROM testimonials WHERE logo_media_id = media.id)
  OR EXISTS (SELECT 1 FROM settings WHERE before_media_id = media.id OR after_media_id = media.id)`;
const SELECT = `SELECT id, kind, r2_key AS key, url, sha256, bytes, content_type, width, height, duration_ms, created_at, (${inUse}) AS in_use FROM media`;
const out = (row) => ({ ...row, in_use: row.in_use === 1 });

export const listMedia = async (db) => ({ items: (await db.prepare(`${SELECT} ORDER BY id`).all()).results.map(out) });

export async function upload(env, form) {
  const file = form.get('file');
  const kind = form.get('kind');
  const errors = [];
  if (!Object.hasOwn(KINDS, kind)) errors.push({ field: 'kind', message: `допустимо: ${Object.keys(KINDS).join(', ')}` });
  if (!file || typeof file === 'string' || form.getAll('file').length !== 1) errors.push({ field: 'file', message: 'нужен ровно один файл' });
  if (errors.length) throw new HttpError(422, 'validation', { fields: errors });
  if (file.size === 0) throw new HttpError(422, 'validation', { fields: [{ field: 'file', message: 'пустой файл' }] });

  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const type = sniff(head);
  if (!type || !KINDS[kind].types.includes(type)) {
    throw new HttpError(422, 'validation', { fields: [{ field: 'file', message: `для ${kind} допустимо: ${KINDS[kind].types.join(', ')} (тип по сигнатуре: ${type ?? 'не опознан'})` }] });
  }
  const limit = type === 'video/mp4' ? LIMITS.video : LIMITS.image;
  if (file.size > limit) throw new HttpError(413, 'too_large', { limit });

  const sha256 = await sha256Hex(file);
  // Ролики сравнения лежат под фиксированными именами — по ним импорт определяет вид.
  const name = kind === 'before' || kind === 'after' ? kind : slugify(file.name ?? '');
  const key = `${KINDS[kind].prefix}${name}.${sha256.slice(0, 12)}.${EXT[type]}`;
  const existing = await env.DB.prepare(`${SELECT} WHERE r2_key = ?1`).bind(key).first();
  if (existing) return { created: false, media: out(existing) };

  const size = type === 'video/mp4' ? await mp4Info(file) : { ...(imageSize(type, head) ?? { width: null, height: null }), duration_ms: null };
  // Объект с таким ключом уже лежит (строки в базе нет) — содержимое то же, не перезаписываем.
  if (await env.MEDIA.head(key) === null) {
    await env.MEDIA.put(key, file, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
      sha256,
    });
  }
  await env.DB.prepare('INSERT INTO media (kind, r2_key, url, sha256, bytes, content_type, width, height, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
    .bind(kind, key, env.MEDIA_BASE_URL + key, sha256, file.size, type, size.width || null, size.height || null, size.duration_ms || null).run();
  return { created: true, media: out(await env.DB.prepare(`${SELECT} WHERE r2_key = ?1`).bind(key).first()) };
}

// Сначала строка: внешние ключи не дадут удалить медиа, на которое есть ссылка.
export async function removeMedia(env, id) {
  if (!/^[1-9][0-9]*$/.test(id)) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`${SELECT} WHERE id = ?1`).bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'not_found');
  if (row.in_use === 1) throw new HttpError(409, 'in_use');
  try {
    await env.DB.prepare('DELETE FROM media WHERE id = ?1').bind(row.id).run();
  } catch (error) {
    if (/constraint/i.test(String(error?.message ?? error))) throw new HttpError(409, 'in_use');
    throw error;
  }
  await env.MEDIA.delete(row.key);
}
