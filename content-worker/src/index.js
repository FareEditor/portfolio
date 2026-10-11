// Публичный read-only API контента: GET/HEAD /data/hot.json и /data/static.json.
// Same-origin, без CORS. Query-параметры игнорируются. К D1 — только SELECT без параметров.
import * as map from './mapping.js';

const BROWSER_CACHE = 'public, max-age=0, must-revalidate';

const baseHeaders = (extra) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
});

const error = (status, code, extra) =>
  new Response(JSON.stringify({ error: code }), { status, headers: baseHeaders({ 'Cache-Control': 'no-store', ...extra }) });

// Один batch = один согласованный снимок базы.
async function select(db, queries) {
  const names = Object.keys(queries);
  const results = await db.batch(names.map((name) => db.prepare(queries[name])));
  return Object.fromEntries(names.map((name, i) => [name, results[i].results]));
}

// Повторяет site/src/data/works.js: только опубликованное, по order, категории без работ отброшены.
async function hot(db) {
  const rows = await select(db, {
    stats: 'SELECT * FROM stats ORDER BY position',
    categories: 'SELECT * FROM categories WHERE published = 1 ORDER BY sort_order, slug',
    works: `SELECT w.*, m.url AS thumbnail_url FROM works w JOIN media m ON m.id = w.thumbnail_media_id
            WHERE w.published = 1 ORDER BY w.sort_order, w.slug`,
    testimonials: `SELECT t.*, m.url AS logo_url FROM testimonials t LEFT JOIN media m ON m.id = t.logo_media_id
                   WHERE t.published = 1 ORDER BY t.sort_order, t.slug`,
    metrics: 'SELECT * FROM testimonial_metrics ORDER BY testimonial_slug, position',
    metricTypes: 'SELECT * FROM metric_types ORDER BY sort_order, slug',
  });
  return {
    stats: { items: rows.stats.map(map.stat) },
    categories: rows.categories
      .map((c) => ({
        ...map.category(c),
        works: rows.works.filter((w) => w.category_slug === c.slug).map((w) => map.work(w, w.thumbnail_url)),
      }))
      .filter((c) => c.works.length > 0),
    testimonials: rows.testimonials.map((t) =>
      map.testimonial(t, rows.metrics.filter((m) => m.testimonial_slug === t.slug), t.logo_url)),
    metricTypes: rows.metricTypes.map(map.metricType),
  };
}

async function statics(db) {
  const rows = await select(db, {
    content: 'SELECT locale, doc FROM content',
    settings: 'SELECT * FROM settings WHERE id = 1',
    media: `SELECT id, url, width, height, duration_ms FROM media
            WHERE id IN (SELECT before_media_id FROM settings UNION SELECT after_media_id FROM settings)`,
    contacts: 'SELECT * FROM contacts ORDER BY position',
  });
  const s = rows.settings[0];
  const media = (id) => {
    const { url, width, height, duration_ms } = rows.media.find((m) => m.id === id);
    return { url, width, height, duration_ms };
  };
  const enabled = map.bool(s.before_after_enabled);
  return {
    content: Object.fromEntries(['ru', 'en'].map((locale) =>
      [locale, JSON.parse(rows.content.find((r) => r.locale === locale).doc)])),
    settings: {
      ...map.settings(s),
      before_after_enabled: enabled,
      beforeAfter: enabled ? { before: media(s.before_media_id), after: media(s.after_media_id) } : null,
    },
    contacts: { items: rows.contacts.map(map.contact) },
  };
}

const ROUTES = { '/data/hot.json': hot, '/data/static.json': statics };

// Хеш содержимого без самого version: одинаковые данные → одинаковый version.
async function withVersion(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const version = [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { version, body: JSON.stringify({ version, ...payload }) };
}

// Сжимающий прокси может ослабить ETag до W/"…" — сравнение слабое.
const etagMatches = (header, etag) =>
  header !== null && header.split(',').some((tag) => [etag, '*'].includes(tag.trim().replace(/^W\//, '')));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method_not_allowed', { Allow: 'GET, HEAD' });
    const build = ROUTES[url.pathname];
    if (!build) return error(404, 'not_found');

    const ttl = Number(env.EDGE_TTL_SECONDS) || 0;
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname);

    let body;
    let etag;
    let state = 'HIT';
    const cached = ttl > 0 ? await cache.match(cacheKey) : undefined;
    if (cached) {
      etag = cached.headers.get('ETag');
      body = await cached.text();
    } else {
      state = 'MISS';
      try {
        const versioned = await withVersion(await build(env.DB));
        etag = `"${versioned.version}"`;
        body = versioned.body;
      } catch (err) {
        console.error(JSON.stringify({ event: 'd1_error', path: url.pathname, message: String(err?.message ?? err) }));
        return error(503, 'unavailable');
      }
      // В кэше лежит копия с edge-TTL; клиенту Cache-Control всегда переписывается ниже.
      if (ttl > 0) {
        ctx.waitUntil(cache.put(cacheKey, new Response(body, {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}`, ETag: etag },
        })));
      }
    }

    const headers = baseHeaders({ 'Cache-Control': BROWSER_CACHE, ETag: etag, 'X-Content-Cache': state });
    if (etagMatches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  },
};
