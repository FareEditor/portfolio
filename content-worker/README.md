# content-worker

Контент сайта в Cloudflare D1: схема, импорт из JSON и сверка. Отдельно от `worker/`
(контакт-форма). Сам Worker пока заглушка (`src/index.js` отвечает 404), routes нет,
**не деплоится**.

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
