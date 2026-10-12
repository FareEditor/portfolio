// API записи. Один набор, две цели:
//   node --test test/api.test.mjs                 — в процессе, D1 поверх node:sqlite;
//   ADMIN_REMOTE=1 node --test test/api.test.mjs  — wrangler dev --remote --env test
//                                                    (временные D1 и R2 в Cloudflare).
// Тесты идут по порядку и опираются на состояние, оставленное предыдущими.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { CFG, ORIGIN, REPO, ROOT, installRuntime, localEnv, makeKey, sign } from './helpers.mjs';

const REMOTE = process.env.ADMIN_REMOTE === '1';
const PORT = 8798;
const MB = 1024 * 1024;

let key;
let token;
let call;
let dev;
let localDb;
const gitlab = { calls: [], reply: () => Response.json({ id: 4242, web_url: 'https://gitlab.com/x/-/pipelines/4242', status: 'created', token: 'leak?' }) };

before(async () => {
  key = await makeKey();
  token = await sign(key);
  if (REMOTE) {
    const jwks = Buffer.from(JSON.stringify(key.jwks)).toString('base64');
    dev = spawn('npx', ['wrangler', 'dev', '--remote', '--env', 'test', '--port', String(PORT), '--var', `TEST_JWKS_B64:${jwks}`],
      { cwd: ROOT, stdio: 'ignore' });
    const base = `http://127.0.0.1:${PORT}`;
    call = (path, init) => fetch(base + path, init);
    for (let i = 0; i < 120; i += 1) {
      const ok = await fetch(`${base}/api/me`).then((r) => r.status === 403, () => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('wrangler dev не поднялся за 120 с');
  }
  globalThis.__TEST_AUTH__ = true;
  installRuntime();
  const { handle } = await import('../src/index.js');
  const env = await localEnv(key);
  localDb = env.DB;
  env.GITLAB_TRIGGER_TOKEN = 'glptt-secret-value';
  const deps = { fetch: async (url, init) => { gitlab.calls.push({ url: String(url), init }); return gitlab.reply(); } };
  call = (path, init) => handle(new Request(ORIGIN + path, init), env, deps);
}, { timeout: 180_000 });

after(() => { if (dev) dev.kill('SIGINT'); });

const api = async (method, path, body) => {
  const headers = { 'Cf-Access-Jwt-Assertion': token };
  if (method !== 'GET') headers.Origin = ORIGIN;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await call(path, { method, headers, body: body === undefined || body instanceof FormData ? body : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const fields = (r) => r.body.fields.map((f) => f.field).sort();
const revs = async (resource, k) => (await api('GET', `/api/revisions?resource=${resource}&key=${encodeURIComponent(k)}`)).body.items;

test('GET /api/me и отказ без токена', async () => {
  assert.deepEqual((await api('GET', '/api/me')).body, { email: CFG.ALLOWED_EMAIL });
  assert.equal((await call('/api/categories', {})).status, 403);
});

test('categories: CRUD, валидация, ревизии, restore', async () => {
  const list = await api('GET', '/api/categories');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 2);
  const record = { slug: 'shorts', published: true, order: 30, title_ru: 'Шортсы', title_en: 'Shorts', blurb_ru: '', blurb_en: 'Vertical', aspect: '9:12' };
  const created = await api('POST', '/api/categories', record);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, record);
  assert.equal((await api('POST', '/api/categories', record)).status, 409);
  assert.deepEqual((await api('GET', '/api/categories/shorts')).body, record);

  const updated = await api('PUT', '/api/categories/shorts', { ...record, title_en: 'Shorts!', order: 31 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.title_en, 'Shorts!');

  // валидация
  assert.deepEqual(fields(await api('POST', '/api/categories', { ...record, slug: 'Bad Slug', aspect: '3:2', order: 1.5 })), ['aspect', 'order', 'slug']);
  assert.deepEqual(fields(await api('PUT', '/api/categories/shorts', { ...record, title_ru: '   ', extra: 1 })), ['extra', 'title_ru']);
  assert.deepEqual(fields(await api('PUT', '/api/categories/shorts', { ...record, slug: 'renamed' })), ['slug']);
  const noTitle = { ...record }; delete noTitle.title_en;
  assert.deepEqual(fields(await api('PUT', '/api/categories/shorts', { ...noTitle, published: 'yes' })), ['published', 'title_en']);
  assert.equal((await api('PUT', '/api/categories/nope', { ...record, slug: 'nope' })).status, 404);

  // ревизии: создание — снимок null, правка — предыдущая версия
  let history = await revs('categories', 'shorts');
  assert.equal(history.length, 2);
  assert.equal(history[1].snapshot, null);
  assert.equal(history[0].snapshot.title_en, 'Shorts');
  assert.equal(history[0].snapshot.sort_order, 30);

  // restore возвращает предыдущую версию и сам создаёт ревизию
  const restored = await api('POST', `/api/revisions/${history[0].id}/restore`, {});
  assert.equal(restored.status, 200);
  assert.deepEqual((await api('GET', '/api/categories/shorts')).body, record);
  history = await revs('categories', 'shorts');
  assert.equal(history.length, 3);
  assert.equal(history[0].snapshot.title_en, 'Shorts!');

  // удаление и восстановление удалённой записи
  assert.equal((await api('DELETE', '/api/categories/shorts')).status, 200);
  assert.equal((await api('GET', '/api/categories/shorts')).status, 404);
  assert.equal((await api('DELETE', '/api/categories/shorts')).status, 404);
  history = await revs('categories', 'shorts');
  assert.equal((await api('POST', `/api/revisions/${history[0].id}/restore`, {})).status, 200);
  assert.deepEqual((await api('GET', '/api/categories/shorts')).body, record);
  // restore ревизии создания (снимок null) — удаление
  assert.deepEqual((await api('POST', `/api/revisions/${history.at(-1).id}/restore`, {})).body.deleted, true);
  assert.equal((await api('GET', '/api/categories/shorts')).status, 404);
});

test('categories: запрет удаления при наличии работ', async () => {
  const works = (await api('GET', '/api/works')).body.items;
  const busy = works[0].category;
  const response = await api('DELETE', `/api/categories/${busy}`);
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: 'in_use' });
  assert.equal((await api('GET', `/api/categories/${busy}`)).status, 200);
});

test('works: CRUD, валидация, ссылка на медиа нужного вида', async () => {
  const media = (await api('GET', '/api/media')).body.items;
  const thumb = media.find((m) => m.kind === 'work').url;
  const logo = media.find((m) => m.kind === 'client').url;
  const sample = (await api('GET', '/api/works')).body.items[0];
  assert.match(sample.thumbnail, /^https:\/\/media\.fareeditor\.com\/works\//);
  const record = { ...sample, slug: 'test-work', order: 99, title_en: 'Test work', featured: false, thumbnail: thumb };
  const created = await api('POST', '/api/works', record);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, record);
  const updated = await api('PUT', '/api/works/test-work', { ...record, published: false, body_ru: 'Новый текст' });
  assert.equal(updated.body.published, false);
  assert.equal(updated.body.body_ru, 'Новый текст');

  assert.deepEqual(fields(await api('PUT', '/api/works/test-work', { ...record, youtube_id: 'short', category: 'no-such' })), ['category', 'youtube_id']);
  assert.deepEqual(fields(await api('PUT', '/api/works/test-work', { ...record, thumbnail: logo })), ['thumbnail']);
  assert.deepEqual(fields(await api('PUT', '/api/works/test-work', { ...record, thumbnail: 'https://example.com/x.webp', client: '' })), ['client', 'thumbnail']);

  assert.equal((await revs('works', 'test-work')).length, 2);
  assert.equal((await api('DELETE', '/api/works/test-work')).status, 200);
  assert.equal((await api('GET', '/api/works/test-work')).status, 404);
});

test('metric-types: CRUD, валидация, запрет удаления при использовании', async () => {
  const record = { slug: 'ctr', order: 50, label_ru: 'CTR', label_en: 'CTR' };
  assert.equal((await api('POST', '/api/metric-types', record)).status, 201);
  assert.equal((await api('PUT', '/api/metric-types/ctr', { ...record, label_en: 'Click-through' })).body.label_en, 'Click-through');
  assert.deepEqual(fields(await api('POST', '/api/metric-types', { slug: 'ctr_2', order: '1', label_ru: 'x' })), ['label_en', 'order', 'slug']);
  assert.deepEqual(fields(await api('PUT', '/api/metric-types/ctr', { ...record, label_ru: 5 })), ['label_ru']);
  assert.equal((await api('DELETE', '/api/metric-types/ctr')).status, 200);

  const used = (await api('GET', '/api/testimonials')).body.items[0].metric_1_type;
  assert.deepEqual((await api('DELETE', `/api/metric-types/${used}`)).body, { error: 'in_use' });
});

test('testimonials: CRUD с тремя метриками, валидация, restore с метриками', async () => {
  const sample = (await api('GET', '/api/testimonials')).body.items[0];
  const record = { ...sample, slug: 'test-client', order: 77, channel_name: 'Test channel' };
  delete record.logo;
  const created = await api('POST', '/api/testimonials', record);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, record);

  const withLogo = { ...record, logo: sample.logo, metric_2_value_en: '+99%' };
  const updated = await api('PUT', '/api/testimonials/test-client', withLogo);
  assert.deepEqual(updated.body, withLogo);

  // ровно три метрики, типы существуют и не повторяются
  const two = { ...record }; delete two.metric_3_type; delete two.metric_3_value_ru; delete two.metric_3_value_en;
  assert.deepEqual(fields(await api('PUT', '/api/testimonials/test-client', two)), ['metric_3_type', 'metric_3_value_en', 'metric_3_value_ru']);
  assert.deepEqual(fields(await api('PUT', '/api/testimonials/test-client', { ...record, metric_2_type: record.metric_1_type })), ['metric_2_type']);
  assert.deepEqual(fields(await api('PUT', '/api/testimonials/test-client', { ...record, metric_1_type: 'no-such', metric_4_type: 'x' })), ['metric_1_type', 'metric_4_type']);
  const thumb = (await api('GET', '/api/media')).body.items.find((m) => m.kind === 'work').url;
  assert.deepEqual(fields(await api('PUT', '/api/testimonials/test-client', { ...record, logo: thumb, quote_ru: '' })), ['logo', 'quote_ru']);

  // снимок хранит метрики; restore возвращает и их
  const history = await revs('testimonials', 'test-client');
  assert.equal(history.length, 2);
  assert.equal(history[0].snapshot.metrics.length, 3);
  assert.equal((await api('POST', `/api/revisions/${history[0].id}/restore`, {})).status, 200);
  assert.deepEqual((await api('GET', '/api/testimonials/test-client')).body, record);

  assert.equal((await api('DELETE', '/api/testimonials/test-client')).status, 200);
  assert.equal((await api('GET', '/api/testimonials/test-client')).status, 404);
});

for (const name of ['stats', 'contacts']) {
  test(`${name}: list, update по position, без create и delete`, async () => {
    const list = (await api('GET', `/api/${name}`)).body.items;
    assert.equal(list.length, 4);
    const original = (await api('GET', `/api/${name}/2`)).body;
    assert.deepEqual(original, list[1]);
    const changed = { ...original, label_en: 'Changed label' };
    assert.deepEqual((await api('PUT', `/api/${name}/2`, changed)).body, changed);
    assert.deepEqual((await api('GET', `/api/${name}`)).body.items[1], changed);

    assert.deepEqual(fields(await api('PUT', `/api/${name}/2`, { ...original, label_ru: '', position: 3 })), ['label_ru', 'position']);
    if (name === 'contacts') assert.deepEqual(fields(await api('PUT', '/api/contacts/2', { ...original, kind: 'phone' })), ['kind']);
    else assert.deepEqual(fields(await api('PUT', '/api/stats/2', { ...original, value: 12 })), ['value']);
    assert.equal((await api('PUT', `/api/${name}/5`, original)).status, 404);
    assert.equal((await api('PUT', `/api/${name}/0`, original)).status, 404);
    assert.equal((await api('POST', `/api/${name}`, original)).status, 405);
    assert.equal((await api('DELETE', `/api/${name}/2`)).status, 405);

    const history = await revs(name, '2');
    assert.equal(history.length, 1);
    assert.equal((await api('POST', `/api/revisions/${history[0].id}/restore`, {})).status, 200);
    assert.deepEqual((await api('GET', `/api/${name}/2`)).body, original);
    assert.equal((await api('GET', `/api/${name}`)).body.items.length, 4);
  });
}

test('settings: get, update, валидация', async () => {
  const original = (await api('GET', '/api/settings')).body;
  assert.equal(original.before_after_enabled, true);
  assert.match(original.beforeAfter.before.url, /before-after\/before\./);
  const changed = { ...original, status_en: 'Booked until spring', showreel_enabled: true };
  assert.deepEqual((await api('PUT', '/api/settings', changed)).body, changed);

  assert.deepEqual(fields(await api('PUT', '/api/settings', { ...original, showreel_id: 'too-short' })), ['showreel_id']);
  assert.deepEqual(fields(await api('PUT', '/api/settings', { ...original, beforeAfter: null })), ['beforeAfter']);
  const swapped = { before: original.beforeAfter.after, after: original.beforeAfter.before };
  assert.deepEqual(fields(await api('PUT', '/api/settings', { ...original, beforeAfter: swapped, contact_url: '' })), ['beforeAfter.after.url', 'beforeAfter.before.url', 'contact_url']);
  assert.equal((await api('POST', '/api/settings', original)).status, 405);
  assert.equal((await api('DELETE', '/api/settings')).status, 405);

  // выключить сравнение и снять ролики, затем вернуть
  const off = { ...original, before_after_enabled: false, beforeAfter: null };
  assert.deepEqual((await api('PUT', '/api/settings', off)).body, off);
  assert.deepEqual((await api('PUT', '/api/settings', original)).body, original);
  assert.equal((await revs('settings', '1')).length, 3);
});

test('content: get, update по локали, форма документа, ключи опций', async () => {
  const both = (await api('GET', '/api/content')).body;
  assert.deepEqual(Object.keys(both).sort(), ['en', 'ru']);
  const original = (await api('GET', '/api/content/en')).body;
  assert.deepEqual(original, both.en);
  const copy = () => structuredClone(original);

  const changed = copy();
  changed.hero.title = 'New hero title';
  changed.contact.budget[0].label = 'Under $500';
  assert.deepEqual((await api('PUT', '/api/content/en', changed)).body, changed);
  assert.deepEqual((await api('GET', '/api/content/ru')).body, both.ru, 'вторая локаль не затронута');

  const badKey = copy(); badKey.contact.project_type[1].value = 'renamed_key';
  assert.deepEqual(fields(await api('PUT', '/api/content/en', badKey)), ['contact.project_type[1].value']);
  const shortList = copy(); shortList.faq.items.pop(); shortList.nav.push('Extra');
  assert.deepEqual(fields(await api('PUT', '/api/content/en', shortList)), ['faq.items', 'nav']);
  const wrongShape = copy(); delete wrongShape.footer.copy; wrongShape.hero.unknown = 'x'; wrongShape.cta = 5;
  assert.deepEqual(fields(await api('PUT', '/api/content/en', wrongShape)), ['cta', 'footer.copy', 'hero.unknown']);
  const empty = copy(); empty.why.items[2].body = ' ';
  assert.deepEqual(fields(await api('PUT', '/api/content/en', empty)), ['why.items[2].body']);
  assert.equal((await api('PUT', '/api/content/de', original)).status, 404);
  assert.equal((await api('DELETE', '/api/content/en')).status, 405);

  const history = await revs('content', 'en');
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].snapshot.doc, original);
  assert.equal((await api('POST', `/api/revisions/${history[0].id}/restore`, {})).status, 200);
  assert.deepEqual((await api('GET', '/api/content/en')).body, original);
});

