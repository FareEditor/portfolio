// Авторизация: каждый отказной случай — 403 {"error":"forbidden"}, валидный токен — 200.
// Идёт production-путь кода: JWKS берётся по фиксированному URL через подменённый fetch.
import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { CFG, ORIGIN, claims, installRuntime, makeKey, sign } from './helpers.mjs';

globalThis.__TEST_AUTH__ = false;
installRuntime();
const { handle } = await import('../src/index.js');
const { JWKS_URL, jwksLoader, verifyAccess } = await import('../src/auth.js');

let key;
let other;
let jwksFetches = 0;
// D1 и R2 при отказе трогать нельзя: любое обращение к биндингу роняет тест.
const untouchable = new Proxy({}, { get() { throw new Error('обращение к биндингу до авторизации'); } });
const env = { ...CFG, DB: untouchable, MEDIA: untouchable, TEST_JWKS_B64: 'не должно читаться' };

before(async () => {
  key = await makeKey('key-1');
  other = await makeKey('key-unknown');
  globalThis.fetch = async (url) => {
    assert.equal(String(url), JWKS_URL);
    jwksFetches += 1;
    return Response.json(key.jwks);
  };
});
beforeEach(() => { jwksFetches = 0; });

const call = (headers = {}, { method = 'GET', path = '/api/me', body } = {}) =>
  handle(new Request(ORIGIN + path, { method, headers, body }), env);
const bearer = async (payload, options, signer = key) => ({ 'Cf-Access-Jwt-Assertion': await sign(signer, payload, options) });

async function forbidden(response) {
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
}

test('валидный токен → 200 и email', async () => {
  const response = await call(await bearer());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: CFG.ALLOWED_EMAIL });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('email в другом регистре допускается', async () => {
  const response = await call(await bearer(claims({ email: 'MouseClk7731@Gmail.com' })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: CFG.ALLOWED_EMAIL });
});

test('aud строкой, а не списком', async () => assert.equal((await call(await bearer(claims({ aud: CFG.ACCESS_AUD })))).status, 200));

const now = () => Math.floor(Date.now() / 1000);
const denied = {
  'истёкший токен': () => bearer(claims({ exp: now() - 120 })),
  'exp отсутствует': () => bearer(claims({ exp: undefined })),
  'nbf в будущем': () => bearer(claims({ nbf: now() + 600 })),
  'iat в будущем': () => bearer(claims({ iat: now() + 600 })),
  'чужой aud': () => bearer(claims({ aud: ['0'.repeat(64)] })),
  'aud отсутствует': () => bearer(claims({ aud: undefined })),
  'чужой iss': () => bearer(claims({ iss: 'https://evil.cloudflareaccess.com' })),
  'чужой email': () => bearer(claims({ email: 'someone@example.com' })),
  'email отсутствует': () => bearer(claims({ email: undefined })),
  'alg: none': () => bearer(claims(), { alg: 'none' }),
  'alg: HS256 с открытым ключом как секретом': () => bearer(claims(), { alg: 'HS256' }),
  'неизвестный kid': () => bearer(claims(), {}, other),
  'подпись чужим ключом под известным kid': () => bearer(claims(), { kid: 'key-1' }, other),
  'отсутствие заголовка': async () => ({}),
  'пустой заголовок': async () => ({ 'Cf-Access-Jwt-Assertion': '' }),
  'мусор вместо токена': async () => ({ 'Cf-Access-Jwt-Assertion': 'a.b' }),
  'токен в cookie без заголовка': async () => ({ Cookie: `CF_Authorization=${await sign(key)}` }),
  'токен в Authorization без заголовка Access': async () => ({ Authorization: `Bearer ${await sign(key)}` }),
};
for (const [name, headers] of Object.entries(denied)) test(`${name} → 403`, async () => forbidden(await call(await headers())));

test('испорченная подпись → 403', async () => {
  const token = await sign(key);
  const [h, p, s] = token.split('.');
  const flipped = s.slice(0, 10) + (s[10] === 'A' ? 'B' : 'A') + s.slice(11);
  await forbidden(await call({ 'Cf-Access-Jwt-Assertion': `${h}.${p}.${flipped}` }));
});

