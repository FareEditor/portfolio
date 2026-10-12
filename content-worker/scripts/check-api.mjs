#!/usr/bin/env node
// Сверка публичного API с бэкапом D1 (файл `wrangler d1 export`) плюс HTTP-контракт.
// Ожидаемые ответы собираются из строк бэкапа заново, независимо от SQL Worker'а:
// фильтр по published, порядок, вложение работ в категории. Если базу правили после бэкапа,
// проверка «содержимое» покажет именно эти правки.
//
//   node scripts/check-api.mjs --base <http://localhost:8787 | https://fareeditor.com> --backup <d1-….sql>
import { parseArgs } from 'node:util';
import * as map from '../src/mapping.js';
import { loadBackup } from './backup.mjs';
import { diff } from './import.mjs';

const { values: args } = parseArgs({ options: { base: { type: 'string' }, backup: { type: 'string' } } });
if (!args.base || !args.backup) {
  console.error('usage: check-api.mjs --base <url> --backup <d1-….sql>');
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

const db = loadBackup(args.backup);
const media = new Map(db.media.map((m) => [m.id, m]));
const url = (id) => media.get(id)?.url ?? `<нет media ${id}>`;
const byOrder = (rows) => [...rows].sort((a, b) => a.sort_order - b.sort_order || (a.slug < b.slug ? -1 : 1));
const published = (rows) => byOrder(rows.filter((r) => r.published === 1));

const expectedHot = {
  stats: { items: db.stats.map(map.stat) },
  categories: published(db.categories)
    .map((category) => ({
      ...map.category(category),
      works: published(db.works).filter((w) => w.category_slug === category.slug).map((w) => map.work(w, url(w.thumbnail_media_id))),
    }))
    .filter((category) => category.works.length > 0),
  testimonials: published(db.testimonials).map((t) => map.testimonial(t,
    db.testimonial_metrics.filter((m) => m.testimonial_slug === t.slug), t.logo_media_id === null ? null : url(t.logo_media_id))),
  metricTypes: byOrder(db.metric_types).map(map.metricType),
};

const s = db.settings[0];
const mediaInfo = (id) => { const { url: href, width, height, duration_ms } = media.get(id); return { url: href, width, height, duration_ms }; };
const enabled = s.before_after_enabled === 1;
const expectedStatic = {
  content: Object.fromEntries(db.content.map((row) => [row.locale, JSON.parse(row.doc)])),
  settings: { ...map.settings(s), before_after_enabled: enabled, beforeAfter: enabled ? { before: mediaInfo(s.before_media_id), after: mediaInfo(s.after_media_id) } : null },
  contacts: { items: db.contacts.map(map.contact) },
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
