// Схема контента в форме исходного JSON: поля коллекций и форма документа content.
// Общий модуль для scripts/import.mjs и админки (admin-worker). Без зависимостей от Node.

// Типы: text — обязательная строка; text? — необязательная ('' и отсутствие → NULL);
// int, bool; media / media? — путь /media/… → media.id через поле source манифеста.
export const COLLECTIONS = {
  categories: {
    slug: ['slug', 'text'],
    published: ['published', 'bool'],
    order: ['sort_order', 'int'],
    title_ru: ['title_ru', 'text'],
    title_en: ['title_en', 'text'],
    blurb_ru: ['blurb_ru', 'text?'],
    blurb_en: ['blurb_en', 'text?'],
    aspect: ['aspect', 'text'],
  },
  works: {
    slug: ['slug', 'text'],
    published: ['published', 'bool'],
    category: ['category_slug', 'text'],
    featured: ['featured', 'bool'],
    order: ['sort_order', 'int'],
    client: ['client_ru', 'text'],
    client_en: ['client_en', 'text'],
    format: ['format_ru', 'text'],
    format_en: ['format_en', 'text'],
    duration: ['duration_ru', 'text'],
    duration_en: ['duration_en', 'text'],
    title_ru: ['title_ru', 'text'],
    title_en: ['title_en', 'text'],
    body_ru: ['body_ru', 'text'],
    body_en: ['body_en', 'text'],
    youtube_id: ['youtube_id', 'text'],
    thumbnail: ['thumbnail_media_id', 'media'],
  },
  metric_types: {
    slug: ['slug', 'text'],
    order: ['sort_order', 'int'],
    label_ru: ['label_ru', 'text'],
    label_en: ['label_en', 'text'],
  },
  testimonials: {
    slug: ['slug', 'text'],
    published: ['published', 'bool'],
    order: ['sort_order', 'int'],
    channel_name: ['channel_name', 'text'],
    quote_ru: ['quote_ru', 'text'],
    quote_en: ['quote_en', 'text'],
    channel_topic_ru: ['channel_topic_ru', 'text'],
    channel_topic_en: ['channel_topic_en', 'text'],
    logo: ['logo_media_id', 'media?'],
    top_metric_value: ['top_metric_value', 'text'],
    top_metric_label_ru: ['top_metric_label_ru', 'text'],
    top_metric_label_en: ['top_metric_label_en', 'text'],
  },
  testimonial_metrics: {
    type: ['metric_type_slug', 'text'],
    value_ru: ['value_ru', 'text'],
    value_en: ['value_en', 'text'],
  },
  stats: {
    value: ['value_ru', 'text'],
    value_en: ['value_en', 'text'],
    label_ru: ['label_ru', 'text'],
    label_en: ['label_en', 'text'],
  },
  contacts: {
    kind: ['kind', 'text'],
    label_ru: ['label_ru', 'text'],
    label_en: ['label_en', 'text'],
    value: ['value_ru', 'text'],
    value_en: ['value_en', 'text'],
    subject_ru: ['subject_ru', 'text?'],
    subject_en: ['subject_en', 'text?'],
  },
  settings: {
    status: ['status_ru', 'text'],
    status_en: ['status_en', 'text'],
    showreel_enabled: ['showreel_enabled', 'bool'],
    showreel_id: ['showreel_id', 'text'],
    contact_url: ['contact_url_ru', 'text'],
    contact_url_en: ['contact_url_en', 'text'],
  },
};

// Форма документа content после удаления DROPPED: 's' — строка, [n, форма] — список ровно из n элементов.
const pair = (a, b) => ({ [a]: 's', [b]: 's' });
export const CONTENT_SHAPE = {
  cta: 's',
  menu: 's',
  nav: [4, 's'],
  hero: { title: 's', sub: 's', primary: 's', secondary: 's' },
  stats: { industries: 's' },
  testimonials: pair('eyebrow', 'title'),
  beforeAfter: { eyebrow: 's', title: 's', before: 's', after: 's' },
  work: { eyebrow: 's', title: 's', watch: 's', showAll: 's', play: 's', thumb: 's' },
  process: { eyebrow: 's', title: 's', steps: [3, { tc: 's', title: 's', body: 's' }] },
  why: { eyebrow: 's', title: 's', items: [4, pair('title', 'body')] },
  faq: { eyebrow: 's', title: 's', items: [6, pair('q', 'a')] },
  contact: {
    eyebrow: 's', title: 's', hint: 's', choose: 's', required: 's', button: 's', sending: 's',
    text: 's', success: 's', error: 's', micro: 's', noscript: 's',
    labels: { name: 's', contact: 's', project_type: 's', budget: 's', message: 's' },
    project_type: [4, pair('value', 'label')],
    budget: [4, pair('value', 'label')],
  },
  footer: { copy: 's', links: [3, pair('label', 'href')] },
  noscript: { banner: 's' },
};

// Все расхождения value с формой shape, в порядке обхода.
export function shapeErrors(value, shape, where) {
  if (shape === 's') return typeof value === 'string' ? [] : [`${where}: ожидалась строка`];
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length !== shape[0]) return [`${where}: ожидался список из ${shape[0]}`];
    return value.flatMap((item, i) => shapeErrors(item, shape[1], `${where}[${i}]`));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${where}: ожидался объект`];
  return [
    ...Object.keys(value).filter((key) => !(key in shape)).map((key) => `${where}.${key}: неизвестное поле`),
    ...Object.keys(shape).flatMap((key) =>
      (key in value ? shapeErrors(value[key], shape[key], `${where}.${key}`) : [`${where}.${key}: поле отсутствует`])),
  ];
}

// Первое расхождение — исключением: так форму проверяет импорт.
export function checkShape(value, shape, where) {
  const [first] = shapeErrors(value, shape, where);
  if (first) throw new Error(first);
}
