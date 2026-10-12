// Общее для тестов: ключи и токены, подставные D1 / R2 / Cache API для Node.
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = resolve(ROOT, '..');
export const ORIGIN = 'https://admin.fareeditor.com';
export const CFG = {
  ACCESS_ISSUER: 'https://fareeditor.cloudflareaccess.com',
  ACCESS_AUD: '51c976afc450d6211c9d16b0ac665217e0f25233e2e064410c4fc4e810acd1f7',
  ALLOWED_EMAIL: 'mouseclk7731@gmail.com',
  ADMIN_ORIGIN: ORIGIN,
  MEDIA_BASE_URL: 'https://media.fareeditor.com/',
  GITLAB_PROJECT_ID: '85233384',
  GITLAB_REF: 'main',
};

const b64url = (data) => Buffer.from(data).toString('base64url');

// Собственная пара RSA и JWKS с её открытым ключом.
export async function makeKey(kid = 'test-key-1') {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  return { kid, privateKey: pair.privateKey, spki, jwks: { keys: [{ kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] } };
}

export const claims = (over = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [CFG.ACCESS_AUD], iss: CFG.ACCESS_ISSUER, email: CFG.ALLOWED_EMAIL, iat: now - 5, nbf: now - 5, exp: now + 3600, sub: 'test', ...over };
};

// alg: RS256 — настоящая подпись; HS256 — HMAC с открытым ключом как секретом; none — без подписи.
export async function sign(key, payload = claims(), { alg = 'RS256', kid = key.kid } = {}) {
  const head = `${b64url(JSON.stringify({ alg, kid, typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  if (alg === 'none') return `${head}.`;
  if (alg === 'HS256') return `${head}.${createHmac('sha256', key.spki).update(head).digest('base64url')}`;
  return `${head}.${b64url(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, Buffer.from(head)))}`;
}

// D1 поверх node:sqlite: prepare/bind/first/all/run и batch одной транзакцией.
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    exec() {
      const prepared = db.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: prepared.all(...args).map((row) => ({ ...row })), meta: { changes: 0 } };
      const info = prepared.run(...args);
      return { results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
    async all() { return this.exec(); },
    async run() { return this.exec(); },
    async first() { return this.exec().results[0] ?? null; },
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s.exec());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async head(key) { return objects.has(key) ? { key } : null; },
    async put(key, value, options) { objects.set(key, { bytes: Buffer.from(await new Response(value).arrayBuffer()), options }); },
    async delete(key) { objects.delete(key); },
  };
}

// crypto.DigestStream и caches.default есть в Workers и отсутствуют в Node.
export function installRuntime() {
  if (!webcrypto.DigestStream) {
    webcrypto.DigestStream = class extends WritableStream {
      constructor() {
        const hash = createHash('sha256');
        let done;
        super({ write(chunk) { hash.update(chunk); }, close() { done(hash.digest().buffer); } });
        this.digest = new Promise((r) => { done = r; });
      }
    };
  }
  const store = new Map();
  globalThis.caches = { default: { store, async match(req) { return store.get(req.url)?.clone(); }, async put(req, res) { store.set(req.url, res); } } };
}

const MANIFEST = process.env.MANIFEST ?? join(homedir(), 'Documents/git/portfolio-audit/r2-manifest.json');

// SQL: миграции и те же данные, что import.mjs кладёт в production.
export async function seedSql() {
  const { build, toSql, DEFAULT_DATA_DIR } = await import('../../content-worker/scripts/import.mjs');
  const migrations = ['0001_init.sql', '0002_publishes.sql'].map((f) => readFileSync(join(REPO, 'content-worker/migrations', f), 'utf8'));
  return { migrations, data: toSql(build(DEFAULT_DATA_DIR, MANIFEST)) };
}

export async function localEnv(key) {
  const { migrations, data } = await seedSql();
  const DB = fakeD1();
  for (const sql of [...migrations, data]) DB.raw.exec(sql);
  return { ...CFG, DB, MEDIA: fakeR2(), TEST_JWKS_B64: Buffer.from(JSON.stringify(key.jwks)).toString('base64') };
}
