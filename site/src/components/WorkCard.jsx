export default function WorkCard({ w, watch }) {
  return (
    <article className="work-card" style={{ gridColumn: w.span, gridTemplateColumns: w.cardCols }}>
      {/* Плеер-фасад: iframe (youtube-nocookie, без трекинг-куки до согласия)
          монтируется только по клику — до этого лишь статичное превью */}
      {w.playing ? (
        <div className="work-thumb">
          <iframe
            className="embed-frame"
            src={"https://www.youtube-nocookie.com/embed/" + w.youtube_id + "?autoplay=1"}
            title={w.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      ) : (
        <button className="work-thumb" type="button" data-youtube-id={w.youtube_id} data-thumbnail={w.thumbnail} onClick={w.play} aria-label={w.playLabel}>
          <span className="thumb-label">{w.thumbLabel}</span>
          <span className="play-badge" aria-hidden="true">▶</span>
        </button>
      )}
      <div className="work-body">
        <p className="work-meta">{w.meta}</p>
        <h3 className="work-title">{w.title}</h3>
        <p className="work-text">{w.body}</p>
        <a className="work-link" href={w.url} target="_blank" rel="noopener">{watch}</a>
      </div>
    </article>
  );
}
