# content-worker

Контент сайта в Cloudflare D1: схема, импорт из JSON, сверка и публичный read-only API.
Отдельно от `worker/` (контакт-форма): тот живёт на `fareeditor.com/api/*`, этот — на
`fareeditor.com/data/*`.

- База: `fareeditor-content`, binding `DB`, id — в `wrangler.jsonc`.
- Медиа лежат в R2 (`media.fareeditor.com`), в базе — только таблица `media` со ссылками.
- Скрипты — Node.js stdlib, без зависимостей. Нужны `CLOUDFLARE_API_TOKEN` и
  `CLOUDFLARE_ACCOUNT_ID` в окружении.

## Команды

Все — из `content-worker/`, после `npm ci`.

```sh
# Миграции (migrations/*.sql) в remote-базу
npx wrangler d1 migrations apply fareeditor-content --remote

# Импорт: SQL генерируется вне репозитория, затем применяется
node scripts/import.mjs --manifest ~/Documents/git/portfolio-audit/r2-manifest.json \
  --out ~/Documents/git/portfolio-audit/import.sql
npx wrangler d1 execute fareeditor-content --remote --yes \
  --file ~/Documents/git/portfolio-audit/import.sql

# Сверка D1 ↔ site/src/data
node scripts/verify.mjs --manifest ~/Documents/git/portfolio-audit/r2-manifest.json

# Проверка ограничений схемы на временной базе (создаётся и удаляется)
node scripts/verify.mjs --negative --seed ~/Documents/git/portfolio-audit/import.sql
```

## Импорт

- Источник — `site/src/data/**` (путь меняется через `--data`) и манифест R2.
- Полная замена всех таблиц, кроме `revisions`: `DELETE` в порядке, обратном FK, затем `INSERT`.
  Повторный запуск даёт то же состояние; `created_at` / `updated_at` при этом обновляются.
- `wrangler d1 execute --file` применяет файл целиком или не применяет вовсе: сбой на любой
  команде откатывает все предыдущие. Явные `BEGIN` / `COMMIT` D1 отклоняет.
- Неизвестное поле в JSON — ошибка. Отброшенные поля перечислены в `DROPPED`
  (`scripts/import.mjs`); сейчас это `work.motionTitle` в документах `content`.
- Необязательные строки (`blurb_*`, `subject_*`): пустая строка и отсутствие поля → `NULL`.
- `thumbnail` / `logo` сопоставляются с `media` по исходному пути (`source` в манифесте),
  не по ключу R2.

## Схема

`migrations/0001_init.sql`. Локализуемые поля — `*_ru` / `*_en`; `order` из JSON → `sort_order`.
Внешние ключи в D1 включены (`PRAGMA foreign_keys` = 1).

## API

Только `GET` и `HEAD`; остальные методы — `405`, неизвестный путь — `404`, сбой D1 — `503`.
Same-origin, CORS-заголовков нет. Query-параметры игнорируются.

- `/data/hot.json` — `stats`, `categories` (с вложенными `works`), `testimonials`, `metricTypes`.
  Только опубликованное, категории без работ отброшены — как `site/src/data/works.js`.
- `/data/static.json` — `content` (`ru`, `en`), `settings` (плюс `before_after_enabled`,
  `beforeAfter`), `contacts`.

Имена полей — как в исходных JSON; маппинг столбцов D1 — `src/mapping.js`, общий со сверкой.
`thumbnail`, `logo` — абсолютные URL медиа. `version` — хеш содержимого, он же `ETag`
(`If-None-Match` → `304`). Браузеру `max-age=0, must-revalidate`; на edge ответ лежит в
Cache API `EDGE_TTL_SECONDS` секунд (`wrangler.jsonc`), заголовок `X-Content-Cache: HIT|MISS`.

```sh
# Локально против production D1 (только SELECT)
npx wrangler dev --remote --port 8799

# Сверка API ↔ site/src/data и HTTP-контракт
node scripts/check-api.mjs --base http://127.0.0.1:8799 \
  --manifest ~/Documents/git/portfolio-audit/r2-manifest.json
node scripts/check-api.mjs --base https://fareeditor.com \
  --manifest ~/Documents/git/portfolio-audit/r2-manifest.json

npx wrangler deploy
npx wrangler rollback            # предыдущая версия кода
```

Снять API с сайта целиком — убрать `routes` из `wrangler.jsonc` и задеплоить: `/data/*`
снова уйдёт в GitLab Pages (404).
