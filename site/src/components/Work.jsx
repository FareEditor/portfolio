import { useRef, useState } from 'react';
import WorkCard from './WorkCard.jsx';

// Порог «показать все» применяется внутри активной категории, а не ко всей секции:
// длинная категория сворачивается, соседние короткие остаются целыми.
const VISIBLE_CAP = 6;
const CAP_FROM = 7;

// id связывают таб и панель в обе стороны (aria-controls / aria-labelledby).
// Строятся из slug: он уникален в коллекции categories и уже используется как ключ.
const tabId = (slug) => 'work-tab-' + slug;
const panelId = (slug) => 'work-panel-' + slug;

function CategoryPanel({ category, active, leaving, onLeft, watch, showAllLabel }) {
  const [showAll, setShowAll] = useState(false);
  const capped = category.works.length >= CAP_FROM && !showAll;
  const visible = capped ? category.works.slice(0, VISIBLE_CAP) : category.works;

  return (
    <div
      className="work-category"
      id={panelId(category.slug)}
      role="tabpanel"
      aria-labelledby={tabId(category.slug)}
      data-active={String(active)}
      data-leaving={leaving ? 'true' : undefined}
      // уходящая панель ещё видна на время fade, но уже не принимает
      // ни фокус, ни клики, и скринридер её не читает
      inert={leaving || undefined}
      // animationend всплывает от вложенных анимаций (пульс, спиннер) —
      // считается только собственная анимация панели
      onAnimationEnd={leaving ? (e) => { if (e.target === e.currentTarget) onLeft(); } : undefined}
    >
      {/* Заголовок категории остаётся в разметке: без JS он ведёт свой блок,
          с JS его визуальную роль берёт активный таб, а сам h3 уходит
          в невидимую для глаза, но читаемую скринридером подпись панели —
          иерархия h2 → h3 → h4 не рвётся ни в одном из режимов. */}
      <div className="work-category-head">
        <h3 className="work-category-title">{category.title}</h3>
        {category.blurb && <p className="work-category-blurb">{category.blurb}</p>}
      </div>

      <div className="work-grid">
        {visible.map((w) => (
          <WorkCard key={w.key} w={w} watch={watch} aspect={category.aspect} />
        ))}
      </div>

      {capped && (
        <div className="show-all-wrap">
          <button className="btn-secondary" type="button" onClick={() => setShowAll(true)}>{showAllLabel}</button>
        </div>
      )}
    </div>
  );
}

export default function Work({ c, categories, tabsLabel }) {
  const [activeSlug, setActiveSlug] = useState(categories[0] ? categories[0].slug : null);
  // Панель, которая гаснет во время cross-fade. Панели не размонтируются:
  // все живут в DOM, неактивные скрыты через data-active, поэтому состояние
  // внутри них («показать все») переживает смену таба.
  const [leavingSlug, setLeavingSlug] = useState(null);
  const tabRefs = useRef([]);

  const found = categories.findIndex((category) => category.slug === activeSlug);
  const current = found === -1 ? 0 : found;

  // Automatic activation по паттерну ARIA tabs: стрелка и переносит фокус,
  // и сразу открывает категорию — отдельного подтверждения не требуется.
  // Enter/Space обрабатывать не нужно: это <button>, он сам шлёт click.
  // Один вход для клика и клавиатуры: оба пути дают одинаковый cross-fade.
  const select = (slug) => {
    if (slug === activeSlug) return;
    setLeavingSlug(categories[current] ? categories[current].slug : null);
    setActiveSlug(slug);
  };

  const activate = (i) => {
    const next = (i + categories.length) % categories.length;
    select(categories[next].slug);
    const el = tabRefs.current[next];
    if (el) el.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); activate(current + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); activate(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); activate(0); }
    else if (e.key === 'End') { e.preventDefault(); activate(categories.length - 1); }
  };

  return (
    <section className="section section--work" id="work" aria-labelledby="work-title">
      <div className="section-head section-head--plain" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="work-title">{c.title}</h2>
      </div>

      {/* INTEGRATION: источник данных для работ — коллекции categories и works в Decap CMS */}
      {/* Табы — прогрессивное усиление: в разметке они есть всегда, но показываются
          только при работающем JS (класс .js-reveal на <html>). Без JS строка табов
          скрыта, а все категории идут одна под другой со своими заголовками. */}
      {categories.length > 0 && (
        <div className="work-tabs" role="tablist" aria-label={tabsLabel} onKeyDown={onKeyDown} data-reveal="true">
          {categories.map((category, i) => (
            <button
              key={category.slug}
              className="work-tab"
              type="button"
              role="tab"
              id={tabId(category.slug)}
              aria-controls={panelId(category.slug)}
              aria-selected={i === current ? 'true' : 'false'}
              tabIndex={i === current ? 0 : -1}
              ref={(el) => { tabRefs.current[i] = el; }}
              onClick={() => select(category.slug)}
            >
              {category.title}
            </button>
          ))}
        </div>
      )}

      <div className="work-panels">
        {categories.map((category, i) => (
          <CategoryPanel
            key={category.slug}
            category={category}
            active={i === current}
            leaving={category.slug === leavingSlug && i !== current}
            onLeft={() => setLeavingSlug(null)}
            watch={c.watch}
            showAllLabel={c.showAll}
          />
        ))}
      </div>
    </section>
  );
}
