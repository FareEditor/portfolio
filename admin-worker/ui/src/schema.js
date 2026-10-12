// Описание форм: какие поля у какого ресурса и как они подписаны. Имена ключей — имена полей API.
import { ASPECTS, CONTACT_KINDS } from '../../src/rules.js';
import { CONTACT_LABEL, KIND_LABEL } from './labels.js';

const pair = (label, ru, en, extra = {}) => ({ type: 'pair', label, ru, en, ...extra });
const text = (key, label, extra = {}) => ({ type: 'text', key, label, ...extra });
const slug = text('slug', 'Slug', { mono: true, once: true, hint: 'Строчные латинские буквы, цифры и дефис. После создания не меняется.' });
const published = (label) => ({ type: 'bool', key: 'published', label });
const order = { type: 'int', key: 'order', label: 'Порядок', hint: 'Меньше — выше в списке.' };
const metric = (n) => [
  { type: 'select', key: `metric_${n}_type`, label: `Метрика ${n}: тип`, source: 'metricTypes' },
  pair(`Метрика ${n}: значение`, `metric_${n}_value_ru`, `metric_${n}_value_en`),
];

export { CONTACT_LABEL, KIND_LABEL };

export const FORMS = {
  categories: {
    one: 'категория', title: (r) => r.title_ru, back: 'works',
    fields: [slug, published('Опубликована'), order, pair('Название', 'title_ru', 'title_en'),
      pair('Вводный текст', 'blurb_ru', 'blurb_en', { multiline: true, optional: true }),
      { type: 'select', key: 'aspect', label: 'Пропорция превью', options: ASPECTS.map((a) => [a, a]) }],
    blank: { slug: '', published: true, order: 10, title_ru: '', title_en: '', blurb_ru: '', blurb_en: '', aspect: '16:9' },
  },
  works: {
    one: 'работа', title: (r) => r.title_ru, back: 'works',
    fields: [slug, published('Опубликована'), { type: 'select', key: 'category', label: 'Категория', source: 'categories' },
      { type: 'bool', key: 'featured', label: 'Крупная карточка' }, order,
      pair('Название', 'title_ru', 'title_en'), pair('Клиент', 'client', 'client_en'), pair('Формат', 'format', 'format_en'),
      pair('Хронометраж', 'duration', 'duration_en'), pair('Описание', 'body_ru', 'body_en', { multiline: true }),
      text('youtube_id', 'YouTube id', { mono: true, hint: 'Ровно 11 символов из адреса ролика.' }),
      { type: 'media', key: 'thumbnail', label: 'Превью', kind: 'work' }],
    blank: { slug: '', published: true, category: '', featured: false, order: 10, client: '', client_en: '', format: '', format_en: '',
      duration: '', duration_en: '', title_ru: '', title_en: '', body_ru: '', body_en: '', youtube_id: '', thumbnail: '' },
  },
  'metric-types': {
    one: 'тип метрики', title: (r) => r.label_ru, back: 'metric-types',
    fields: [slug, order, pair('Подпись', 'label_ru', 'label_en')],
    blank: { slug: '', order: 10, label_ru: '', label_en: '' },
  },
  testimonials: {
    one: 'отзыв', title: (r) => r.channel_name, back: 'testimonials',
    fields: [slug, published('Опубликован'), order, text('channel_name', 'Канал'),
      { type: 'media', key: 'logo', label: 'Логотип', kind: 'client', optional: true },
      pair('Тематика канала', 'channel_topic_ru', 'channel_topic_en'), pair('Цитата', 'quote_ru', 'quote_en', { multiline: true }),
      text('top_metric_value', 'Верхняя метрика: значение'), pair('Верхняя метрика: подпись', 'top_metric_label_ru', 'top_metric_label_en'),
      ...metric(1), ...metric(2), ...metric(3)],
    blank: { slug: '', published: false, order: 10, channel_name: '', logo: '', channel_topic_ru: '', channel_topic_en: '', quote_ru: '', quote_en: '',
      top_metric_value: '', top_metric_label_ru: '', top_metric_label_en: '',
      metric_1_type: '', metric_1_value_ru: '', metric_1_value_en: '', metric_2_type: '', metric_2_value_ru: '', metric_2_value_en: '',
      metric_3_type: '', metric_3_value_ru: '', metric_3_value_en: '' },
  },
  stats: {
    one: 'показатель', title: (r) => r.label_ru, back: 'stats', fixed: true,
    fields: [pair('Значение', 'value', 'value_en'),
      pair('Подпись', 'label_ru', 'label_en', { hint: 'Длинная подпись может перенестись на вторую строку и сдвинуть сетку показателей.' })],
  },
  contacts: {
    one: 'контакт', title: (r) => r.label_ru, back: 'contacts', fixed: true,
    fields: [{ type: 'select', key: 'kind', label: 'Тип карточки', options: CONTACT_KINDS.map((k) => [k, CONTACT_LABEL[k]]) },
      pair('Подпись', 'label_ru', 'label_en'), pair('Значение', 'value', 'value_en'),
      pair('Тема письма', 'subject_ru', 'subject_en', { optional: true, hint: 'Только для карточки Email.' })],
  },
  settings: {
    one: 'настройки', title: () => 'Настройки', fixed: true, single: true,
    fields: [pair('Статус в шапке', 'status', 'status_en'),
      { type: 'bool', key: 'showreel_enabled', label: 'Показывать кнопку шоурила' },
      text('showreel_id', 'Шоурил: YouTube id', { mono: true, hint: 'Ровно 11 символов из адреса ролика.' }),
      pair('Ссылка для связи', 'contact_url', 'contact_url_en', { hint: 'RU — Telegram, EN — X.' }),
      { type: 'bool', key: 'before_after_enabled', label: 'Показывать сравнение «до / после»' },
      { type: 'media', key: 'before_url', label: 'Ролик «до»', kind: 'before', optional: true, errorKey: 'beforeAfter.before.url' },
      { type: 'media', key: 'after_url', label: 'Ролик «после»', kind: 'after', optional: true, errorKey: 'beforeAfter.after.url' }],
  },
};

