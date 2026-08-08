export default function Proof({ c }) {
  return (
    <section className="section section--proof" aria-labelledby="proof-title">
      <div className="proof-block" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="proof-title" id="proof-title">{c.title}</h2>
        <p className="proof-stat">{c.number}</p>
        <p className="proof-industries">{c.industries}</p>
      </div>
    </section>
  );
}
