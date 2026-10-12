# worker — контактная форма

Cloudflare Worker на маршруте `fareeditor.com/api/*`. Обрабатывает только
`POST /api/contact`: rate limit по IP → honeypot → Turnstile → валидация →
запись в KV (90 дней) → уведомление в Telegram.

## Первичная настройка

```bash
npm install
npx wrangler kv namespace create LEADS   # id вписать в wrangler.jsonc
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TURNSTILE_SECRET
npm run deploy
```

## Локальная разработка

```bash
cp .dev.vars.example .dev.vars   # заполнить значения; .dev.vars в git не попадает
npm run dev                      # wrangler dev на http://localhost:8787
```

Для локальных прогонов подходят тестовые ключи Turnstile: секрет
`1x0000000000000000000000000000000AA` принимает любой токен
(site key к нему — `1x00000000000000000000AA`).

Vite-дев-сервер сайта проксирует `/api` на порт 8787 (см. `site/vite.config.js`),
так что форма работает и локально.

`project_type` и `budget` — стабильные ключи, а не подписи: `PROJECT_TYPES` и `BUDGETS` в
`src/index.js`. Те же ключи продублированы в `site/src/formOptions.js`; сборка сайта
сверяет два списка (`site/scripts/check-form-options.mjs`).

## Проверка эндпоинта

```bash
curl -i http://localhost:8787/api/contact \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Тест",
    "contact": "@test",
    "project_type": "motion_graphics",
    "budget": "200_500",
    "message": "Проверка формы с локального wrangler dev",
    "website": "",
    "cf-turnstile-response": "dummy-token"
  }'
```

Ожидаемый ответ — `200 {"ok":true}` (с тестовым секретом Turnstile).
Заполненный `website` (honeypot) тоже вернёт `{"ok":true}`, но заявка будет
отброшена. Шестой запрос с одного IP за 10 минут получит `429`.
