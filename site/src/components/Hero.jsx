import PlayIcon from './PlayIcon.jsx';

export default function Hero({ c, showreelId, openPlayer }) {
  return (
    <section className="hero">
      <div className="hero-grid" aria-hidden="true"></div>
      <div className="hero-glow-cool" aria-hidden="true"></div>
      <div className="hero-glow-warm" aria-hidden="true"></div>
      <div className="hero-inner">
        <div className="status-pill" data-reveal="true">
          <span className="status-dot" aria-hidden="true"></span>
          <span className="eyebrow">{c.status}</span>
        </div>
        <h1 className="hero-title" data-reveal="true">{c.title}</h1>
        <p className="hero-sub" data-reveal="true">{c.sub}</p>
        <div className="hero-actions" data-reveal="true">
          <a className="btn-primary" href="#work">{c.primary}</a>
          {/* INTEGRATION: кнопка шоурила использует ту же заглушку плеера; SHOWREEL_ID временный */}
{/*           <button className="btn-secondary" type="button" data-youtube-id={showreelId} onClick={() => openPlayer(showreelId)}>
            <span className="btn-glyph" aria-hidden="true"><PlayIcon /></span>{c.secondary}
          </button> */}
        </div>
      </div>
    </section>
  );
}
