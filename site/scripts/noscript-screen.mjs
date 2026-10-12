// Экран для браузера без JS: сайт закрыт целиком, остаются wordmark, текст и ссылки-контакты.
// Разметку собирает prerender.js и кладёт в <noscript> перед корнем — вне React, в бандл и в
// гидрацию она не попадает. Тексты — только из снимка контента: content.<locale>.noscript.banner,
// подписи и значения карточек контактов. Адреса ссылок строятся так же, как у карточек на
// странице (App.jsx): почта — mailto со своей темой, Telegram и X — из settings.
// Тот же код вызывает static-snapshot.mjs как проверку: нет текста или контакта — сборка падает.
const WORDMARK = 'FARE';
// Карточка «город» ссылки не имеет и на экран не попадает.
const KINDS = ['email', 'telegram', 'twitter'];

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const filled = (value) => typeof value === 'string' && value.trim() !== '';

export function noscriptLinks(snapshot, lang) {
  const en = lang === 'en';
  const urls = { telegram: snapshot.settings?.contact_url, twitter: snapshot.settings?.contact_url_en };
  return KINDS.map((kind) => {
    const item = snapshot.contacts?.items?.find((c) => c?.kind === kind);
    const label = item && (en ? item.label_en : item.label_ru);
    const value = item && (en ? item.value_en : item.value);
    if (!filled(label) || !filled(value)) throw new Error(`contacts: нет карточки "${kind}" с подписью и значением (${lang})`);
    const subject = en ? item.subject_en : item.subject_ru;
    const href = kind === 'email' ? `mailto:${value}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : urls[kind];
    if (!filled(href)) throw new Error(`settings: нет адреса для "${kind}"`);
    return { kind, label, value, href };
  });
}

export function noscriptScreen(snapshot, lang) {
  const text = snapshot.content?.[lang]?.noscript?.banner;
  if (!filled(text)) throw new Error(`content.${lang}.noscript.banner — пустая строка или не строка`);
  const links = noscriptLinks(snapshot, lang).map((link) =>
    `<li><a class="nojs-link" href="${escapeHtml(link.href)}"${link.kind === 'email' ? '' : ' target="_blank" rel="noopener noreferrer"'}>`
    + `<span class="nojs-link-label">${escapeHtml(link.label)}</span><span class="nojs-link-value">${escapeHtml(link.value)}</span></a></li>`).join('');
  // <style> внутри <noscript> браузер разбирает только при выключенных скриптах: при включённых
  // корень приложения виден как обычно, а всё содержимое noscript остаётся текстом.
  return '<noscript><style>#root{display:none}</style>'
    + `<div class="nojs"><p class="wordmark">${WORDMARK}</p><p class="nojs-text">${escapeHtml(text)}</p><ul class="nojs-links">${links}</ul></div></noscript>`;
}
