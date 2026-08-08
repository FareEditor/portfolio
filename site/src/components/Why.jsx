export default function Why({ c }) {
  return (
    <section className="section" id="about" aria-labelledby="about-title">
      <div className="section-head" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="about-title">{c.title}</h2>
      </div>
      <div className="why-grid">
        {c.items.map((it) => (
          <div className="why-item" data-reveal="true" key={it.title}>
            <h3 className="why-title">{it.title}</h3>
            <p className="why-body">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
