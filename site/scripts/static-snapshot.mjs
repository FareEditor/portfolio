// Снимок статичного контента: тексты обеих локалей, settings, contacts, before/after.
// Один запрос на сборку: `npm run build` запускает этот файл первым, он кладёт ответ
// API в .snapshot/static.json (вне git), а клиентская сборка, SSR-сборка и prerender.js
// читают уже файл — у всех трёх один и тот же снимок, гидрация совпадает с пререндером.
// Недоступный или битый API роняет сборку. Адрес переопределяется STATIC_DATA_URL.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FORM_OPTIONS } from '../src/formOptions.js';
import { noscriptScreen } from './noscript-screen.mjs';

export const SNAPSHOT_FILE = fileURLToPath(new URL('../.snapshot/static.json', import.meta.url));
const STATIC_DATA_URL = process.env.STATIC_DATA_URL || 'https://fareeditor.com/data/static.json';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export async function fetchSnapshot() {
  const fail = (reason) => new Error(
    `static-snapshot: статичный контент не получен или не прошёл проверку — ${reason} (${STATIC_DATA_URL}). ` +
    'Сборка остановлена. Проверьте Content Worker или задайте STATIC_DATA_URL.'
  );
  let data;
  try {
    const response = await fetch(STATIC_DATA_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    throw fail(error.message);
  }
  for (const locale of ['ru', 'en']) {
    if (!isObject(data?.content?.[locale])) throw fail(`content.${locale} — не объект`);
    // Ключи опций формы живут в коде, подписи — в контенте: опция без подписи дала бы пустую строку в селекте.
    for (const [field, values] of Object.entries(FORM_OPTIONS)) {
      const options = data.content[locale].contact?.[field];
      for (const value of values) {
        const label = Array.isArray(options) ? options.find((op) => op?.value === value)?.label : undefined;
        if (typeof label !== 'string' || !label.trim()) throw fail(`content.${locale}.contact.${field}: нет подписи для "${value}"`);
      }
    }
  }
  if (!isObject(data.settings)) throw fail('settings — не объект');
  if (!Array.isArray(data.contacts?.items)) throw fail('contacts.items — не список');
  // Экран для браузера без JS собирается из этого же снимка: без текста или без контактов
  // посетитель с выключенным JS увидел бы пустую страницу.
  for (const locale of ['ru', 'en']) {
    try { noscriptScreen(data, locale); } catch (error) { throw fail(`экран без JS: ${error.message}`); }
  }
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = await fetchSnapshot();
  mkdirSync(new URL('../.snapshot/', import.meta.url), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(data));
  console.log(`static snapshot: version ${data.version}`);
}
