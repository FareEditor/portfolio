// Медиа: потоковая загрузка в R2 без буферизации файла и без хеширования в Worker'е.
// sha256, размеры и длительность считает браузер; Worker проверяет сигнатуру по первым
// байтам, а целостность — R2: put с ожидаемым sha256 отклоняет тело с другим хешем.
import { HttpError } from './http.js';
import { SNIFF_BYTES, isVideoKind, keyFor, limitFor, sniff, typeError, uploadErrors } from './media-rules.js';

const invalid = (fields) => new HttpError(422, 'validation', { fields });

const SELECT = 'SELECT id, kind, r2_key AS key, url, sha256, bytes, content_type, width, height, duration_ms, created_at FROM media';

// used_by — записи, которые ссылаются на медиа: [{ resource, key }].
export async function listMedia(db, where = '', ...args) {
  const [media, works, testimonials, settings] = await db.batch([
    db.prepare(`${SELECT} ${where} ORDER BY id`).bind(...args),
    db.prepare('SELECT slug, thumbnail_media_id AS id FROM works'),
    db.prepare('SELECT slug, logo_media_id AS id FROM testimonials WHERE logo_media_id IS NOT NULL'),
    db.prepare('SELECT before_media_id, after_media_id FROM settings'),
  ]);
  const uses = [
    ...works.results.map((r) => ({ id: r.id, resource: 'works', key: r.slug })),
    ...testimonials.results.map((r) => ({ id: r.id, resource: 'testimonials', key: r.slug })),
    ...settings.results.flatMap((r) => [r.before_media_id, r.after_media_id]).filter((id) => id !== null).map((id) => ({ id, resource: 'settings', key: '1' })),
  ];
  return { items: media.results.map((m) => {
    const used_by = uses.filter((u) => u.id === m.id).map(({ resource, key }) => ({ resource, key }));
    return { ...m, in_use: used_by.length > 0, used_by };
  }) };
}

const byKey = async (db, key) => (await listMedia(db, 'WHERE r2_key = ?1', key)).items[0];

const integer = (source, name) => (/^[0-9]+$/.test(source.get(name) ?? '') ? Number(source.get(name)) : null);

// POST /api/media?kind=&name=&sha256=&width=&height=[&duration_ms=], тело — сам файл.
export async function upload(env, request, params) {
  const kind = params.get('kind');
  const meta = {
    kind, sha256: params.get('sha256'), size: integer(request.headers, 'Content-Length'),
    width: integer(params, 'width'), height: integer(params, 'height'), duration_ms: integer(params, 'duration_ms'),
  };
  if (meta.size === null) throw new HttpError(411, 'length_required');
  const errors = uploadErrors(meta);
  if (errors.length) throw invalid(errors);
  if (meta.size > limitFor(kind)) throw new HttpError(413, 'too_large', { limit: limitFor(kind) });
  if (!request.body) throw invalid([{ field: 'file', message: 'пустой файл' }]);

  // Первые байты — для сигнатуры; дальше тело идёт в R2 как есть.
  const reader = request.body.getReader();
  const head = [];
  let got = 0;
  while (got < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    head.push(value);
    got += value.byteLength;
  }
  const first = new Uint8Array(Math.min(got, 64));
  for (let offset = 0, i = 0; i < head.length && offset < first.length; offset += head[i].byteLength, i += 1) {
    first.set(head[i].subarray(0, first.length - offset), offset);
  }
  const type = sniff(first);
  const wrong = typeError(kind, type);
  if (wrong) { await reader.cancel(); throw invalid([wrong]); }

  const key = keyFor(kind, params.get('name') ?? '', meta.sha256, type);
  const existing = await byKey(env.DB, key);
  if (existing) { await reader.cancel(); return { created: false, media: existing }; }

  // R2 требует поток известной длины; расхождение с Content-Length обрывает загрузку.
  const { readable, writable } = new FixedLengthStream(meta.size);
  const pump = (async () => {
    const writer = writable.getWriter();
    for (const chunk of head) await writer.write(chunk);
    writer.releaseLock();
    reader.releaseLock();
    await request.body.pipeTo(writable);
  })();
  try {
    await Promise.all([
      env.MEDIA.put(key, readable, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
        sha256: meta.sha256,
      }),
      pump,
    ]);
  } catch (error) {
    pump.catch(() => {});
    // Хеш не сошёлся или тело оборвалось: объект не сохранён, строки в базе нет.
    console.warn(JSON.stringify({ event: 'upload_rejected', key, message: String(error?.message ?? error) }));
    throw invalid([{ field: 'sha256', message: 'файл не совпал с переданным sha256 или размером' }]);
  }
  await env.DB.prepare('INSERT INTO media (kind, r2_key, url, sha256, bytes, content_type, width, height, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
    .bind(kind, key, env.MEDIA_BASE_URL + key, meta.sha256, meta.size, type, meta.width, meta.height, isVideoKind(kind) ? meta.duration_ms : null).run();
  return { created: true, media: await byKey(env.DB, key) };
}

// Сначала строка: внешние ключи не дадут удалить медиа, на которое есть ссылка.
export async function removeMedia(env, id) {
  if (!/^[1-9][0-9]*$/.test(id)) throw new HttpError(404, 'not_found');
  const row = (await listMedia(env.DB, 'WHERE id = ?1', Number(id))).items[0];
  if (!row) throw new HttpError(404, 'not_found');
  if (row.in_use) throw new HttpError(409, 'in_use');
  try {
    await env.DB.prepare('DELETE FROM media WHERE id = ?1').bind(row.id).run();
  } catch (error) {
    if (/constraint/i.test(String(error?.message ?? error))) throw new HttpError(409, 'in_use');
    throw error;
  }
  await env.MEDIA.delete(row.key);
}
