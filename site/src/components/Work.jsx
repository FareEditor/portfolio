import { useEffect, useRef, useState } from 'react';
import WorkCard, { ASPECT_CLASS, DEFAULT_ASPECT } from './WorkCard.jsx';

// Порог «показать все» применяется внутри активной категории, а не ко всей секции:
// длинная категория сворачивается, соседние короткие остаются целыми.
const VISIBLE_CAP = 6;
const CAP_FROM = 7;

// id связывают таб и панель в обе стороны (aria-controls / aria-labelledby).
// Строятся из slug: он уникален в коллекции categories и уже используется как ключ.
const tabId = (slug) => 'work-tab-' + slug;
const panelId = (slug) => 'work-panel-' + slug;

function CategoryPanel({ category, active, phase, watch, showAllLabel }) {
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
      data-phase={phase}
      // уходящая панель ещё видна, пока гаснут карточки, но уже не принимает
      // ни фокус, ни клики, и скринридер её не читает
      inert={phase === 'exit' || undefined}
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

// Смена категории — три этапа по референсу владельца: карточки старой
// категории уходят вверх (exit), вкладки перекрашиваются, карточки новой
// приходят снизу (enter). Цвет вкладки идёт от aria-selected сразу по клику,
// а задержку и темп перекраски даёт CSS (data-switching на tablist).
// Конец каждой фазы — завершение её keyframes на элементах панели
// (getAnimations → finished), а не таймер: не зависит от числа карточек,
// не ловит чужие вложенные анимации и при prefers-reduced-motion (0.001ms)
// проходит за кадр. Стаггер задаёт CSS через --i.
// Клик во время exit переназначает цель — панель сменится на последнюю
// выбранную. Клик во время enter ждёт его конца, затем запускает новый exit:
// так ни одна карточка не прыгает из середины подъёма обратно в видимость.
const PHASE_ANIMATION = { exit: 'fare-card-out', enter: 'fare-card-in' };

const BLANK = '\u00a0';

// Заглушка до прихода /data/hot.json. Форму запекает сборка (prerender.js): число
// вкладок, пропорция превью и число карточек первой категории. Текста нет; строки
// держат высоту неразрывным пробелом в элементах с теми же классами, что у карточки.
// Число строк текста — оценка: длину заголовков и описаний форма не знает, поэтому
// высота секции совпадает с настоящей приблизительно, а не точно.
// Пять детей .work-card — те же пять строк subgrid, что у WorkCard.
function WorkSkeleton({ shape }) {
  const thumbClass = 'work-thumb skel ' + (ASPECT_CLASS[shape.categories[0]] || ASPECT_CLASS[DEFAULT_ASPECT]);
  return (
    <>
      <div className="work-tabs" data-reveal="true" aria-hidden="true">
        {shape.categories.map((_, i) => <span className="work-tab skel" key={i}>{BLANK}</span>)}
      </div>
      <div className="work-panels" aria-hidden="true">
        <div className="work-category">
          <div className="work-category-head">
            <p className="work-category-blurb skel">{BLANK}<br />{BLANK}</p>
          </div>
          <div className="work-grid">
            {Array.from({ length: shape.works }, (_, i) => (
              <div className="work-card" data-reveal="card" key={i}>
                <div className={thumbClass}></div>
                <div className="work-title skel">{BLANK}<br />{BLANK}</div>
                <div className="work-meta skel">{BLANK}</div>
                <div className="work-text skel">{BLANK}<br />{BLANK}<br />{BLANK}<br />{BLANK}</div>
                <div className="work-link skel">{BLANK}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Секция целиком: заголовок из статичных текстов есть всегда, под ним — заглушка
// или вкладки с панелями. WorkTabs монтируется уже с данными, поэтому начальная
// категория выставляется его useState без фаз exit/enter.
export default function Work({ c, categories, tabsLabel, loading, shape }) {
  return (
    <section className="section section--work" id="work" aria-labelledby="work-title" data-hot={loading ? 'loading' : 'ready'} aria-busy={loading || undefined}>
      <div className="section-head section-head--plain" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="work-title">{c.title}</h2>
      </div>
      {loading
        ? <WorkSkeleton shape={shape} />
        : <WorkTabs c={c} categories={categories} tabsLabel={tabsLabel} />}
    </section>
  );
}

function WorkTabs({ c, categories, tabsLabel }) {
  const first = categories[0] ? categories[0].slug : null;
  // selected — вкладка (aria-selected, фокус, цвет); shown — панель на экране.
  // Панели не размонтируются: все живут в DOM, неактивные скрыты через
  // data-active, поэтому состояние внутри них («показать все») сохраняется.
  const [selected, setSelected] = useState(first);
  const [shown, setShown] = useState(first);
  const [phase, setPhase] = useState('idle');
  // вкладка, с которой началась смена: гаснет только она
  const [from, setFrom] = useState(null);
  const selectedRef = useRef(first);
  selectedRef.current = selected;
  const shownRef = useRef(first);
  shownRef.current = shown;
  const panelsRef = useRef(null);
  const tabRefs = useRef([]);

  const indexOf = (slug) => { const i = categories.findIndex((category) => category.slug === slug); return i === -1 ? 0 : i; };
  const current = indexOf(selected);
  const shownIndex = indexOf(shown);

  useEffect(() => {
    if (phase === 'idle') return undefined;
    const root = panelsRef.current;
    const panel = root && root.querySelector('.work-category[data-phase]');
    if (phase === 'enter' && panel) {
      // карточки новой панели считаются проявленными: иначе после enter они
      // вернулись бы к скрытому состоянию reveal и проиграли его второй раз
      panel.querySelectorAll('[data-reveal]').forEach((el) => { el.dataset.revealed = '1'; });
    }
    const name = PHASE_ANIMATION[phase];
    // Без Web Animations API (getAnimations) ждать нечего: фаза завершается
    // сразу, без исключения — смена категории остаётся мгновенной.
    const running = panel && typeof panel.getAnimations === 'function' ? panel.getAnimations({ subtree: true }).filter((a) => a.animationName === name) : [];
    let cancelled = false;
    Promise.all(running.map((a) => a.finished.catch(() => {}))).then(() => {
      if (cancelled) return;
      if (phase === 'exit') {
        // обе группы невидимы: старая догасла (fill forwards), новая стоит
        // в начальной точке enter (fill backwards) — смена панели и прыжок
        // высоты секции приходятся на этот кадр
        setShown(selectedRef.current);
        setPhase('enter');
      } else {
        const again = selectedRef.current !== shownRef.current;
        setFrom(again ? shownRef.current : null);
        setPhase(again ? 'exit' : 'idle');
      }
    });
    return () => { cancelled = true; };
  }, [phase, shown]);

  // Automatic activation по паттерну ARIA tabs: стрелка и переносит фокус,
  // и сразу открывает категорию — отдельного подтверждения не требуется.
  // Enter/Space обрабатывать не нужно: это <button>, он сам шлёт click.
  // Один вход для клика и клавиатуры: оба пути дают одну и ту же смену.
  const select = (slug) => {
    setSelected(slug);
    // при prefers-reduced-motion — сразу, без фаз: иначе между догасшим exit
    // и сменой панели оставался бы пустой кадр
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(slug); setPhase('idle'); return; }
    if (phase === 'idle' && slug !== shown) { setFrom(shown); setPhase('exit'); }
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
    <>
      {/* INTEGRATION: источник данных для работ — categories в /data/hot.json (Content Worker) */}
      {/* Табы — прогрессивное усиление: в разметке они есть всегда, но показываются
          только при работающем JS (класс .js-reveal на <html>). Без JS строка табов
          скрыта, а все категории идут одна под другой со своими заголовками. */}
      {categories.length > 0 && (
        <div className="work-tabs" role="tablist" aria-label={tabsLabel} onKeyDown={onKeyDown} data-reveal="true" data-switching={phase !== 'idle' ? 'true' : undefined}>
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
              data-from={phase !== 'idle' && category.slug === from ? 'true' : undefined}
              ref={(el) => { tabRefs.current[i] = el; }}
              onClick={() => select(category.slug)}
            >
              {category.title}
            </button>
          ))}
        </div>
      )}

      <div className="work-panels" ref={panelsRef}>
        {categories.map((category, i) => (
          <CategoryPanel
            key={category.slug}
            category={category}
            active={i === shownIndex}
            phase={i === shownIndex && phase !== 'idle' ? phase : undefined}
            watch={c.watch}
            showAllLabel={c.showAll}
          />
        ))}
      </div>
    </>
  );
}
