import { useState } from 'react';
import WorkCard from './WorkCard.jsx';

// Порог «показать все» применяется внутри блока категории, а не ко всей секции:
// длинная категория сворачивается, соседние короткие остаются целыми.
const VISIBLE_CAP = 6;
const CAP_FROM = 7;

function CategoryBlock({ category, watch, showAllLabel }) {
  const [showAll, setShowAll] = useState(false);
  const capped = category.works.length >= CAP_FROM && !showAll;
  const visible = capped ? category.works.slice(0, VISIBLE_CAP) : category.works;

  return (
    <div className="work-category">
      <div className="work-category-head" data-reveal="true">
        <h3 className="work-category-title">{category.title}</h3>
        {category.blurb && <p className="work-category-blurb">{category.blurb}</p>}
      </div>

      <div className="work-grid">
        {visible.map((w) => (
          <WorkCard key={w.key} w={w} watch={watch} aspect={category.aspect} />
        ))}
      </div>

      {capped && (
        <div className="show-all-wrap">
          <button className="btn-secondary" type="button" onClick={() => setShowAll(true)}>{showAllLabel}</button>
        </div>
      )}
    </div>
  );
}

export default function Work({ c, categories }) {
  return (
    <section className="section" id="work" aria-labelledby="work-title">
      <div className="section-head section-head--plain" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="work-title">{c.title}</h2>
      </div>

      {/* INTEGRATION: источник данных для работ — коллекции categories и works в Decap CMS */}
      {categories.map((category) => (
        <CategoryBlock key={category.slug} category={category} watch={c.watch} showAllLabel={c.showAll} />
      ))}
    </section>
  );
}
