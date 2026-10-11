-- Контент сайта: схема.
-- Локализуемые поля — пары *_ru / *_en. Обязательная строка = NOT NULL и не пустая,
-- как required в Decap. Необязательная — NULL, пустая строка не хранится.
-- slug: ^[a-z0-9-]+$  →  slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'
-- Время — ISO-8601 UTC. updated_at проставляет пишущий код: триггеров нет.

CREATE TABLE media (
  id           INTEGER PRIMARY KEY,
  kind         TEXT    NOT NULL CHECK (kind IN ('work', 'client', 'before', 'after')),
  r2_key       TEXT    NOT NULL UNIQUE CHECK (r2_key <> ''),
  url          TEXT    NOT NULL CHECK (url <> ''),
  sha256       TEXT    NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  bytes        INTEGER NOT NULL CHECK (bytes > 0),
  content_type TEXT    NOT NULL CHECK (content_type <> ''),
  width        INTEGER CHECK (width > 0),
  height       INTEGER CHECK (height > 0),
  duration_ms  INTEGER CHECK (duration_ms > 0),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE categories (
  slug       TEXT    PRIMARY KEY NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  published  INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  title_ru   TEXT    NOT NULL CHECK (title_ru <> ''),
  title_en   TEXT    NOT NULL CHECK (title_en <> ''),
  blurb_ru   TEXT    CHECK (blurb_ru <> ''),
  blurb_en   TEXT    CHECK (blurb_en <> ''),
  aspect     TEXT    NOT NULL DEFAULT '16:9' CHECK (aspect IN ('16:9', '9:12', '1:1', '4:5')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX categories_published_order ON categories (published, sort_order);

CREATE TABLE works (
  slug               TEXT    PRIMARY KEY NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  published          INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  category_slug      TEXT    NOT NULL REFERENCES categories (slug),
  featured           INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  sort_order         INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  client_ru          TEXT    NOT NULL CHECK (client_ru <> ''),
  client_en          TEXT    NOT NULL CHECK (client_en <> ''),
  format_ru          TEXT    NOT NULL CHECK (format_ru <> ''),
  format_en          TEXT    NOT NULL CHECK (format_en <> ''),
  duration_ru        TEXT    NOT NULL CHECK (duration_ru <> ''),
  duration_en        TEXT    NOT NULL CHECK (duration_en <> ''),
  title_ru           TEXT    NOT NULL CHECK (title_ru <> ''),
  title_en           TEXT    NOT NULL CHECK (title_en <> ''),
  body_ru            TEXT    NOT NULL CHECK (body_ru <> ''),
  body_en            TEXT    NOT NULL CHECK (body_en <> ''),
  -- ^[A-Za-z0-9_-]{11}$
  youtube_id         TEXT    NOT NULL CHECK (length(youtube_id) = 11 AND youtube_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  thumbnail_media_id INTEGER NOT NULL REFERENCES media (id),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX works_category_published_order ON works (category_slug, published, sort_order);

CREATE TABLE metric_types (
  slug       TEXT    PRIMARY KEY NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  label_ru   TEXT    NOT NULL CHECK (label_ru <> ''),
  label_en   TEXT    NOT NULL CHECK (label_en <> ''),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE testimonials (
  slug                TEXT    PRIMARY KEY NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  published           INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort_order          INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer'),
  channel_name        TEXT    NOT NULL CHECK (channel_name <> ''),
  quote_ru            TEXT    NOT NULL CHECK (quote_ru <> ''),
  quote_en            TEXT    NOT NULL CHECK (quote_en <> ''),
  channel_topic_ru    TEXT    NOT NULL CHECK (channel_topic_ru <> ''),
  channel_topic_en    TEXT    NOT NULL CHECK (channel_topic_en <> ''),
  logo_media_id       INTEGER REFERENCES media (id),
  top_metric_value    TEXT    NOT NULL CHECK (top_metric_value <> ''),
  top_metric_label_ru TEXT    NOT NULL CHECK (top_metric_label_ru <> ''),
  top_metric_label_en TEXT    NOT NULL CHECK (top_metric_label_en <> ''),
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX testimonials_published_order ON testimonials (published, sort_order);

-- Нижние метрики отзыва: metric_{1,2,3}_* из JSON, position = N.
CREATE TABLE testimonial_metrics (
  testimonial_slug TEXT    NOT NULL REFERENCES testimonials (slug) ON DELETE CASCADE,
  position         INTEGER NOT NULL CHECK (position IN (1, 2, 3)),
  metric_type_slug TEXT    NOT NULL REFERENCES metric_types (slug),
  value_ru         TEXT    NOT NULL CHECK (value_ru <> ''),
  value_en         TEXT    NOT NULL CHECK (value_en <> ''),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (testimonial_slug, position),
  UNIQUE (testimonial_slug, metric_type_slug)
);

-- Порядок = position, длина списка фиксирована раскладкой.
CREATE TABLE stats (
  position   INTEGER PRIMARY KEY CHECK (position IN (1, 2, 3, 4)),
  value_ru   TEXT    NOT NULL CHECK (value_ru <> ''),
  value_en   TEXT    NOT NULL CHECK (value_en <> ''),
  label_ru   TEXT    NOT NULL CHECK (label_ru <> ''),
  label_en   TEXT    NOT NULL CHECK (label_en <> ''),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE contacts (
  position   INTEGER PRIMARY KEY CHECK (position IN (1, 2, 3, 4)),
  kind       TEXT    NOT NULL CHECK (kind IN ('email', 'location', 'telegram', 'twitter')),
  label_ru   TEXT    NOT NULL CHECK (label_ru <> ''),
  label_en   TEXT    NOT NULL CHECK (label_en <> ''),
  value_ru   TEXT    NOT NULL CHECK (value_ru <> ''),
  value_en   TEXT    NOT NULL CHECK (value_en <> ''),
  subject_ru TEXT    CHECK (subject_ru <> ''),
  subject_en TEXT    CHECK (subject_en <> ''),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ровно одна строка.
CREATE TABLE settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  status_ru            TEXT    NOT NULL CHECK (status_ru <> ''),
  status_en            TEXT    NOT NULL CHECK (status_en <> ''),
  showreel_enabled     INTEGER NOT NULL DEFAULT 0 CHECK (showreel_enabled IN (0, 1)),
  showreel_id          TEXT    NOT NULL CHECK (showreel_id <> ''),
  contact_url_ru       TEXT    NOT NULL CHECK (contact_url_ru <> ''),
  contact_url_en       TEXT    NOT NULL CHECK (contact_url_en <> ''),
  before_after_enabled INTEGER NOT NULL DEFAULT 0 CHECK (before_after_enabled IN (0, 1)),
  before_media_id      INTEGER REFERENCES media (id),
  after_media_id       INTEGER REFERENCES media (id),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (before_after_enabled = 0 OR (before_media_id IS NOT NULL AND after_media_id IS NOT NULL))
);

-- Статичные тексты: один JSON-документ на локаль.
CREATE TABLE content (
  locale     TEXT PRIMARY KEY NOT NULL CHECK (locale IN ('ru', 'en')),
  doc        TEXT NOT NULL CHECK (json_valid(doc)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Снимок предыдущей версии строки. Заполняет админка; импорт таблицу не трогает.
CREATE TABLE revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL CHECK (table_name <> ''),
  row_key    TEXT NOT NULL CHECK (row_key <> ''),
  snapshot   TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
