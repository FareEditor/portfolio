// Admin API: запись контента в D1 и медиа в R2. Хост целиком закрыт Cloudflare Access;
// каждый запрос к /api/* дополнительно проверяется здесь — до любого обращения к D1 и R2.
import { AuthError, JWKS_URL, jwksLoader, verifyAccess } from './auth.js';
import { HttpError } from './http.js';

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const MAX_JSON_BYTES = 256 * 1024;

const json = (status, body, extra) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});

let loadProductionJwks;

// __TEST_AUTH__ подставляет сборщик (define в wrangler.jsonc): false в production — ветка с
// подставным JWKS вырезается целиком, TEST_JWKS_B64 в production-сборке не читается вовсе.
function jwks(env) {
  if (__TEST_AUTH__) return async () => JSON.parse(atob(env.TEST_JWKS_B64));
  loadProductionJwks ??= jwksLoader(JWKS_URL, { cache: caches.default });
  return loadProductionJwks;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'too_large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'bad_json'); }
}

const isType = (request, expected) => (request.headers.get('Content-Type') ?? '').toLowerCase().split(';')[0].trim() === expected;

async function route(request, env, url, user, deps) {
  const { method } = request;
  let segments;
  try { segments = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent); } catch { throw new HttpError(404, 'not_found'); }
  const [resource, key, action, ...rest] = segments;
  if (rest.length) throw new HttpError(404, 'not_found');
  const methods = (allowed) => { if (!allowed.includes(method)) throw new HttpError(405, 'method_not_allowed', { allow: allowed }); };
  const body = async () => {
    if (!isType(request, 'application/json')) throw new HttpError(415, 'unsupported_media_type');
    return readJson(request);
  };

  if (resource === 'me' && key === undefined) { methods(['GET']); return json(200, user); }

  throw new HttpError(404, 'not_found');
}

// deps — подмена сети и JWKS в юнит-тестах; в Worker'е не передаётся.
export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
  let user;
  try {
    // Токен — только из заголовка, который проставляет Access; cookie не читается.
    user = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'),
      { aud: env.ACCESS_AUD, issuer: env.ACCESS_ISSUER, email: env.ALLOWED_EMAIL }, deps.loadJwks ?? jwks(env), deps.now?.());
    if (MUTATING.includes(request.method) && request.headers.get('Origin') !== env.ADMIN_ORIGIN) throw new AuthError('чужой или пустой Origin');
  } catch (error) {
    // Отказ закрытый: любая ошибка проверки, в том числе непредвиденная, — 403 без деталей.
    const reason = error instanceof AuthError ? error.message : `сбой проверки: ${String(error?.message ?? error)}`;
    console.warn(JSON.stringify({ event: 'forbidden', reason, method: request.method, path: url.pathname }));
    return json(403, { error: 'forbidden' });
  }
  try {
    return await route(request, env, url, user, deps);
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, error.body, error.body.allow ? { Allow: error.body.allow.join(', ') } : undefined);
    console.error(JSON.stringify({ event: 'error', method: request.method, path: url.pathname, message: String(error?.message ?? error) }));
    return json(500, { error: 'internal' });
  }
}

export default { fetch: (request, env) => handle(request, env) };
