# content-worker

Контент сайта в Cloudflare D1: схема, публичный read-only API, бэкап и сверка.
Отдельно от `worker/` (контакт-форма): тот живёт на `fareeditor.com/api/*`, этот — на
`fareeditor.com/data/*`. Запись в базу — только через админку (`admin-worker/`).

- База: `fareeditor-content`, binding `DB`, id — в `wrangler.jsonc`.
- **D1 — единственный источник данных сайта.** JSON-файлов в репозитории больше нет; контент
  правится из админки `admin.fareeditor.com`.
- Медиа лежат в R2 (`media.fareeditor.com`), в базе — только таблица `media` со ссылками.
- Скрипты — Node.js stdlib, без зависимостей (нужен Node.js 22.5+ ради `node:sqlite`).
  Для обращения к Cloudflare нужны `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` в окружении.

## Команды

Все — из `content-worker/`, после `npm ci`.

```sh
# Миграции (migrations/*.sql) в remote-базу
npx wrangler d1 migrations apply fareeditor-content --remote

# Сверка базы с бэкапом и проверка целостности данных
node scripts/verify.mjs --backup <d1-….sql>

# Проверка ограничений схемы на временной базе (создаётся из бэкапа и удаляется)
node scripts/verify.mjs --negative --seed <d1-….sql>
```

## Бэкап и восстановление

Бэкап — SQL-файл со схемой и данными всех таблиц. Хранить вне репозитория: в нём весь
контент сайта.

```sh
# Бэкап
npx wrangler d1 export fareeditor-content --remote --output <каталог>/d1-$(date +%Y%m%d-%H%M).sql

# Проверка бэкапа: восстановить во временную базу и сверить
npx wrangler d1 create fareeditor-content-restore-test
npx wrangler d1 execute fareeditor-content-restore-test --remote --yes --file <d1-….sql>
node scripts/verify.mjs --backup <d1-….sql> --db fareeditor-content-restore-test    # ждём PASS
npx wrangler d1 delete fareeditor-content-restore-test

# Что изменилось в production с момента бэкапа
node scripts/verify.mjs --backup <d1-….sql>
```

Восстановление production из файла — два пути:

1. **Новая база.** Создать базу, применить бэкап (`d1 execute --remote --file`), сверить
   (`verify.mjs --backup … --db <новая>`), затем вписать её `database_id` в `wrangler.jsonc`
   здесь и в `admin-worker/` и задеплоить оба Worker'а. Старая база остаётся нетронутой —
   путь обратим.
2. **Та же база.** Бэкап содержит `CREATE TABLE`, поэтому поверх существующих таблиц он не
   применится: сначала их нужно удалить. Это необратимо — только после свежего бэкапа и
   только если первый путь не подходит.

**D1 Time Travel** — восстановление базы на момент в прошлом без файла бэкапа. По документации
Cloudflare (developers.cloudflare.com/d1/reference/time-travel): включён всегда, глубина —
7 дней на Workers Free и 30 дней на Workers Paid, точность до минуты.

```sh
npx wrangler d1 time-travel info fareeditor-content                       # текущий bookmark
npx wrangler d1 time-travel info fareeditor-content --timestamp=<время>   # bookmark на момент
npx wrangler d1 time-travel restore fareeditor-content --timestamp=<время>
```

`restore` перезаписывает базу на месте. Команда печатает предыдущий bookmark — восстановление
на него отменяет операцию. Time Travel не заменяет файл: он ограничен по глубине и живёт
вместе с базой.

Отдельные записи возвращаются проще — через «Историю» в админке (таблица `revisions`).

## Первичная миграция (история)

`scripts/import.mjs` — скрипт, которым контент один раз перенесли из JSON-файлов в D1.
Его источника (`site/src/data`) в репозитории больше нет, а результат — **полная замена всех
таблиц**, то есть потеря всего, что отредактировано из админки. Для текущей работы он не нужен.

- Без `--apply` скрипт только пишет SQL в файл.
- С `--apply --db <база>` применяет его через wrangler. Для production-базы
  (`fareeditor-content`) он откажется без флага `--wipe-production-i-know-what-i-am-doing`.
- Источник JSON задаётся `--data`; взять его можно из среза `5976ed5`
  (`git worktree add ../portfolio-5976ed5 5976ed5`).

Свойства формата, выясненные при миграции и нужные до сих пор:

- `wrangler d1 execute --file` применяет файл целиком или не применяет вовсе: сбой на любой
  команде откатывает все предыдущие. Явные `BEGIN` / `COMMIT` D1 отклоняет.
- Необязательные строки (`blurb_*`, `subject_*`): в базе `NULL`, в API — пустая строка.

## Схема

`migrations/*.sql`. Локализуемые поля — `*_ru` / `*_en`; `order` из JSON → `sort_order`.
Внешние ключи в D1 включены (`PRAGMA foreign_keys` = 1).

## API

Только `GET` и `HEAD`; остальные методы — `405`, неизвестный путь — `404`, сбой D1 — `503`.
Same-origin, CORS-заголовков нет. Query-параметры игнорируются.

- `/data/hot.json` — `stats`, `categories` (с вложенными `works`), `testimonials`, `metricTypes`.
  Только опубликованное, категории без опубликованных работ отброшены.
- `/data/static.json` — `content` (`ru`, `en`), `settings` (плюс `before_after_enabled`,
  `beforeAfter`), `contacts`.

Имена полей — те, что читает фронтенд; маппинг столбцов D1 — `src/mapping.js`, общий с
админкой и проверками. Поля записей и форма документа `content` — `src/schema.js`.
`thumbnail`, `logo` — абсолютные URL медиа. `version` — хеш содержимого, он же `ETag`
(`If-None-Match` → `304`). Браузеру `max-age=0, must-revalidate`; на edge ответ лежит в
Cache API `EDGE_TTL_SECONDS` секунд (`wrangler.jsonc`), заголовок `X-Content-Cache: HIT|MISS`.

```sh
# Локально против production D1 (только SELECT)
npx wrangler dev --remote --port 8799

# Сверка API с бэкапом и HTTP-контракт. Ожидаемые ответы собираются из строк бэкапа,
# поэтому бэкап должен быть свежим: правки после него покажутся расхождением.
node scripts/check-api.mjs --base http://127.0.0.1:8799 --backup <d1-….sql>
node scripts/check-api.mjs --base https://fareeditor.com --backup <d1-….sql>

npx wrangler deploy
npx wrangler rollback            # предыдущая версия кода
```

Снять API с сайта целиком — убрать `routes` из `wrangler.jsonc` и задеплоить: `/data/*`
снова уйдёт в GitLab Pages (404).
