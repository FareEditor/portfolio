# fareeditor.com

A bilingual (English/Russian) portfolio site for a freelance video editor. It
exists for one reason: to turn a visitor into a project enquiry. The two
locales are not translations of each other — they carry deliberately different
social proof and different contact channels.

Live: https://fareeditor.com — Russian at https://fareeditor.com/ru/

## Stack

- **Vite 7 + React 19**, with build-time prerendering. Both documents ship
  complete markup and hydrate on top of it, so the page reads with JS
  disabled.
- **Static output on GitLab Pages.** `/` and `/ru/` are real, physically
  built HTML documents, not client-side routes.
- **Decap CMS 3** on a GitLab backend with PKCE auth — no OAuth server of
  our own.
- **Cloudflare Worker** on `fareeditor.com/api/*`, handling the contact form
  only. Everything else goes straight to GitLab Pages; the Worker is not a
  proxy.
- **Cloudflare KV** as the lead archive, 90-day TTL, plus the rate-limit
  counters.

The repository is a monorepo of two independent packages, `site/` and
`worker/`. They have separate lockfiles, separate CI jobs and separate
deploy targets. Neither one's pipeline touches the other.

No animation libraries, no UI component libraries, no CSS framework. CSS
transitions and hand-written observers only.

## Repository layout

```
.gitlab-ci.yml                two pipelines: site → GitLab Pages, worker → Cloudflare
CLAUDE.md                     working notes for Claude Code
COPYRIGHT                     which paths are GPL-3.0 and which are all rights reserved
LICENSE                       GPL-3.0 text; applies to the code only
design/
  FARE_Landing_dc.html        the approved design, produced in Claude Design, kept as a
                              reference. It uses a proprietary template runtime
                              (<x-dc>, <sc-for>, <sc-if>, {{ }}) that does not execute
                              here. Read it, do not run it.
site/
  index.html                  English document (/): canonical, hreflang, first-visit redirect
  ru/index.html               Russian document (/ru/)
  vite.config.js              build config, robots guard, /api dev proxy
  prerender.js                post-build step that inlines SSR markup into both documents
  public/admin/               Decap CMS: index.html + config.yml
  public/media/works/         work thumbnails (webp)
  src/
    App.jsx                   state, form submission, language switch
    entry-en.jsx              client hydration, English
    entry-ru.jsx              client hydration, Russian
    entry-server.jsx          renderToString, used only by prerender.js
    components/               presentational components, one per section
    data/content/en.json      all English copy, written by the CMS
    data/content/ru.json      all Russian copy, written by the CMS
    data/works/*.json         one file per work, written by the CMS
    data/works.js             glob, filter on `published`, sort on `order`
    data/settings.json        site settings, written by the CMS
    fonts/                    subset woff2: Inter, Manrope, JetBrains Mono
    styles/tokens.css         design tokens, copied verbatim from the design file
    styles/app.css            component styles
worker/
  wrangler.jsonc              Worker name, route, KV binding
  src/index.js                POST /api/contact — the whole Worker
  README.md                   Worker-specific notes (in Russian)
```

## Local development

### Prerequisites

- **Node.js 22.12 or newer.** Vite 7 requires `^20.19.0 || >=22.12.0`;
  Wrangler 4 requires `>=22.0.0`. The intersection is 22.12+. CI builds on
  the `node:24` image.
- **npm 10 or newer** (ships with those Node versions).
- A **Cloudflare account** and a **GitLab account** if you intend to deploy.

### Two terminals

The site and the Worker run as separate processes. The Vite dev server proxies
`/api` to `http://localhost:8787`, so the contact form works end to end
locally without CORS (`site/vite.config.js`, `server.proxy`).

Terminal 1 — the Worker:

```sh
cd worker
npm ci
npm run dev            # wrangler dev on http://localhost:8787
```

`wrangler dev` reads `worker/.dev.vars`; create it first, see the next
section.

Terminal 2 — the site:

```sh
cd site
npm ci
npm run dev            # vite on http://localhost:5173
```

To reach the dev server from a phone on the same network:

```sh
npm run dev -- --host
```

Vite then prints a LAN address. The `/api` proxy still points at
`localhost:8787` from the dev server's own perspective, so the Worker does
not need `--host` of its own.

### Building

```sh
cd site
npm run build          # → site/dist
```

