# fareeditor.com

A bilingual (English/Russian) portfolio site for a freelance video editor. It
exists for one reason: to turn a visitor into a project enquiry. The two
locales are not translations of each other — they carry deliberately different
social proof and different contact channels.

Live: https://fareeditor.com — Russian at https://fareeditor.com/ru/

## Architecture

```
visitor ──► fareeditor.com            GitLab Pages: prerendered HTML, JS, CSS, fonts
        ├─► fareeditor.com/data/*     Worker fareeditor-content: read-only JSON from D1
        ├─► fareeditor.com/api/*      Worker fareeditor-contact: the contact form
        └─► media.fareeditor.com      R2 bucket fareeditor-media: thumbnails, logos, clips

owner   ──► admin.fareeditor.com      Worker fareeditor-admin behind Cloudflare Access:
                                      admin UI + write API to D1 and R2
```

- **Site** — Vite 7 + React 19 with build-time prerendering. `/` and `/ru/`
  are real HTML documents, not client-side routes; both hydrate on top of
  complete markup.
- **Content** — one Cloudflare **D1** database, `fareeditor-content`. It is
  the only source of content. There are no content files in this repository.
- **Media** — Cloudflare **R2**, served from `media.fareeditor.com` under
  content-hashed, immutable keys. The database stores links only.
- **Admin** — `admin.fareeditor.com`, a Worker that serves the admin UI and
  the write API. The whole host sits behind Cloudflare Access, and the Worker
  verifies the Access token itself on every API request.
- **Contact form** — a separate Worker on `/api/*` with a KV lead archive
  (90-day TTL) and rate-limit counters. It is not a proxy.

No animation libraries, no UI component libraries, no CSS framework.

### What is in the page and what is fetched

The site reads content in two ways, and that decides how an edit goes live.

| Content | How the site gets it | Goes live |
| --- | --- | --- |
| Works, categories, testimonials, metric types, stats | Fetched in the browser from `/data/hot.json` | Within a minute of saving (edge cache is 60 s) |
| Texts, settings, contact cards | Baked into the HTML at build time from `/data/static.json` | After the site is rebuilt |

So the page text reads with JavaScript disabled; the "hot" sections need it.

## Repository layout

```
.gitlab-ci.yml          site → GitLab Pages; contact Worker → Cloudflare (manual job)
COPYRIGHT               which paths are GPL-3.0 and which are all rights reserved
LICENSE                 GPL-3.0 text; applies to the code only
site/                   the public site
  index.html            English document (/)
  ru/index.html         Russian document (/ru/)
  vite.config.js        build config, robots guard, dev proxies for /api and /data
  prerender.js          inlines SSR markup into both documents
  scripts/              build-time checks: content snapshot, form option keys
  public/media/         og image only; all other media lives in R2
  src/                  components, styles, fonts, hot-data loader
content-worker/         fareeditor-content: D1 schema, migrations, /data/* API,
                        backup verification scripts
admin-worker/           fareeditor-admin: Access check, write API, admin UI (ui/)
worker/                 fareeditor-contact: POST /api/contact
```

Each package has its own lockfile and its own README (the Worker READMEs are
in Russian). `admin-worker` imports the schema and field mapping from
`content-worker/src` and the form option keys from `site/src/formOptions.js`.

## Editing content

Open https://admin.fareeditor.com/ and sign in through Cloudflare Access.

- **Works, testimonials, metric types, stats** — saved changes appear on the
  site within a minute.
- **Texts, settings, contacts** — saved changes appear after a rebuild. Press
  **«Опубликовать тексты»** in the admin: it triggers a GitLab pipeline on
  `main` that rebuilds the site with the current content. It takes a few
  minutes and can be started at most once a minute.
- **Media** — upload in the admin. Files go to R2; a file that is still
  referenced cannot be deleted.
- **History** — every save keeps the previous version of the record. The
  «История» button on a record shows the differences and restores a version.

Two people editing the same record do not overwrite each other silently: the
second save is refused and the form shows what changed.

### Scheduled rebuild

The `pages` job also runs for `schedule` pipelines on the default branch, so
a nightly pipeline schedule (GitLab → Build → Pipeline schedules, target
`main`) rebuilds the site with fresh content even if nobody pressed publish.
The schedule itself lives in the GitLab project settings, not in this
repository.

## Local development

### Prerequisites

