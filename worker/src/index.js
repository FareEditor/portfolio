// Контактная форма fareeditor.com: POST /api/contact и ничего больше.
// Воркер стоит на маршруте fareeditor.com/api/* — остальной трафик до него
// не доходит и обслуживается GitLab Pages напрямую.

const SITE_ORIGIN = "https://fareeditor.com";

// Селекты шлют стабильные ключи (value в site/src/data/content/{ru,en}.json),
// а не видимый текст: правка формулировок в контенте не может сломать приём заявок.
const PROJECT_TYPES = ["long_form", "motion_graphics", "series", "other"];
const BUDGETS = ["200_500", "500_1000", "1000_2000", "2000_plus"];

// Подписи только для уведомления и архива — валидация идёт по ключам,
// поэтому правка текста опций на сайте приём заявок не ломает.
// Формулировки повторяют русские опции формы.
const PROJECT_TYPE_LABELS = {
  long_form: "Длинный ролик (10+ минут)",
  motion_graphics: "Моушн-графика",
  series: "Серия роликов",
  other: "Другое"
};
const BUDGET_LABELS = {
  "200_500": "200–500 $",
  "500_1000": "500–1000 $",
  "1000_2000": "1000–2000 $",
  "2000_plus": "2000+ $"
};

const FIELD_CAPS = { name: 200, contact: 200, project_type: 100, budget: 100, message: 5000 };

// Rate limit: 5 заявок с одного IP в окне 10 минут. Счётчик в KV; каждый
// прошедший Turnstile запрос продлевает TTL окна. KV eventually consistent —
// для формы этого достаточно.
const RATE_MAX = 5;
const RATE_WINDOW_SECONDS = 600;

// 90 дней — ровно срок хранения, обещанный в микрокопи формы
const LEAD_TTL_SECONDS = 90 * 24 * 60 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}

async function verifyTurnstile(secret, token, ip) {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip })
  });
  if (!res.ok) return false;
  const outcome = await res.json();
  return outcome.success === true;
}

async function notifyTelegram(env, lead, key) {
  const text = [
    "Новая заявка с fareeditor.com",
    "",
    "Имя: " + lead.name,
    "Контакт: " + lead.contact,
    "Тип: " + lead.project_type_label,
    "Бюджет: " + lead.budget_label,
    "Страна: " + (lead.country || "??"),
    "",
    lead.message
  ].join("\n");
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
  if (!res.ok) {
    throw new Error("Telegram API " + res.status + ": " + (await res.text()).slice(0, 300));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Только POST /api/contact (плюс preflight для CORS)
    if (url.pathname !== "/api/contact") return json({ ok: false, error: "not_found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST, OPTIONS", ...CORS_HEADERS }
      });
    }

    try {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";

      // 2. Rate limit по IP: здесь только чтение и порог. Инкремент — после
      // Turnstile, чтобы протухший токен не сжигал попытки честного пользователя.
      const rateKey = "rl:" + ip;
      const count = parseInt((await env.LEADS.get(rateKey)) || "0", 10);
      if (count >= RATE_MAX) return json({ ok: false, error: "rate_limited" }, 429);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "bad_request" }, 400);
      }
      if (typeof body !== "object" || body === null) return json({ ok: false, error: "bad_request" }, 400);

      // 3. Honeypot: боту отвечаем «успехом» и молча выбрасываем заявку
      if (String(body.website || "").trim() !== "") return json({ ok: true });

      // 4. Turnstile: пустой токен и провал проверки — отказ
      const token = String(body["cf-turnstile-response"] || "").trim();
      if (!token || !(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
        return json({ ok: false, error: "turnstile_failed" }, 403);
      }

      // Turnstile пройден — теперь запрос считается попыткой
      await env.LEADS.put(rateKey, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS });

      // 5. Валидация: все поля обязательны, длины ограничены, селекты — из известных наборов
      const fields = {};
      for (const [name, cap] of Object.entries(FIELD_CAPS)) {
        const value = String(body[name] ?? "").trim();
        if (!value || value.length > cap) return json({ ok: false, error: "invalid_fields" }, 400);
        fields[name] = value;
      }
      if (!PROJECT_TYPES.includes(fields.project_type) || !BUDGETS.includes(fields.budget)) {
        return json({ ok: false, error: "invalid_fields" }, 400);
      }

      // 6. Сначала KV, потом Telegram: если Bot API лежит или токен протух,
      // заявка всё равно сохранена и восстановима. Обратный порядок молча теряет лиды.
      const receivedAt = new Date().toISOString();
      const key = "lead:" + receivedAt + ":" + crypto.randomUUID().slice(0, 8);
      const lead = {
        ...fields,
        // ключ + человекочитаемая подпись: архив читается без справочника
        project_type_label: PROJECT_TYPE_LABELS[fields.project_type],
        budget_label: BUDGET_LABELS[fields.budget],
        country: request.cf?.country ?? null,
        userAgent: request.headers.get("User-Agent") || "",
        receivedAt
      };
      await env.LEADS.put(key, JSON.stringify(lead), { expirationTtl: LEAD_TTL_SECONDS });

      // 7. Telegram: ошибка логируется, но клиенту всё равно успех — данные уже в KV
      try {
        await notifyTelegram(env, lead, key);
      } catch (err) {
        console.error(JSON.stringify({ event: "telegram_failed", key, error: String(err) }));
      }

      // 8. JSON + CORS только для origin сайта
      return json({ ok: true });
    } catch (err) {
      console.error(JSON.stringify({ event: "unhandled_error", error: String(err) }));
      return json({ ok: false, error: "internal_error" }, 500);
    }
  }
};
