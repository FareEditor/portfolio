import WorkCard from './WorkCard.jsx';
import MotionCard from './MotionCard.jsx';

export default function Work({ c, caseCols, visibleCases, hasMoreCases, showAllCases, motionItems }) {
  return (
    <section className="section" id="work" aria-labelledby="work-title">
      <div className="section-head section-head--plain" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="work-title">{c.title}</h2>
      </div>

      {/* INTEGRATION: источник данных для работ — коллекция works в Decap CMS */}
      <div className="work-grid" style={{ gridTemplateColumns: caseCols }}>
        {visibleCases.map((w) => (
          <WorkCard key={w.key} w={w} watch={c.watch} />
        ))}
      </div>

      {hasMoreCases && (
        <div className="show-all-wrap">
          <button className="btn-secondary" type="button" onClick={showAllCases}>{c.showAll}</button>
        </div>
      )}

      {motionItems.length > 0 && (
        <div className="motion-block">
          <h3 className="motion-title">{c.motionTitle}</h3>
          <div className="motion-strip">
            {motionItems.map((m) => (
              <MotionCard key={m.key} m={m} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
