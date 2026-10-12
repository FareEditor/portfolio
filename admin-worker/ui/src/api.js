// Запросы к admin API. Все — same-origin: заголовок Access и Origin проставляют Access и браузер.
import { limitFor, sniff, typeError, uploadErrors, SNIFF_BYTES, isVideoKind } from '../../src/media-rules.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body ?? {};
  }
}

async function request(method, path, { json, body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: json === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: json === undefined ? body : JSON.stringify(json),
    });
  } catch {
    // Сюда же попадает истёкшая сессия Access: редирект на вход браузер fetch'у не отдаёт.
    throw new ApiError(0, { error: 'network' });
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* не JSON — ниже */ }
  if (!response.ok || (text && data === null)) throw new ApiError(response.ok ? 0 : response.status, data ?? { error: 'network' });
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, json = {}) => request('POST', path, { json }),
  put: (path, json) => request('PUT', path, { json }),
  del: (path) => request('DELETE', path),
};

export function describeError(error) {
  if (!(error instanceof ApiError)) return 'Непредвиденная ошибка интерфейса.';
  switch (error.message) {
    case 'network': return 'Нет связи с сервером или сессия истекла. Обновите страницу и повторите.';
    case 'forbidden': return 'Нет доступа. Обновите страницу и войдите заново.';
    case 'not_found': return 'Запись не найдена — возможно, её удалили.';
    case 'in_use': return 'Нельзя удалить: на запись есть ссылки.';
    case 'exists': return 'Запись с таким slug уже есть.';
    case 'conflict': return 'Запись изменилась на сервере или нарушает связи с другими записями.';
    case 'too_large': return 'Файл больше допустимого размера.';
    case 'validation': return 'Сервер отклонил данные: проверьте поля.';
    default: return `Ошибка сервера (${error.status || 'нет ответа'}).`;
  }
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

function imageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight, duration_ms: null }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Браузер не смог открыть изображение.')); };
    img.src = url;
  });
}

function videoSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const meta = { width: video.videoWidth, height: video.videoHeight, duration_ms: Math.round(video.duration * 1000) };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Браузер не смог открыть ролик.')); };
    video.src = url;
  });
}

// Загрузка файла: тип, размеры и sha256 считаются здесь, в браузере; сервер и R2 их проверяют.
// onStage — подпись текущего шага. Возвращает { created, media }.
export async function uploadMedia(file, kind, onStage = () => {}) {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const wrong = typeError(kind, sniff(head));
  if (wrong) throw new ApiError(422, { error: 'validation', fields: [wrong] });
  if (file.size > limitFor(kind)) throw new ApiError(413, { error: 'too_large', limit: limitFor(kind) });
  onStage('Читаю размеры…');
  let size;
  try { size = await (isVideoKind(kind) ? videoSize(file) : imageSize(file)); } catch (error) {
    throw new ApiError(422, { error: 'validation', fields: [{ field: 'file', message: error.message }] });
  }
  onStage('Считаю sha256…');
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const meta = { kind, sha256, size: file.size, ...size };
  const errors = uploadErrors(meta);
  if (errors.length) throw new ApiError(422, { error: 'validation', fields: errors });
  onStage('Загружаю…');
  const query = new URLSearchParams({ kind, name: file.name, sha256, width: size.width, height: size.height });
  if (size.duration_ms !== null) query.set('duration_ms', size.duration_ms);
  const before = await api.get('/api/media');
  const media = await request('POST', `/api/media?${query}`, { body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  return { created: !before.items.some((m) => m.id === media.id), media };
}
