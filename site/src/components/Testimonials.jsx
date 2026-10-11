import { useRef, useState } from 'react';

// Лента прокручивается нативным scroll-snap; кнопки только двигают scrollLeft.
// Библиотека карусели не нужна — состояние ленты живёт в самом элементе.
const BLANK = '\u00a0';

// loading — данные ещё не пришли: шапка секции и лента те же, в ленте одна карточка-заглушка.
export default function Testimonials({ c, items, navLabels, loading }) {
  const trackRef = useRef(null);
  // 0 — покой, -1/1 — какая кнопка сейчас отказывает
  const [shake, setShake] = useState(0);

  const move = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const card = track.firstElementChild;
    // шаг = карточка + зазор, чтобы клик сдвигал ровно на одну
    const step = card ? card.offsetWidth + parseFloat(getComputedStyle(track).columnGap || 0) : track.clientWidth;
    // Программный скролл не смотрит на prefers-reduced-motion сам — спрашиваем явно
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const atEnd = track.scrollLeft >= max - 1;
    const atStart = track.scrollLeft <= 1;

    if (max <= 1) { setShake(dir); return; }            // лента не скроллится — только отказ
    if (dir > 0 && atEnd) { setShake(dir); track.scrollTo({ left: 0, behavior }); return; }
    if (dir < 0 && atStart) { setShake(dir); track.scrollTo({ left: max, behavior }); return; }
    track.scrollBy({ left: dir * step, behavior });
  };

  const navClass = (dir) =>
    'testimonial-nav card--interactive card--no-action' + (shake === dir ? ' is-shaking' : '');

  // Ранний выход после хуков: порядок вызовов обязан быть одинаковым в каждом
  // рендере. Нет опубликованных отзывов — нет и секции, ни заголовка, ни ленты.
  if (!loading && !items.length) return null;

  return (
    <section className="section section--testimonials" aria-labelledby="testimonials-title" data-hot={loading ? 'loading' : 'ready'} aria-busy={loading || undefined}>
      <div className="section-head testimonials-head" data-reveal="true">
        <div className="testimonials-title-group">
          <span className="eyebrow">{c.eyebrow}</span>
          <h2 className="section-title" id="testimonials-title">{c.title}</h2>
        </div>
        <div className="testimonials-nav-group">
          {[-1, 1].map((dir) => (
            <button
              key={dir}
              type="button"
              className={navClass(dir)}
              aria-label={dir < 0 ? navLabels.prev : navLabels.next}
              aria-controls="testimonials-track"
              onClick={() => move(dir)}
              onAnimationEnd={() => setShake(0)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d={dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* data-reveal="card" на самих карточках: вариант card движет
          свойством translate и animation, transform и transition hover-зума
          .card--interactive остаются нетронутыми. */}
      <ul className="testimonial-track" id="testimonials-track" ref={trackRef}>
        {loading && (
          <li className="testimonial card--interactive" data-reveal="card" aria-hidden="true">
            <div className="testimonial-head">
              <span className="testimonial-logo skel"></span>
              <div className="testimonial-id">
                <p className="testimonial-name skel">{BLANK}</p>
                <p className="testimonial-topic skel">{BLANK}</p>
              </div>
            </div>
            <p className="testimonial-top-value skel">{BLANK}</p>
            <p className="testimonial-top-label skel">{BLANK}</p>
            <p className="testimonial-quote skel">{BLANK}<br />{BLANK}<br />{BLANK}<br />{BLANK}<br />{BLANK}<br />{BLANK}<br />{BLANK}</p>
            <ul className="testimonial-metrics">
              {[0, 1, 2].map((i) => (
                <li className="testimonial-metric" key={i}>
                  <p className="testimonial-metric-value skel">{BLANK}</p>
                  <p className="testimonial-metric-label skel">{BLANK}</p>
                </li>
              ))}
            </ul>
          </li>
        )}
        {items.map((t) => (
          <li className="testimonial card--interactive" key={t.slug} data-reveal="card">
            <div className="testimonial-head">
              {t.logo && <img className="testimonial-logo" src={t.logo} alt="" loading="lazy" decoding="async" width="88" height="88" />}
              <div className="testimonial-id">
                <p className="testimonial-name">{t.channel_name}</p>
                {t.topic && <p className="testimonial-topic">{t.topic}</p>}
              </div>
            </div>

            {/* Главный результат: тот же приём, что у плашек статистики —
                крупное число, тихая подпись под ним. */}
            <p className="testimonial-top-value">{t.topMetricValue}</p>
            <p className="testimonial-top-label">{t.topMetricLabel}</p>

            <p className="testimonial-quote">{t.quote}</p>

            {/* Три нижние метрики — перечень пар «значение / тип», поэтому ul.
                Подпись берётся из справочника metric-types по slug. */}
            <ul className="testimonial-metrics">
              {t.metrics.map((m) => (
                <li className="testimonial-metric" key={m.type}>
                  <p className="testimonial-metric-value">{m.value}</p>
                  <p className="testimonial-metric-label">{m.label}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
