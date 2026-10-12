# admin-worker

Админка сайта: интерфейс и API записи контента в D1 и медиа в R2. Отдельный Worker
`fareeditor-admin` на `admin.fareeditor.com`; публичный read-only API живёт в `content-worker/`
и отсюда не меняется.

- `src/` — Worker: авторизация, API, правила валидации.
- `ui/` — интерфейс (Vite + React, без UI-библиотек). Собирается в `public/`, откуда его раздаёт
  Worker как static assets. `public/` в репозитории нет: `wrangler dev` и `wrangler deploy`
  сами запускают `npm run build:ui` (`build.command` в `wrangler.jsonc`).

- Биндинги: D1 `DB` (`fareeditor-content`), R2 `MEDIA` (`fareeditor-media`).
- Схема полей, форма документа `content` и маппинг столбцов — общие с `content-worker/src`
  (`schema.js`, `mapping.js`), ключи опций формы — из `site/src/formOptions.js`.
- Правила валидации (`src/rules.js`, `src/media-rules.js`) — чистые модули: их импортирует и
  Worker, и интерфейс, проверка в браузере и на сервере — один код.
- Worker без зависимостей (Web Crypto); тесты на Node test runner. Токены и шрифты интерфейса —
  файлы сайта (`site/src/styles/tokens.css`, `site/src/fonts/`), внешних запросов нет.

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
`beforeAfter.*.url` — URL строки из `/api/media`. Каждая запись несёт `updated_at`; `content` —
`{ doc, updated_at }`.

Оптимистичная блокировка: `PUT` и `restore` принимают `expected_updated_at` (значение
`updated_at`, с которым запись получили). Если запись с тех пор изменилась — `409 conflict`,
ничего не записывается. `updated_at` в теле `PUT` не принимается.

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
| `/api/media` | `GET`, `POST` (тело — файл, см. ниже) |
| `/api/media/<id>` | `DELETE` |
| `/api/revisions?resource=<имя>&key=<ключ>` | `GET` |
| `/api/revisions/<id>/restore` | `POST` |
| `/api/publish` | `POST` |

Ошибки: `400 bad_json`, `403 forbidden`, `404 not_found`, `405`, `409 exists | in_use | conflict`,
`413 too_large`, `415`, `422 validation` с `fields: [{ field, message }]`, `429 too_soon`,
`502 publish_failed`.

Каждая запись — один `db.batch()`: проверка `expected_updated_at`, снимок прежней строки в
`revisions` (для создания — `null`) и само изменение с `updated_at`. `restore` — такая же запись.
Ревизии отдаются в формате API: `{ id, created_at, record }`. Медиа в ревизии не попадают.

Загрузка медиа: `POST /api/media?kind=&name=&sha256=&width=&height=[&duration_ms=]`,
`Content-Type: application/octet-stream`, тело — сам файл. sha256, размеры и длительность считает
браузер. Worker проверяет сигнатуру по первым байтам и передаёт тело в R2 потоком с ожидаемым
sha256: тело с другим хешем R2 отклоняет (`422`, поле `sha256`). В памяти Worker'а файл целиком
не оказывается, хеш в Worker'е не считается.

## Тесты

```sh
npm ci
npm test            # юнит-тесты; D1 — node:sqlite, R2 — в памяти
npm run build:ui    # сборка интерфейса в public/
npm run dev:ui      # интерфейс на Vite; /api проксируется на wrangler dev (порт 8798)
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
