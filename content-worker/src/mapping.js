// Строка D1 → запись в форме исходного JSON (имена полей, которые читает фронтенд).
// Общий модуль для Worker и scripts/verify.mjs. Ссылки на медиа приходят аргументом:
// Worker подставляет media.url, сверка — исходный путь.

// 0/1 → boolean; любое другое значение останется как есть и даст расхождение при сверке.
export const bool = (v) => (v === 1 ? true : v === 0 ? false : v);

// Необязательные строки: в D1 NULL, в JSON пустая строка.
export const category = (r) => ({
  slug: r.slug, published: bool(r.published), order: r.sort_order,
  title_ru: r.title_ru, title_en: r.title_en,
  blurb_ru: r.blurb_ru ?? '', blurb_en: r.blurb_en ?? '', aspect: r.aspect,
});

export const metricType = (r) => ({
  slug: r.slug, order: r.sort_order, label_ru: r.label_ru, label_en: r.label_en,
});

export const work = (r, thumbnail) => ({
  slug: r.slug, published: bool(r.published), category: r.category_slug, featured: bool(r.featured),
  order: r.sort_order,
  client: r.client_ru, client_en: r.client_en,
  format: r.format_ru, format_en: r.format_en,
  duration: r.duration_ru, duration_en: r.duration_en,
  title_ru: r.title_ru, title_en: r.title_en, body_ru: r.body_ru, body_en: r.body_en,
  youtube_id: r.youtube_id, thumbnail,
});

// metrics — строки testimonial_metrics этого отзыва. Без логотипа ключа logo нет.
export const testimonial = (r, metrics, logo) => {
  const record = {
    slug: r.slug, published: bool(r.published), order: r.sort_order, channel_name: r.channel_name,
    quote_ru: r.quote_ru, quote_en: r.quote_en,
    channel_topic_ru: r.channel_topic_ru, channel_topic_en: r.channel_topic_en,
    top_metric_value: r.top_metric_value,
    top_metric_label_ru: r.top_metric_label_ru, top_metric_label_en: r.top_metric_label_en,
  };
  if (logo !== null) record.logo = logo;
  for (const m of metrics) {
    record[`metric_${m.position}_type`] = m.metric_type_slug;
    record[`metric_${m.position}_value_ru`] = m.value_ru;
    record[`metric_${m.position}_value_en`] = m.value_en;
  }
  return record;
};

export const stat = (r) => ({
  value: r.value_ru, value_en: r.value_en, label_ru: r.label_ru, label_en: r.label_en,
});

export const contact = (r) => ({
  kind: r.kind, label_ru: r.label_ru, label_en: r.label_en, value: r.value_ru, value_en: r.value_en,
  subject_ru: r.subject_ru ?? '', subject_en: r.subject_en ?? '',
});

export const settings = (r) => ({
  status: r.status_ru, status_en: r.status_en, showreel_enabled: bool(r.showreel_enabled),
  showreel_id: r.showreel_id, contact_url: r.contact_url_ru, contact_url_en: r.contact_url_en,
});
