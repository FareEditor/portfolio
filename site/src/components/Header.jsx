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

export default function Header({ wordmark, navItems, langLinks, cta, menuLabel, headerRef, onLangSwitch }) {
  // <details> открывается без JS. Эффекты ниже добавляют то, чего нативное
  // поведение не даёт: Escape, возврат фокуса и блокировку прокрутки.
  const [menuOpen, setMenuOpen] = useState(false);
  const detailsRef = useRef(null);
  const summaryRef = useRef(null);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      close();
      if (summaryRef.current) summaryRef.current.focus();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  return (
    <header className="site-header" ref={headerRef}>
      <div className="header-inner">
        <a className="wordmark" href="#top">{wordmark}</a>

        <nav className="site-nav">
          {navItems.map((item) => (
            <a key={item.href} className="nav-link" href={item.href}>{item.label}</a>
          ))}
        </nav>

        <div className="header-actions">
          <LangSwitch langLinks={langLinks} onLangSwitch={onLangSwitch} />
          <a className="btn-primary header-cta" href="#contact">{cta}</a>
        </div>

        <details
          className="nav-toggle"
          ref={detailsRef}
          onToggle={(e) => setMenuOpen(e.currentTarget.open)}
        >
          <summary ref={summaryRef} aria-label={menuLabel} aria-expanded={menuOpen ? "true" : "false"} aria-controls="nav-panel">
            <span className="nav-burger" aria-hidden="true"></span>
          </summary>
          <div className="nav-panel" id="nav-panel" role="region" aria-label={menuLabel}>
            <nav className="nav-panel-links">
              {navItems.map((item) => (
                <a key={item.href} className="nav-panel-link" href={item.href} onClick={close}>{item.label}</a>
              ))}
            </nav>
            <div className="nav-panel-foot">
              <LangSwitch langLinks={langLinks} onLangSwitch={onLangSwitch} />
              <a className="btn-primary" href="#contact" onClick={close}>{cta}</a>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