- **Node.js 22.12 or newer.** CI builds on the `node:24` image.
- **npm 10 or newer.**
- A **Cloudflare account** and a **GitLab account** if you intend to deploy.

### The site

```sh
cd site
npm ci
npm run dev            # vite on http://localhost:5173
```

The dev server proxies `/data` to `https://fareeditor.com` (the live content
API) and `/api` to `http://localhost:8787` (a local contact Worker, optional).
`npm run dev -- --host` exposes it on the LAN.

```sh
npm run build          # → site/dist
npm run preview        # serves dist, with the same /data proxy
```

`npm run build` checks the form option keys against the contact Worker,
downloads a snapshot of `/data/static.json`, builds the client and SSR
bundles, and runs `prerender.js`. **The build needs network access to the
content API** and fails if the snapshot is missing or malformed, so a build
with empty content cannot ship. `STATIC_DATA_URL` and `HOT_DATA_URL` override
the source.

### The contact Worker

```sh
cd worker
npm ci
npm run dev            # wrangler dev on http://localhost:8787
```

The `LEADS` KV binding is declared with `"remote": true`: `wrangler dev`
talks to the **real** namespace, so test submissions land in the production
lead archive and consume the production rate-limit budget. Set the flag to
`false` in your working copy for a purely local run.

### The content and admin Workers

See `content-worker/README.md` and `admin-worker/README.md`. Both run against
the remote database with `wrangler dev --remote`; `admin-worker` has unit
tests (`npm test`) that need no Cloudflare access.

## Environment variables and secrets