const form = (bytes, name, kind, type = 'application/octet-stream') => {
  const data = new FormData();
  data.set('file', new File([bytes], name, { type }));
  if (kind !== undefined) data.set('kind', kind);
  return data;
};
const media = (name) => readFileSync(join(REPO, 'site/public/media', name));
// Минимальные валидные заголовки PNG и JPEG с заданным размером кадра.
const png = (w, h, pad = 0) => {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
  b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w, h) => {
  const b = Buffer.alloc(64);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(b);
  b.write('JFIF', 6);
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, 20);
  b.writeUInt16BE(h, 25); b.writeUInt16BE(w, 27);
  return b;
};

test('media: загрузка каждого типа, размеры, повторная загрузка', async () => {
  const before = (await api('GET', '/api/media')).body.items;
  // тот же файл, что уже лежит в базе под тем же ключом, — возвращается существующая запись
  const same = await api('POST', '/api/media', form(media('works/fl-1.webp'), 'fl-1.webp', 'work'));
  assert.equal(same.status, 200);
  assert.equal(same.body.id, before.find((m) => m.key.startsWith('works/fl-1.')).id);

  const webp = await api('POST', '/api/media', form(media('works/fl-2.webp'), 'New Thumb №1.WEBP', 'work', 'text/plain'));
  assert.equal(webp.status, 201);
  assert.match(webp.body.key, /^works\/new-thumb-1\.[0-9a-f]{12}\.webp$/);
  assert.equal(webp.body.url, `https://media.fareeditor.com/${webp.body.key}`);
  assert.deepEqual([webp.body.content_type, webp.body.width, webp.body.height, webp.body.duration_ms, webp.body.in_use], ['image/webp', 1280, 720, null, false]);
  assert.equal(webp.body.sha256.slice(0, 12), webp.body.key.split('.')[1]);
  const again = await api('POST', '/api/media', form(media('works/fl-2.webp'), 'new-thumb-1.webp', 'work'));
  assert.equal(again.status, 200);
  assert.equal(again.body.id, webp.body.id);

  const p = await api('POST', '/api/media', form(png(640, 480), 'logo.png', 'client'));
  assert.deepEqual([p.status, p.body.content_type, p.body.width, p.body.height], [201, 'image/png', 640, 480]);
  assert.match(p.body.key, /^clients\/logo\.[0-9a-f]{12}\.png$/);
  const j = await api('POST', '/api/media', form(jpeg(800, 600), 'photo.jpeg', 'work'));
  assert.deepEqual([j.status, j.body.content_type, j.body.width, j.body.height], [201, 'image/jpeg', 800, 600]);
  assert.match(j.body.key, /^works\/photo\.[0-9a-f]{12}\.jpg$/);

  // mp4: байт в байт отличается от загруженного импортом (другой хвост), иначе вернулась бы старая запись
  const clip = Buffer.concat([media('before-after/after.mp4'), Buffer.from('tail')]);
  const mp4 = await api('POST', '/api/media', form(clip, 'whatever.mp4', 'after'));
  assert.equal(mp4.status, 201);
  assert.match(mp4.body.key, /^before-after\/after\.[0-9a-f]{12}\.mp4$/);
  assert.deepEqual([mp4.body.content_type, mp4.body.width, mp4.body.height, mp4.body.duration_ms, mp4.body.bytes], ['video/mp4', 1280, 720, 48120, clip.length]);

  const list = (await api('GET', '/api/media')).body.items;
  assert.equal(list.length, before.length + 4);

  // удаление: без ссылок — можно, со ссылкой — нельзя
  for (const item of [webp.body, p.body, j.body, mp4.body]) assert.equal((await api('DELETE', `/api/media/${item.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/media/${webp.body.id}`)).status, 404);
  const used = list.find((m) => m.in_use);
  assert.deepEqual((await api('DELETE', `/api/media/${used.id}`)).body, { error: 'in_use' });
  assert.equal((await api('GET', '/api/media')).body.items.length, before.length);
}, { timeout: 300_000 });

