# admin-worker

Admin API сайта: запись контента в D1 и медиа в R2. Отдельный Worker `fareeditor-admin` на
`admin.fareeditor.com`; публичный read-only API живёт в `content-worker/` и отсюда не меняется.
UI здесь пока нет: корень отдаёт заглушку из `public/`.

- Биндинги: D1 `DB` (`fareeditor-content`), R2 `MEDIA` (`fareeditor-media`).
- Схема полей, форма документа `content` и маппинг столбцов — общие с `content-worker/src`
  (`schema.js`, `mapping.js`), ключи опций формы — из `site/src/formOptions.js`.
- Без зависимостей: Web Crypto, тесты на Node test runner.

## Авторизация

Хост целиком закрыт Cloudflare Access. Каждый запрос к `/api/*` Worker проверяет сам, до любого
обращения к D1 и R2 (`src/auth.js`):

- токен только из заголовка `Cf-Access-Jwt-Assertion`, cookie не читается;
- `alg` ровно `RS256`, ключ по `kid` из JWKS Access (память изолята → Cache API → сеть; на
  неизвестный `kid` одна принудительная перезагрузка);
- `aud`, `iss`, `exp`/`nbf`/`iat` (допуск 60 с), `email` — из `vars` в `wrangler.jsonc`;
- `POST`/`PUT`/`PATCH`/`DELETE` — ещё и `Origin: https://admin.fareeditor.com`;
- любой отказ — `403 {"error":"forbidden"}`, причина только в журнале.

## API

Тела и ответы — JSON с именами полей публичного API. `thumbnail`, `logo`,
`beforeAfter.*.url` — URL строки из `/api/media`.

| Путь | Методы |
| --- | --- |
| `/api/me` | `GET` |
| `/api/categories`, `/api/works`, `/api/metric-types`, `/api/testimonials` | `GET`, `POST` |
| `…/<slug>` | `GET`, `PUT`, `DELETE` |
| `/api/stats`, `/api/contacts` | `GET` |
| `/api/stats/<1..4>`, `/api/contacts/<1..4>` | `GET`, `PUT` |
| `/api/settings` | `GET`, `PUT` |
| `/api/content` | `GET` |
| `/api/content/<ru\|en>` | `GET`, `PUT` |
| `/api/media` | `GET`, `POST` (multipart: `file`, `kind`) |
| `/api/media/<id>` | `DELETE` |
| `/api/revisions?resource=<имя>&key=<ключ>` | `GET` |
| `/api/revisions/<id>/restore` | `POST` |
| `/api/publish` | `POST` |

Ошибки: `400 bad_json`, `403 forbidden`, `404 not_found`, `405`, `409 exists | in_use | conflict`,
`413 too_large`, `415`, `422 validation` с `fields: [{ field, message }]`, `429 too_soon`,
`502 publish_failed`.

Каждая запись — один `db.batch()`: снимок прежней строки в `revisions` (для создания — `null`)
и само изменение с `updated_at`. `restore` — такая же запись. Медиа в ревизии не попадают.

## Тесты

```sh
npm ci
npm test            # юнит-тесты; D1 — node:sqlite, R2 — в памяти
```

Нужен манифест R2 (`MANIFEST`, по умолчанию `~/Documents/git/portfolio-audit/r2-manifest.json`):
тестовая база наполняется теми же данными, что `content-worker/scripts/import.mjs`.

Интеграционный прогон идёт в Cloudflare на временных ресурсах, production не затрагивает:

```sh
npx wrangler d1 create fareeditor-content-test      # id → env.test в wrangler.jsonc
npx wrangler r2 bucket create fareeditor-media-test
# миграции content-worker/migrations/*.sql и import.sql — через
#   npx wrangler d1 execute fareeditor-content-test --env test --remote --yes --file <файл>
npm run test:remote                                  # wrangler dev --remote --env test
npx wrangler d1 delete fareeditor-content-test
npx wrangler r2 bucket delete fareeditor-media-test
```

В окружении `test` JWKS подменяется переменной `TEST_JWKS_B64` (открытый ключ теста). В
production-сборке этого кода нет: `define` ставит `__TEST_AUTH__` в `false`, `minify` удаляет
ветку. Проверка: `npx wrangler deploy --dry-run --env="" --outdir <dir>` и поиск `TEST_JWKS_B64`.

## Деплой

```sh
npx wrangler d1 migrations apply fareeditor-content --remote   # из content-worker/
npx wrangler deploy --env=""
npx wrangler secret put GITLAB_TRIGGER_TOKEN --env=""          # один раз, владельцем
```