`npm run build` is four steps in one: the client build, an SSR build into
`dist-ssr`, `node prerender.js` (which inlines the rendered markup into both
documents and deletes `dist-ssr`), and a copy of the vendored Decap bundle
from `node_modules/decap-cms/dist` into `dist/admin/`. Decap is vendored
rather than loaded from a CDN because it receives an OAuth token with `api`
scope; its version is pinned by the lockfile.

`prerender.js` throws if either document lacks an empty `<div id="root">` or
if `render()` returns an empty string, so a silently unprerendered build
cannot ship.

### One caveat about local KV

The `LEADS` binding in `worker/wrangler.jsonc` is declared with
`"remote": true`, which means `wrangler dev` connects to the **real, deployed
KV namespace** rather than to local Miniflare storage. Consequences: you need
to be logged in (`npx wrangler login`), and submissions you make while
testing land in the production lead archive and consume the production
rate-limit budget. If you want a purely local run, set that flag to `false`
in your working copy.

## Environment variables and secrets

Nothing in this table is optional if you want a working production deploy.

| Variable | What it is | Local | Production | Where to get it |
| --- | --- | --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | Public Turnstile site key, baked into the bundle at build time | `site/.env.local` | GitLab CI/CD variable (project settings) | Cloudflare dashboard → Turnstile → your widget → Site Key |
| `DEPLOY_ENV` | Build-mode switch. Only the literal value `production` lifts `noindex` | not set | set to `production` inside the `pages` job in `.gitlab-ci.yml` | n/a — it is a flag, not a credential |
| `TELEGRAM_BOT_TOKEN` | Bot token used to post the lead notification | `worker/.dev.vars` | `wrangler secret put` | Telegram, talk to `@BotFather` |
| `TELEGRAM_CHAT_ID` | Numeric chat the notification is sent to | `worker/.dev.vars` | `wrangler secret put` | Message your bot once, then read `result[].message.chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `TURNSTILE_SECRET` | Server-side Turnstile key, used for siteverify | `worker/.dev.vars` | `wrangler secret put` | Cloudflare dashboard → Turnstile → your widget → Secret Key |
| `LEADS` (KV binding) | Lead archive and rate-limit counters | same namespace as production, see the caveat above | `kv_namespaces` in `worker/wrangler.jsonc` | `npx wrangler kv namespace create LEADS`, then paste the returned id |
| `CLOUDFLARE_API_TOKEN` | Authenticates `wrangler deploy` in CI | not needed (`wrangler login` instead) | GitLab CI/CD variable, masked and protected | Cloudflare dashboard → My Profile → API Tokens → Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the account for `wrangler deploy` | not needed | GitLab CI/CD variable | Cloudflare dashboard → Workers & Pages → Account details |

### What is secret and what is not

Public by design, and fine to commit:

- The **Turnstile site key**. It is rendered into the widget in every
  visitor's HTML; there is nothing to protect. In this repo it happens to be
  injected at build time from an environment variable rather than committed,
  but that is a build convenience, not a secrecy measure.
- The **KV namespace id** in `worker/wrangler.jsonc`. It identifies a
  namespace; it does not grant access to it.
- The **GitLab OAuth Application ID** (`app_id`) in
  `site/public/admin/config.yml`. PKCE clients are public clients — the id is
  meant to be visible.

Never in the repository, never in a build log:

- `TELEGRAM_BOT_TOKEN`
- `TURNSTILE_SECRET`
- `CLOUDFLARE_API_TOKEN`

`worker/.dev.vars` and `site/.env.*` are gitignored. Keep it that way.

### Creating the local files

Both packages carry `.example` files locally, but the `.gitignore` patterns
`site/.env.*` and `worker/.dev.vars.*` swallow them, so **they are not in a
fresh clone**. Create them by hand.

`worker/.dev.vars`:

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TURNSTILE_SECRET=
```

`site/.env.local`:

```
VITE_TURNSTILE_SITE_KEY=
```

For local runs, use Cloudflare's published always-passes test pair rather
than your real keys: site key `1x00000000000000000000AA`, secret
`1x0000000000000000000000000000000AA`. With them, any token verifies. If
`VITE_TURNSTILE_SITE_KEY` is empty the form still renders, but the widget
slot shows a placeholder and the Worker will reject every submission with
`turnstile_failed`.

### Setting production secrets

```sh
cd worker
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TURNSTILE_SECRET
```

Each command prompts for the value and does not echo it. Secrets are stored
against the Worker, not against a deployment: `wrangler deploy` does **not**
clear them. You set them once and redeploy freely.

