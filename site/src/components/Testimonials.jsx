import { useRef, useState } from 'react';

// Лента прокручивается нативным scroll-snap; кнопки только двигают scrollLeft.
// Библиотека карусели не нужна — состояние ленты живёт в самом элементе.
export default function Testimonials({ c, items, navLabels }) {
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
  if (!items.length) return null;

  return (
    <section className="section section--testimonials" aria-labelledby="testimonials-title">
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

      {/* data-reveal на ленте, а не на карточках: правило появления
          .js-reveal [data-reveal][data-revealed="1"] фиксирует transform:none
          со специфичностью (0,3,0) и заглушило бы hover-масштаб карточки. */}
      <ul className="testimonial-track" id="testimonials-track" ref={trackRef} data-reveal="true">
        {items.map((t) => (
          <li className="testimonial card--interactive" key={t.slug}>
            {t.logo && <img className="testimonial-logo" src={t.logo} alt="" loading="lazy" decoding="async" width="88" height="88" />}
            <p className="testimonial-name">{t.channel_name}</p>
            <p className="testimonial-role">{t.role}</p>
            <p className="testimonial-quote">{t.quote}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
