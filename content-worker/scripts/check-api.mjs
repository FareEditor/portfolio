#!/usr/bin/env node
// Сверка API ↔ то, что фронтенд получает сейчас из site/src/data, плюс HTTP-контракт.
//
//   node scripts/check-api.mjs --base <http://localhost:8787 | https://fareeditor.com> \
//     --manifest <r2-manifest.json> [--data <site/src/data>]
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_DATA_DIR, diff, dropPaths, readFolder, readJson } from './import.mjs';

const { values: args } = parseArgs({
  options: { base: { type: 'string' }, manifest: { type: 'string' }, data: { type: 'string', default: DEFAULT_DATA_DIR } },
});
if (!args.base || !args.manifest) {
  console.error('usage: check-api.mjs --base <url> --manifest <r2-manifest.json> [--data <dir>]');
  process.exit(2);
}

let failed = 0;
function report(name, problems, detail = '') {
  if (problems.length === 0) {
    console.log(`PASS ${name}${detail && ` — ${detail}`}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}`);
    for (const problem of problems.slice(0, 20)) console.log(`     ${problem}`);
  }
}
const expect = (label, actual, expected) => (actual === expected ? [] : [`${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`]);

const manifest = readJson(args.manifest);
const src = (...parts) => join(args.data, ...parts);
const records = (dir) => readFolder(src(dir)).map(([, record]) => record);
// Путь из данных (/media/…) → абсолютный URL в R2.
const mediaUrl = (path) => manifest.find((m) => m.source === `site/public${path}`)?.url ?? `<нет в манифесте: ${path}>`;
const optional = (record, keys) => ({ ...Object.fromEntries(keys.map((k) => [k, ''])), ...record });

// Логика site/src/data/works.js, воспроизведена без импорта (там import.meta.glob от Vite).
const byOrder = (items) => [...items].sort((a, b) => a.order - b.order);
const works = records('works').map((w) => ({ ...w, thumbnail: mediaUrl(w.thumbnail) }));
const expectedHot = {
  stats: readJson(src('stats.json')),
  categories: byOrder(records('categories').filter((c) => c.published))
    .map((category) => ({
      ...optional(category, ['blurb_ru', 'blurb_en']),
      works: byOrder(works.filter((w) => w.published && w.category === category.slug)),
    }))
    .filter((category) => category.works.length > 0),
  testimonials: byOrder(records('testimonials').filter((t) => t.published)).map(({ logo, ...rest }) =>
    (logo ? { ...rest, logo: mediaUrl(logo) } : rest)),
  metricTypes: byOrder(records('metric-types')),
};

const mediaInfo = (name) => {
  const m = manifest.find((entry) => entry.key.startsWith(`before-after/${name}.`));
  return m && { url: m.url, width: m.width, height: m.height, duration_ms: Math.round(m.duration * 1000) };
};
const beforeAfter = mediaInfo('before') && mediaInfo('after') ? { before: mediaInfo('before'), after: mediaInfo('after') } : null;
const expectedStatic = {
  content: Object.fromEntries(['ru', 'en'].map((locale) => [locale, dropPaths(readJson(src('content', `${locale}.json`)))])),
  settings: { ...readJson(src('settings.json')), before_after_enabled: beforeAfter !== null, beforeAfter },
  contacts: { items: readJson(src('contacts.json')).items.map((item) => optional(item, ['subject_ru', 'subject_en'])) },
};

const request = (path, init) => fetch(args.base + path, { redirect: 'manual', ...init });

for (const [path, expected] of [['/data/hot.json', expectedHot], ['/data/static.json', expectedStatic]]) {
  const first = await request(path);
  const text = await first.text();
  const { version, ...payload } = first.ok ? JSON.parse(text) : {};
  report(`${path}: содержимое`, first.ok ? diff(payload, expected, path) : [`статус ${first.status}`],
    `${Buffer.byteLength(text)} байт, version ${version}`);

  // Сжимающий edge ослабляет ETag (W/"…") в ответах с телом; сравнение — без префикса.
  const strong = (value) => value?.replace(/^W\//, '');
  const etag = strong(first.headers.get('etag'));
  report(`${path}: заголовки`, [
    ...expect('status', first.status, 200),
    ...expect('content-type', first.headers.get('content-type'), 'application/json; charset=utf-8'),
    ...expect('cache-control', first.headers.get('cache-control'), 'public, max-age=0, must-revalidate'),
    ...expect('x-content-type-options', first.headers.get('x-content-type-options'), 'nosniff'),
    ...expect('etag', etag, `"${version}"`),
    ...expect('access-control-allow-origin', first.headers.get('access-control-allow-origin'), null),
    ...(['HIT', 'MISS'].includes(first.headers.get('x-content-cache')) ? [] : [`x-content-cache: ${first.headers.get('x-content-cache')}`]),
  ], `etag ${first.headers.get('etag')}, x-content-cache ${first.headers.get('x-content-cache')}`);

  const second = await request(`${path}?ignored=1&x=${Date.now()}`);
  const secondText = await second.text();
  report(`${path}: version стабилен, query игнорируется`, [
    ...expect('version', JSON.parse(secondText).version, version),
    ...expect('тело', secondText === text, true),
    ...expect('etag', strong(second.headers.get('etag')), etag),
  ], `x-content-cache ${second.headers.get('x-content-cache')}`);

  const conditional = await request(path, { headers: { 'If-None-Match': etag } });
  report(`${path}: If-None-Match → 304`, [
    ...expect('status', conditional.status, 304),
    ...expect('тело', await conditional.text(), ''),
    ...expect('etag', strong(conditional.headers.get('etag')), etag),
    ...expect('cache-control', conditional.headers.get('cache-control'), 'public, max-age=0, must-revalidate'),
  ]);
  const stale = await request(path, { headers: { 'If-None-Match': '"0000000000000000"' } });
  report(`${path}: чужой If-None-Match → 200`, expect('status', stale.status, 200));

  const head = await request(path, { method: 'HEAD' });
  report(`${path}: HEAD`, [
    ...expect('status', head.status, 200),
    ...expect('тело', await head.text(), ''),
    ...expect('etag', strong(head.headers.get('etag')), etag),
  ]);

  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const res = await request(path, { method, headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' } });
    report(`${path}: ${method} → 405`, [
      ...expect('status', res.status, 405),
      ...expect('allow', res.headers.get('allow'), 'GET, HEAD'),
      ...expect('access-control-allow-origin', res.headers.get('access-control-allow-origin'), null),
    ]);
  }
}

for (const path of ['/data/', '/data/nope.json', '/data/hot.json/', '/data/hot']) {
  const res = await request(path);
  report(`${path} → 404`, expect('status', res.status, 404));
}

console.log(failed === 0 ? 'ИТОГ: PASS' : `ИТОГ: FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