test('media: отказ по сигнатуре, виду и размеру', async () => {
  const text = await api('POST', '/api/media', form(Buffer.from('<html>not an image</html>'), 'fake.webp', 'work', 'image/webp'));
  assert.deepEqual([text.status, fields(text)], [422, ['file']]);
  const svg = await api('POST', '/api/media', form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'client', 'image/png'));
  assert.equal(svg.status, 422);
  // видео под видом превью и картинка под видом ролика
  assert.equal((await api('POST', '/api/media', form(media('before-after/after.mp4').subarray(0, 4096), 'clip.webp', 'work', 'image/webp'))).status, 422);
  assert.equal((await api('POST', '/api/media', form(png(10, 10), 'clip.mp4', 'before', 'video/mp4'))).status, 422);
  assert.deepEqual(fields(await api('POST', '/api/media', form(png(10, 10), 'x.png', 'poster'))), ['kind']);
  assert.deepEqual(fields(await api('POST', '/api/media', form(png(10, 10), 'x.png'))), ['kind']);
  const noFile = new FormData(); noFile.set('kind', 'work');
  assert.deepEqual(fields(await api('POST', '/api/media', noFile)), ['file']);

  const bigImage = await api('POST', '/api/media', form(png(100, 100, 5 * MB), 'big.png', 'work'));
  assert.equal(bigImage.status, 413);
  const bigVideo = Buffer.alloc(60 * MB + 1); bigVideo.writeUInt32BE(24, 0); bigVideo.write('ftypisom', 4);
  assert.equal((await api('POST', '/api/media', form(bigVideo, 'big.mp4', 'before'))).status, 413);
}, { timeout: 300_000 });