### Minimal Cloudflare API token

The CI job only deploys a Worker to an existing zone route. Create a custom
token with exactly:

- **Zone → Workers Routes → Edit**, zone resources scoped to the single zone
  (`fareeditor.com`, or yours).
- **Account → Workers Scripts → Edit**, account resources scoped to the one
  account.

Nothing else. Do not use a global API key.

## Deployment

Both pipelines are defined in `.gitlab-ci.yml` and are gated on path
changes, so a commit that only touches `worker/` will not rebuild the site
and vice versa.

**Site → GitLab Pages.** The `pages` job runs on the default branch when
something under `site/**/*` changed. It sets `DEPLOY_ENV: "production"` in
the job itself — deliberately, rather than in the project's CI/CD settings.
It builds `site/`, moves `dist` to `public/`, and publishes it as an artifact
with `expire_in: never`, because Pages serves the most recent artifact and an
expiry during a long quiet period would take the site offline.

**`DEPLOY_ENV` controls indexability, and its absence is the safe state.**
`site/vite.config.js` treats only the exact value `production` as production.
Any other build — a staging branch, a typo, a variable someone forgot to
carry over — gets `<meta name="robots" content="noindex, nofollow">` injected
into the head and a `robots.txt` of `Disallow: /`. A misconfigured build
hides the site; it never leaks it. The same guard hard-fails the build if
`DEPLOY_ENV=production` is set while `VITE_TURNSTILE_SITE_KEY` is empty,
because that combination produces a green build with a dead form: the Worker
would reject every enquiry as `turnstile_failed`.

**Staging.** The `site:staging` job runs on any non-default branch with
`site/**/*` changes. It does not set `DEPLOY_ENV`, so the output is
noindexed, and it does not publish to Pages — the build is left as a job
artifact for a week.

**Worker → Cloudflare.** The `worker:deploy` job runs `npx wrangler deploy`.
It is restricted to the default branch, restricted to `worker/**/*` changes,
and marked `when: manual`: an accidental deploy takes the contact form down,
and the Worker changes far too rarely for automation to be worth that risk.
It carries `allow_failure: true` so that leaving it unclicked does not park
the pipeline in a blocked state. Deploying by hand from a workstation
(`cd worker && npm run deploy`) is equally valid.

## Content management

The CMS lives at https://fareeditor.com/admin/. It does not work against the
Vite dev server: `site/public/admin/` contains only `index.html` and
`config.yml`, and the Decap bundle is copied into `dist/admin/` by the build
script. `npm run build && npm run preview` will at least load the admin page
locally, though logging in will not work unless the origin you preview from
is one of the registered OAuth redirect URIs.

Authentication is GitLab's own, over PKCE — there is no separate user list
and no OAuth server to run. Whoever has write access to the repository has
access to the CMS; nothing is layered on top of that. The editorial preview
pane is switched off on purpose: it would require a second copy of the site's
components and would inevitably drift from the real render.

Two collections, both defined in `site/public/admin/config.yml`:

- **Работы (`works`)** — a folder collection over `site/src/data/works`, one
  JSON file per work, `slug` as the identifier. Fields cover both locales
  (`client`/`client_en`, `title_ru`/`title_en`, `body_ru`/`body_en`,
  `duration`/`duration_en`, `format`/`format_en`), plus `published`, `order`,
  `type` (`case` or `motion`), `featured`, `youtube_id` and a `thumbnail`
  image. Uploads land in `site/public/media/works` and are referenced as
  `/media/works/...`.
- **Настройки (`settings`)** — a single file, `site/src/data/settings.json`:
  the hero status pill in both locales, the showreel YouTube id, and the
  direct-contact URL per locale (Telegram for Russian, X for English — those
  differ on purpose).

A CMS edit commits **straight to `main`** — there is no editorial workflow —
and that commit touches `site/**/*`, which triggers the `pages` job and
rebuilds the live site. So content can move under you between sessions. Make
`git pull --rebase` a reflex before you start local work.

## Forking this for your own site

Everything below must change. Most of it fails loudly if you miss it; the
last two items fail silently.

1. **Domain.** `SITE_ORIGIN` in `worker/src/index.js` (it is the CORS
   allow-origin — a stale value blocks every submission from your site), the
   `routes[].pattern` and `zone_name` in `worker/wrangler.jsonc`,
   `site_url` in `site/public/admin/config.yml`, and every `canonical`,
   `hreflang` and `og:` URL in `site/index.html` and `site/ru/index.html`.