// Запись API → значения формы и обратно. Различаются только настройки (вложенный beforeAfter),
// необязательный логотип и числа, которые в поле ввода живут строкой.
export function toValues(resource, record) {
  const { updated_at, beforeAfter, ...values } = record;
  if (resource === 'settings') { values.before_url = beforeAfter?.before.url ?? ''; values.after_url = beforeAfter?.after.url ?? ''; }
  if (resource === 'testimonials') values.logo ??= '';
  if ('order' in values) values.order = String(values.order);
  return values;
}

export function toBody(resource, values) {
  const body = { ...values };
  if ('order' in body) body.order = /^-?\d+$/.test(String(body.order).trim()) ? Number(body.order) : body.order;
  if (resource === 'settings') {
    const { before_url: before, after_url: after } = body;
    delete body.before_url; delete body.after_url;
    body.beforeAfter = before || after ? { before: { url: before }, after: { url: after } } : null;
  }
  if (resource === 'testimonials' && !body.logo) delete body.logo;
  return body;
}

// ---------- Документ content: подписи секций и полей

export const CONTENT_SECTIONS = {
  common: 'Шапка и меню', hero: 'Первый экран', stats: 'Показатели', beforeAfter: 'Сравнение «до / после»', work: 'Работы',
  testimonials: 'Отзывы', process: 'Процесс', why: 'Почему я', faq: 'FAQ', contact: 'Контактная форма', footer: 'Подвал', noscript: 'Без JavaScript',
};
// Подпись листа по последнему ключу пути; при совпадении ключей — по полному пути.
const LEAF = {
  cta: 'Кнопка в шапке', menu: 'Подпись кнопки меню', nav: 'Пункт меню', eyebrow: 'Надзаголовок', title: 'Заголовок', sub: 'Подзаголовок',
  primary: 'Основная кнопка', secondary: 'Кнопка шоурила', industries: 'Строка под показателями', before: 'Подпись «до»', after: 'Подпись «после»',
  watch: 'Ссылка на YouTube', showAll: 'Показать все', play: 'Подпись Play', thumb: 'Заглушка превью', tc: 'Таймкод', body: 'Текст',
  q: 'Вопрос', a: 'Ответ', hint: 'Подсказка у поля контакта', choose: 'Пункт «Выберите»', required: 'Обязательное поле', button: 'Кнопка отправки',
  sending: 'Отправка', text: 'Вводный текст', success: 'Успешная отправка', error: 'Ошибка отправки', micro: 'Уведомление о данных',
  noscript: 'Текст вместо формы без JavaScript', copy: 'Copyright', label: 'Подпись', href: 'Адрес ссылки', banner: 'Баннер на всю страницу',
  name: 'Поле «Имя»', contact: 'Поле «Контакт»', project_type: 'Поле «Тип проекта»', budget: 'Поле «Бюджет»', message: 'Поле «Описание»', value: 'Ключ опции',
};
const GROUP = { steps: 'Этап', items: 'Пункт', project_type: 'Тип проекта', budget: 'Бюджет', links: 'Ссылка', nav: 'Пункт меню', labels: 'Подписи полей' };
const LONG = ['sub', 'body', 'a', 'text', 'success', 'error', 'micro', 'noscript', 'banner'];

export const leafLabel = (path) => {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  const last = keys.at(-1);
  if (/^\d+$/.test(last)) return `${GROUP[keys.at(-2)] ?? 'Пункт'} ${Number(last) + 1}`;
  return LEAF[last] ?? last;
};
export const groupLabel = (key, index) => (index === undefined ? GROUP[key] ?? LEAF[key] ?? key : `${GROUP[key] ?? 'Пункт'} ${index + 1}`);
export const isLong = (path) => LONG.includes(path.split('.').at(-1));
export const isOptionKey = (path) => /^contact\.(project_type|budget)\[\d+\]\.value$/.test(path);
