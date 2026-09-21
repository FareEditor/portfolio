export default function Faq({ c, faqItems }) {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="section-head section-head--tight" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="faq-title">{c.title}</h2>
      </div>
      <div className="faq-list">
        {faqItems.map((f) => (
          <div className="faq-item" data-open={f.expanded} key={f.btnId}>
            <h3 className="faq-heading">
              <button className="faq-trigger" type="button" id={f.btnId} aria-expanded={f.expanded} aria-controls={f.panelId} onClick={f.toggle}>
                {f.q}
                <span className="faq-icon" aria-hidden="true">+</span>
              </button>
            </h3>
            <div className="faq-panel" id={f.panelId} role="region" aria-labelledby={f.btnId}>
              <div className="faq-panel-inner">
                <p className="faq-answer">{f.a}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