| Variable | What it is | Where it lives |
| --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | Public Turnstile site key, baked into the bundle | `site/.env.local`; GitLab CI/CD variable |
| `DEPLOY_ENV` | Only the literal `production` lifts `noindex` | set inside the `pages` job |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TURNSTILE_SECRET` | Contact Worker secrets | `worker/.dev.vars`; `wrangler secret put` in `worker/` |
| `GITLAB_TRIGGER_TOKEN` | Pipeline trigger token used by «Опубликовать тексты» | `wrangler secret put` in `admin-worker/` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Authenticate `wrangler` | shell environment; GitLab CI/CD variables for `worker:deploy` |

Not secret, and committed: the D1 database id, the KV namespace id, the
Access audience tag and the allowed email in `admin-worker/wrangler.jsonc`.
They identify resources; they do not grant access.

Never in the repository or a build log: the three contact Worker secrets,
`GITLAB_TRIGGER_TOKEN`, `CLOUDFLARE_API_TOKEN`. `worker/.dev.vars` and
`site/.env.*` are gitignored.

For local runs use Cloudflare's always-passes Turnstile pair: site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

The API token must be able to deploy Workers and their routes and custom
domains, and to manage D1 and R2 in the account. Use a scoped token, not the
global API key.

## Deployment

**Site → GitLab Pages.** The `pages` job runs on the default branch when
`site/**/*` changed, and for `trigger`, `schedule` and `web` pipelines
without a path condition — that is how a content publish rebuilds the same
code. It sets `DEPLOY_ENV: "production"` in the job itself and keeps its
artifact forever, because Pages serves the most recent artifact.
`resource_group: production` keeps two deploys from overtaking each other.

**`DEPLOY_ENV` controls indexability, and its absence is the safe state.**
Any build without the exact value `production` gets
`<meta name="robots" content="noindex, nofollow">` and a `Disallow: /`
robots.txt. The same guard fails the build if `DEPLOY_ENV=production` is set
while `VITE_TURNSTILE_SITE_KEY` is empty.

**Staging.** `site:staging` builds any non-default branch with `site/**/*`
changes, noindexed, as a one-week job artifact. It is not published.

**Workers.** Each is deployed from its own directory:

```sh
cd content-worker && npx wrangler deploy            # /data/*
cd admin-worker   && npx wrangler deploy --env=""   # admin.fareeditor.com; builds ui/ first
cd worker         && npx wrangler deploy            # /api/* — or the manual worker:deploy job
```

`worker:deploy` is the only Worker job in CI: manual, default branch only,
`worker/**/*` changes only. The content and admin Workers are deployed by
hand. Database migrations live in `content-worker/migrations` and are applied
with `npx wrangler d1 migrations apply fareeditor-content --remote`.

`admin-worker/wrangler.jsonc` has a `test` environment for integration tests
on temporary resources. Always pass `--env=""` when deploying production.

## Backup and restore

The database is the content. Back it up before anything risky:

```sh
cd content-worker
npx wrangler d1 export fareeditor-content --remote --output <dir>/d1-$(date +%Y%m%d-%H%M).sql
```

Keep the file outside the repository. `content-worker/README.md` describes
how to verify a backup against a temporary database, how to restore, and what
D1 Time Travel offers (point-in-time restore: 7 days on Workers Free, 30 days
on Workers Paid).

A single record is easier to bring back from its history in the admin.

`content-worker/scripts/import.mjs` is the one-off migration script that
moved the content from JSON files into D1. Its output replaces every table.
It refuses to write to the production database without an explicit flag, and
there is normally no reason to run it again.

## Rolling back a release

The pieces roll back independently.

- **Site.** Revert the offending commit on `main`; the `pages` job redeploys.
- **A Worker.** `npx wrangler rollback` in its directory (add `--env=""` for
  `admin-worker`) returns to the previous deployed version.
- **Content.** A record — from its history in the admin. The whole database —
  Time Travel or a backup file.

To take the content API off the site entirely, remove `routes` from
`content-worker/wrangler.jsonc` and deploy: `/data/*` falls through to GitLab
Pages and returns 404, the hot sections hide themselves, and the next site
build fails rather than shipping empty pages.

## Forking this for your own site

Everything below must change.

1. **Domain.** `SITE_ORIGIN` in `worker/src/index.js` (the CORS allow-origin),
   every `routes` block and `zone_name` in the three `wrangler.jsonc` files,
   `ADMIN_ORIGIN` and `MEDIA_BASE_URL` in `admin-worker/wrangler.jsonc`, and
   every `canonical`, `hreflang` and `og:` URL in `site/index.html` and
   `site/ru/index.html`.
2. **Cloudflare resources.** A D1 database (apply the migrations), an R2
   bucket with a public custom domain, a KV namespace for leads. Put their
   ids and names into the `wrangler.jsonc` files.
3. **Cloudflare Access.** An Access application for the admin host. Put its
   team domain, audience tag and your email into
   `admin-worker/wrangler.jsonc` and `admin-worker/src/auth.js` (`JWKS_URL`).
4. **Worker names.** Two people cannot both deploy `fareeditor-contact`,
   `fareeditor-content` and `fareeditor-admin`.
5. **Secrets.** All of them, via `wrangler secret put`. New Telegram bot, new
   Turnstile widget, a GitLab pipeline trigger token for your project, and
   `GITLAB_PROJECT_ID` in `admin-worker/wrangler.jsonc`.
6. **Content and media.** Start from an empty database and enter your own
   through the admin. The two locales are meant to say different things — do
   not translate one into the other.
7. **Form option keys.** The project-type and budget selects submit stable
   keys. They are defined in `PROJECT_TYPES` / `BUDGETS` in
   `worker/src/index.js` and duplicated in `site/src/formOptions.js`; the
   site build fails if the two differ. The admin lets you edit the labels,
   not the keys. To change the keys, change both files, the stored content,
   and — if you want readable Telegram notifications — `PROJECT_TYPE_LABELS`
   and `BUDGET_LABELS` in the Worker.

A fork must replace all content and media with its own. See the licence
section.

## Contributing

This is one person's live site, not a library.

Bug reports and fixes to the **code** are welcome — open an issue or a merge
request. Changes to copy, works or branding are not: that content is the
substance of the site.

## Licence

Two regimes. `COPYRIGHT` is the authoritative statement; this is the summary.

### Code — GPL-3.0-or-later

The source under `site/`, `worker/`, `content-worker/` and `admin-worker/`,
and the build and CI configuration. Full text in `LICENSE`. A derivative work
built from this code must itself be released under GPL-3.0-or-later, with
source available.

Third-party dependencies keep their own licences. The bundled fonts (Onest,
JetBrains Mono) are under the SIL Open Font License 1.1.

### Content — all rights reserved

Everything the site shows that is not code: the copy, works, testimonials and
settings stored in the database, every media file served from
`media.fareeditor.com`, `site/public/media`, the showreel, and the FARE name
and wordmark. No licence is granted: not reusable, not adaptable, not
redistributable.

Part of this material was produced for clients and its rights are theirs, so
it is not mine to license. Earlier revisions of this repository contain that
content as files; the same terms apply to them.
