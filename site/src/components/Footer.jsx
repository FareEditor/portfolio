export default function Footer({ wordmark, c }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <span className="wordmark">{wordmark}</span>
        <nav className="footer-nav">
          {c.links.map((l) => (
            <a className="footer-link" href={l.href} target="_blank" rel="noopener" key={l.label}>{l.label}</a>
          ))}
        </nav>
        <span className="footer-copy">{c.copy}</span>
      </div>
    </footer>
  );
}