2. **GitLab repo path and OAuth app.** `backend.repo` and `backend.app_id`
   in `site/public/admin/config.yml`. Create the application under GitLab →
   User Settings → Applications with scope `api`.
3. **Worker name and route.** `name` in `worker/wrangler.jsonc`, plus the
   route above. Two people cannot both deploy `fareeditor-contact`.
4. **KV namespace.** `npx wrangler kv namespace create LEADS` and paste the
   new id into `worker/wrangler.jsonc`. (The committed `TODO` comment there
   is stale — an id is already filled in, and it is mine, not yours.) Note
   that this subcommand was spelled `kv:namespace create` before Wrangler
   3.60; on Wrangler 4, which this repo pins, it is `kv namespace create`.
   If in doubt, run `npx wrangler kv --help`.
5. **Secrets.** All three, via `wrangler secret put`. New Telegram bot, new
   chat, new Turnstile widget.
6. **Content.** `site/src/data/content/en.json` and
   `site/src/data/content/ru.json` in full, either directly or through the
   Decap CMS **Тексты сайта** collection. Do not translate one into the other
   — the whole point of the split is that the locales say different things.
7. **Works and media.** Delete `site/src/data/works/*.json` and everything
   in `site/public/media/works`, then add your own. Update
   `site/src/data/settings.json` (status text, showreel id, contact URLs).
8. **Form option keys.** If you change the choices in the project-type or
   budget selects, change them in **three** places: the `value` fields in
   both `site/src/data/content/*.json`, and the `PROJECT_TYPES` / `BUDGETS`
   arrays in `worker/src/index.js`. The Worker validates against those keys and
   returns `invalid_fields` for anything else. The visible labels are free to
   differ per locale — that is exactly why the selects submit stable keys
   rather than display text — but the keys must match on both sides. If you
   also want readable text in the Telegram notification and the KV archive,
   update `PROJECT_TYPE_LABELS` and `BUDGET_LABELS` alongside them.

### The two things that break a fork silently

- **The OAuth redirect URI must end in a slash:**
  `https://your-domain/admin/`, not `https://your-domain/admin`. GitLab
  matches it exactly, and the mismatch surfaces as a generic authorisation
  failure with nothing useful in the console.
- **The GitLab OAuth application must NOT be marked Confidential.** Untick
  it. PKCE is the flow for public clients; a confidential application expects
  a client secret that a browser-only CMS has no way to supply, and the token
  exchange will fail after the login appears to succeed.

A fork must replace all content and media with its own. See the licence
section — the copy, the works and the media in this repository are not
licensed for reuse.

## Contributing

This is one person's live site, not a library. Keep expectations calibrated
accordingly.

Bug reports and fixes to the **code** are welcome — open an issue or a merge
request. Changes to copy, works data or branding are not: that content is the
substance of the site, and it is final.

If you want your own version of this, fork it and follow the checklist above.
That is the right move, and no permission is needed for the code.

## Licence

Two regimes. `COPYRIGHT` is the authoritative statement; this is the summary.

### Code — GPL-3.0-or-later

Everything under `site/src` (except the content and data carve-outs below),
`worker/src`, and the build and CI configuration: `site/vite.config.js`,
`site/prerender.js`, both `index.html` documents,
`site/public/admin/config.yml`, `worker/wrangler.jsonc`, `.gitlab-ci.yml`.
Full text in `LICENSE`.

The practical consequence for a fork: a derivative work built from this code
must itself be released under GPL-3.0-or-later, with source available.

Third-party dependencies keep their own licences. The MIT-licensed
dependencies this project uses are compatible with GPL-3.0. The bundled fonts
(Inter, Manrope, JetBrains Mono) are under the SIL Open Font License 1.1.

### Content — all rights reserved

Every string in `site/src/data/content`, the works data in `site/src/data`,
everything under `site/public/media`, the showreel, and the FARE name and
wordmark. No licence is granted: not reusable, not adaptable, not
redistributable.

The reason is simple — part of this material was produced for clients and its
rights are theirs, so it is not mine to license.

`design/FARE_Landing_dc.html` is all rights reserved for the same reason: the
file embeds the complete `CONTENT` object for both locales and the full
`WORKS` array, which is the same copy covered above, so it cannot be
GPL-3.0. The markup and styles it demonstrates live under `site/src`, and
there they are GPL-3.0.
