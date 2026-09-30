import { useEffect, useRef, useState } from 'react';

function LangSwitch({ langLinks, onLangSwitch }) {
  return (
    /* INTEGRATION: в продакшене переключатель — переход между / и /ru/ + запись выбора в localStorage */
    /* role="group" снят: группа без доступного имени объявляется скринридером
       как пустая «группа» и ничего не сообщает; две ссылки понятны сами по себе */
    <div className="lang-switch">
      {langLinks.map((lb, i) => (
        <span key={lb.code}>
          {i > 0 && <span className="lang-sep" aria-hidden="true">/</span>}
          <a
            className="lang-btn"
            href={lb.href}
            aria-current={lb.active ? "true" : undefined}
            onClick={(e) => onLangSwitch(e, lb)}
          >
            {lb.label}
          </a>
        </span>
      ))}
    </div>
  );
}

// aria-current="location": текущее место внутри одной страницы (in-page
// навигация), а не текущая страница из набора ("page") и не безымянное
// "true", которым помечен активный язык.
// Закрытие ждёт конца этих keyframes: гаснут пункты и панель, поверхность
// схлопывается в капсулу, и только затем снимается open. Поверхность и
// обводка — псевдоэлементы капсулы, поэтому поиск идёт по поддереву.
const MENU_OUT = ['fare-menu-surface-out', 'fare-menu-stroke-out', 'fare-menu-panel-out'];
const DESKTOP = '(min-width: 821px)';

export default function Header({ wordmark, navItems, langLinks, cta, menuLabel, onLangSwitch, onNavigate }) {
  // <details> открывается без JS. Эффекты ниже добавляют то, чего нативное
  // поведение не даёт: анимацию закрытия, Escape, возврат фокуса, inert
  // на фоне и блокировку прокрутки.
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const detailsRef = useRef(null);
  const summaryRef = useRef(null);

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Форма капсулы для роста поверхности — вычисленная величина, а не
  // оформление: уходит в CSS-переменные тем же приёмом, что --playhead.
  // Переменные лежат на самой капсуле: их читают её псевдоэлементы и панель.
  const capsuleOf = () => detailsRef.current && detailsRef.current.closest('.header-inner');
  const measureCapsule = () => {
    const capsule = capsuleOf();
    if (!capsule) return;
    const r = capsule.getBoundingClientRect();
    capsule.style.setProperty('--cap-t', r.top + 'px');
    capsule.style.setProperty('--cap-l', r.left + 'px');
    capsule.style.setProperty('--cap-r', (document.documentElement.clientWidth - r.right) + 'px');
    capsule.style.setProperty('--cap-h', r.height + 'px');
  };

  // Мгновенное закрытие — и цель анимированного, и запасной путь: если
  // анимации нет или она не завершилась, меню не зависает открытым.
  const closeNow = () => {
    setClosing(false);
    if (detailsRef.current) detailsRef.current.open = false;
    setMenuOpen(false);
  };
  const close = () => {
    const d = detailsRef.current;
    if (!d || !d.open) return;
    if (reduceMotion()) { closeNow(); return; }
    measureCapsule();
    setClosing(true);
  };

  // Тап по кнопке: закрыть с анимацией; тап во время закрытия — передумать и
  // оставить меню открытым; тап по закрытому — нативное открытие.
  const onSummaryClick = (e) => {
    const d = detailsRef.current;
    if (!d) return;
    if (!d.open) { measureCapsule(); return; }
    e.preventDefault();
    if (closing) setClosing(false); else close();
  };

  useEffect(() => {
    if (!closing) return undefined;
    const capsule = capsuleOf();
    const running = capsule ? capsule.getAnimations({ subtree: true }).filter((a) => MENU_OUT.includes(a.animationName)) : [];
    let cancelled = false;
    Promise.all(running.map((a) => a.finished.catch(() => {}))).then(() => { if (!cancelled) closeNow(); });
    return () => { cancelled = true; };
  }, [closing]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Фон за панелью недоступен ни для Tab, ни для скринридера: inert на всех
    // соседях шапки (main, footer, playhead, кнопка «наверх», плеер).
    const header = detailsRef.current && detailsRef.current.closest('.site-header');
    const background = header ? [...header.parentElement.children].filter((el) => el !== header && !el.inert) : [];
    background.forEach((el) => { el.inert = true; });

    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      close();
      if (summaryRef.current) summaryRef.current.focus();
    };
    document.addEventListener('keydown', onKeyDown);

    // На десктопной ширине бургера нет — открытое меню снимается сразу,
    // вместе с inert и блокировкой прокрутки.
    const desktop = window.matchMedia(DESKTOP);
    const onDesktop = () => { if (desktop.matches) closeNow(); };
    desktop.addEventListener('change', onDesktop);

    // Поворот и resize при открытом меню: полоса шапки и верх панели
    // считаются от свежей геометрии капсулы.
    window.addEventListener('resize', measureCapsule);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onDesktop);
      window.removeEventListener('resize', measureCapsule);
      background.forEach((el) => { el.inert = false; });
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="#top">{wordmark}</a>

        <nav className="site-nav">
          {navItems.map((item) => (
            <a key={item.href} className="nav-link" href={item.href} aria-current={item.active ? "location" : undefined} onClick={() => onNavigate(item.href)}>{item.label}</a>
          ))}
        </nav>

        <div className="header-actions">
          <LangSwitch langLinks={langLinks} onLangSwitch={onLangSwitch} />
          <a className="btn-primary header-cta" href="#contact" onClick={() => onNavigate("#contact")}>{cta}</a>
        </div>

        <details
          className="nav-toggle"
          ref={detailsRef}
          data-closing={closing ? 'true' : undefined}
          onToggle={(e) => { const open = e.currentTarget.open; setMenuOpen(open); if (!open) setClosing(false); }}
        >
          <summary ref={summaryRef} aria-label={menuLabel} aria-expanded={menuOpen ? "true" : "false"} aria-controls="nav-panel" onClick={onSummaryClick}>
            <span className="nav-burger" aria-hidden="true"></span>
          </summary>
          <div className="nav-panel" id="nav-panel" role="region" aria-label={menuLabel}>
            <nav className="nav-panel-links">
              {navItems.map((item) => (
                <a key={item.href} className="nav-panel-link" href={item.href} aria-current={item.active ? "location" : undefined} onClick={() => { closeNow(); onNavigate(item.href); }}>{item.label}</a>
              ))}
            </nav>
            <div className="nav-panel-foot">
              <LangSwitch langLinks={langLinks} onLangSwitch={onLangSwitch} />
              <a className="btn-primary" href="#contact" onClick={() => { closeNow(); onNavigate("#contact"); }}>{cta}</a>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
