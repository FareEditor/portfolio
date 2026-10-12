// Проверка токена Cloudflare Access (заголовок Cf-Access-Jwt-Assertion). Только Web Crypto.
// Любой отказ — AuthError с причиной для журнала; наружу причина не уходит.

export const JWKS_URL = 'https://fareeditor.cloudflareaccess.com/cdn-cgi/access/certs';
// Допуск расхождения часов для exp / nbf / iat.
const CLOCK_SKEW_S = 60;
const JWKS_TTL_S = 3600;
// Принудительная перезагрузка JWKS (неизвестный kid) — не чаще раза в это время на изолят.
const FORCED_RELOAD_MIN_MS = 30_000;

export class AuthError extends Error {}

const fail = (reason) => { throw new AuthError(reason); };

function b64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) fail('не base64url');
  const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function json(bytes, what) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* ниже */ }
  return fail(`${what}: не JSON-объект`);
}

// JWKS: память изолята → Cache API → сеть. force — мимо обоих кэшей.
export function jwksLoader(url, { fetch: fetchImpl = fetch, cache = null, now = Date.now } = {}) {
  let memory = null;
  let lastForced = -Infinity;
  const key = new Request(url);
  return async function load(force = false) {
    if (force) {
      if (now() - lastForced < FORCED_RELOAD_MIN_MS) return memory?.jwks ?? { keys: [] };
      lastForced = now();
    } else {
      if (memory && now() - memory.at < JWKS_TTL_S * 1000) return memory.jwks;
      const hit = cache && await cache.match(key);
      if (hit) {
        memory = { jwks: await hit.json(), at: now() };
        return memory.jwks;
      }
    }
    const response = await fetchImpl(url);
    if (!response.ok) fail(`JWKS: HTTP ${response.status}`);
    const jwks = await response.json();
    if (!jwks || !Array.isArray(jwks.keys)) fail('JWKS: нет keys');
    memory = { jwks, at: now() };
    if (cache) {
      await cache.put(key, new Response(JSON.stringify(jwks), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${JWKS_TTL_S}` },
      }));
    }
    return jwks;
  };
}

// cfg: { aud, issuer, email }; loadJwks(force) → { keys }. Возвращает { email }.
export async function verifyAccess(token, cfg, loadJwks, nowMs = Date.now()) {
  if (typeof token !== 'string' || token === '') fail('нет заголовка Cf-Access-Jwt-Assertion');
  const parts = token.split('.');
  if (parts.length !== 3) fail('токен не из трёх частей');
  const header = json(b64url(parts[0]), 'header');
  // Ровно RS256: alg берётся из токена, поэтому none и HS* отсекаются до выбора ключа.
  if (header.alg !== 'RS256') fail(`alg ${JSON.stringify(header.alg)}`);
  if (typeof header.kid !== 'string' || header.kid === '') fail('нет kid');

  const find = (jwks) => jwks.keys.find((k) => k && k.kid === header.kid);
  const jwk = find(await loadJwks(false)) ?? find(await loadJwks(true));
  if (!jwk) fail('неизвестный kid');
  if (jwk.kty !== 'RSA') fail(`kty ${JSON.stringify(jwk.kty)}`);

  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed)) fail('подпись не сошлась');

  const claims = json(b64url(parts[1]), 'payload');
  const now = Math.floor(nowMs / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.aud)) fail('чужой aud');
  if (claims.iss !== cfg.issuer) fail('чужой iss');
  if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_S <= now) fail('exp в прошлом или отсутствует');
  for (const name of ['nbf', 'iat']) {
    if (claims[name] !== undefined && !(Number.isFinite(claims[name]) && claims[name] - CLOCK_SKEW_S <= now)) fail(`${name} в будущем`);
  }
  if (typeof claims.email !== 'string' || claims.email.toLowerCase() !== cfg.email) fail('чужой email');
  return { email: cfg.email };
}