test('изменённый payload под старой подписью → 403', async () => {
  const [h, , s] = (await sign(key, claims({ email: 'someone@example.com' }))).split('.');
  const forged = Buffer.from(JSON.stringify(claims())).toString('base64url');
  await forbidden(await call({ 'Cf-Access-Jwt-Assertion': `${h}.${forged}.${s}` }));
});

test('допуск часов: exp 30 с назад проходит, 90 с назад — нет', async () => {
  assert.equal((await call(await bearer(claims({ exp: now() - 30 })))).status, 200);
  await forbidden(await call(await bearer(claims({ exp: now() - 90 }))));
  assert.equal((await call(await bearer(claims({ nbf: now() + 30 })))).status, 200);
});

test('мутирующий запрос без Origin и с чужим Origin → 403', async () => {
  const auth = await bearer();
  const json = { 'Content-Type': 'application/json' };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await forbidden(await call({ ...auth, ...json }, { method, path: '/api/categories/x', body: method === 'DELETE' ? undefined : '{}' }));
    await forbidden(await call({ ...auth, ...json, Origin: 'https://evil.example' }, { method, path: '/api/categories/x', body: method === 'DELETE' ? undefined : '{}' }));
    await forbidden(await call({ ...auth, ...json, Origin: 'https://admin.fareeditor.com.evil.example' }, { method, path: '/api/categories/x', body: method === 'DELETE' ? undefined : '{}' }));
  }
});

test('верный Origin без токена → 403', async () =>
  forbidden(await call({ Origin: ORIGIN, 'Content-Type': 'application/json' }, { method: 'POST', path: '/api/categories', body: '{}' })));

test('JWKS кэшируется; неизвестный kid даёт ровно одну принудительную перезагрузку', async () => {
  let fetches = 0;
  let clock = 1_000_000;
  const cache = new Map();
  const load = jwksLoader(JWKS_URL, {
    fetch: async () => { fetches += 1; return Response.json(key.jwks); },
    cache: { match: async (r) => cache.get(r.url)?.clone(), put: async (r, res) => { cache.set(r.url, res); } },
    now: () => clock,
  });
  const cfg = { aud: CFG.ACCESS_AUD, issuer: CFG.ACCESS_ISSUER, email: CFG.ALLOWED_EMAIL };
  await verifyAccess(await sign(key), cfg, load);
  await verifyAccess(await sign(key), cfg, load);
  assert.equal(fetches, 1, 'второй запрос взял JWKS из памяти');
  assert.equal(cache.size, 1, 'JWKS положен в Cache API');
  await assert.rejects(verifyAccess(await sign(other), cfg, load), /неизвестный kid/);
  assert.equal(fetches, 2, 'одна принудительная перезагрузка');
  await assert.rejects(verifyAccess(await sign(other), cfg, load), /неизвестный kid/);
  assert.equal(fetches, 2, 'повторный неизвестный kid сразу следом сеть не дёргает');
  clock += 2 * 3600 * 1000;
  cache.clear();
  await verifyAccess(await sign(key), cfg, load);
  assert.equal(fetches, 3, 'по истечении TTL JWKS запрошен заново');
});

test('недоступный JWKS → 403, а не 500', async () => {
  const response = await handle(new Request(`${ORIGIN}/api/me`, { headers: await bearer() }), env,
    { loadJwks: async () => { throw new Error('сеть'); } });
  await forbidden(response);
});

test('production-путь не читает TEST_JWKS_B64 и ходит за JWKS по фиксированному URL', async () => {
  // caches.default и память изолята уже прогреты предыдущими тестами этого файла.
  assert.equal((await call(await bearer())).status, 200);
  assert.equal(jwksFetches, 0);
  assert.equal([...globalThis.caches.default.store.keys()].join(), JWKS_URL);
});

test('вне /api/ Worker отвечает 404 без проверки токена и без данных', async () => {
  const response = await handle(new Request(`${ORIGIN}/nope`), env);
  assert.equal(response.status, 404);
});
