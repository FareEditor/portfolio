export default function Header({ wordmark, navItems, langLinks, cta, headerRef, onLangSwitch }) {
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
          {/* INTEGRATION: в продакшене переключатель — переход между / и /ru/ + запись выбора в localStorage */}
          <div className="lang-switch" role="group">
            {langLinks.map((lb) => (
              <a
                key={lb.code}
                className="lang-btn"
                href={lb.href}
                aria-current={lb.active ? "true" : undefined}
                style={{ background: lb.bg, color: lb.fg }}
                onClick={(e) => onLangSwitch(e, lb)}
              >
                {lb.label}
              </a>
            ))}
          </div>
          <a className="btn-primary header-cta" href="#contact">{cta}</a>
        </div>
      </div>
    </header>
  );
}
