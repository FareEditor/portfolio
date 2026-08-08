export default function MotionCard({ m }) {
  return (
    <figure className="motion-item">
      {/* Плеер-фасад: iframe youtube-nocookie монтируется только по клику */}
      {m.playing ? (
        <div className="motion-thumb">
          <iframe
            className="embed-frame"
            src={"https://www.youtube-nocookie.com/embed/" + m.youtube_id + "?autoplay=1"}
            title={m.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      ) : (
        <button className="motion-thumb" type="button" data-youtube-id={m.youtube_id} data-thumbnail={m.thumbnail} onClick={m.play} aria-label={m.playLabel}>
          <span className="play-badge play-badge--sm" aria-hidden="true">▶</span>
          <span className="thumb-label">{m.thumbLabel}</span>
        </button>
      )}
      <figcaption className="motion-caption">
        <span className="motion-meta">{m.meta}</span>
        <span className="motion-name">{m.title}</span>
      </figcaption>
    </figure>
  );
}