test('Content-Type эндпоинта: иначе 415', async () => {
  const headers = { 'Cf-Access-Jwt-Assertion': token, Origin: ORIGIN };
  assert.equal((await call('/api/categories', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await call('/api/categories', { method: 'POST', headers, body: '{}' })).status, 415);
  assert.equal((await call('/api/media', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal((await call('/api/publish', { method: 'POST', headers })).status, 415);
  assert.equal((await call('/api/categories', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{not json' })).status, 400);
  assert.equal((await api('GET', '/api/nope')).status, 404);
  assert.equal((await api('PATCH', '/api/categories/x', {})).status, 405);
});

test('атомарность batch: ошибка во втором выражении откатывает первое', async () => {
  assert.equal((await revs('stats', '9')).length, 0);
  const result = await api('POST', '/api/__test/broken-batch', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.failed, true, result.body.message);
  assert.equal((await revs('stats', '9')).length, 0, 'ревизия из первого выражения не применилась');
  assert.equal((await api('GET', '/api/stats')).body.items.length, 4);
});

test('restore с нарушением ограничения — 409, ревизия не добавляется', async () => {
  // работа ссылается на категорию; категорию удалить нельзя, пока работа есть — удаляем обе,
  // затем возвращаем работу раньше категории: внешний ключ не даёт, batch откатывается целиком
  const media = (await api('GET', '/api/media')).body.items.find((m) => m.kind === 'work').url;
  const category = { slug: 'tmp-cat', published: true, order: 90, title_ru: 'Врем', title_en: 'Tmp', aspect: '1:1', blurb_ru: '', blurb_en: '' };
  const sample = (await api('GET', '/api/works')).body.items[0];
  assert.equal((await api('POST', '/api/categories', category)).status, 201);
  assert.equal((await api('POST', '/api/works', { ...sample, slug: 'tmp-work', category: 'tmp-cat', thumbnail: media })).status, 201);
  assert.equal((await api('DELETE', '/api/works/tmp-work')).status, 200);
  assert.equal((await api('DELETE', '/api/categories/tmp-cat')).status, 200);
  const history = await revs('works', 'tmp-work');
  const failed = await api('POST', `/api/revisions/${history[0].id}/restore`, {});
  assert.deepEqual([failed.status, failed.body], [409, { error: 'conflict' }]);
  assert.equal((await revs('works', 'tmp-work')).length, history.length);
  assert.equal((await api('GET', '/api/works/tmp-work')).status, 404);
  assert.equal((await api('POST', '/api/revisions/999999/restore', {})).status, 404);
});

test('publish', async (t) => {
  if (REMOTE) {
    // В окружении test секрета нет: запрос к GitLab не уходит вовсе, наружу — 502.
    const response = await api('POST', '/api/publish', {});
    assert.deepEqual([response.status, response.body], [502, { error: 'publish_failed' }]);
    return;
  }
  await t.test('запуск: form-encoded token и ref, наружу — id, web_url, status', async () => {
    const response = await api('POST', '/api/publish', {});
    assert.deepEqual([response.status, response.body], [200, { id: 4242, web_url: 'https://gitlab.com/x/-/pipelines/4242', status: 'created' }]);
    assert.equal(gitlab.calls.length, 1);
    const { url, init } = gitlab.calls[0];
    assert.equal(url, 'https://gitlab.com/api/v4/projects/85233384/trigger/pipeline');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(String(init.body), 'token=glptt-secret-value&ref=main');
    assert.ok(!JSON.stringify(response.body).includes('glptt'));
  });
  await t.test('второй запуск в течение 60 с → 429, GitLab не вызывается', async () => {
    const response = await api('POST', '/api/publish', {});
    assert.deepEqual([response.status, response.body], [429, { error: 'too_soon', retry_after: 60 }]);
    assert.equal(gitlab.calls.length, 1);
  });
  await t.test('ошибка GitLab → 502 без деталей, минута не занята', async () => {
    localDb.raw.exec("UPDATE publishes SET created_at = '2020-01-01T00:00:00.000Z'");
    gitlab.reply = () => new Response('{"message":"401 Unauthorized, token glptt-secret-value"}', { status: 401 });
    const failed = await api('POST', '/api/publish', {});
    assert.deepEqual([failed.status, failed.body], [502, { error: 'publish_failed' }]);
    gitlab.reply = () => Response.json({ id: 4243, web_url: 'u', status: 'pending' });
    assert.equal((await api('POST', '/api/publish', {})).status, 200);
    assert.equal(gitlab.calls.length, 3);
  });
  await t.test('без секрета → 502, запрос не уходит', async () => {
    const { handle } = await import('../src/index.js');
    const env = await localEnv(key);
    const calls = [];
    const response = await handle(new Request(`${ORIGIN}/api/publish`, { method: 'POST', body: '{}',
      headers: { 'Cf-Access-Jwt-Assertion': token, Origin: ORIGIN, 'Content-Type': 'application/json' } }), env, { fetch: async (u) => { calls.push(u); } });
    assert.equal(response.status, 502);
    assert.equal(calls.length, 0);
  });
});
