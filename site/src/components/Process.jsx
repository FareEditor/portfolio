export default function Process({ c }) {
  return (
    <section className="section" id="process" aria-labelledby="process-title">
      <div className="section-head" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="process-title">{c.title}</h2>
      </div>
      <ol className="process-list" role="list">
        {c.steps.map((s) => (
          <li className="process-step" data-reveal="card" key={s.title}>
            <span className="step-tc">{s.tc}</span>
            <h3 className="step-title">{s.title}</h3>
            <p className="step-body">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
