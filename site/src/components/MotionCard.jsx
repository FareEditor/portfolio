import { useState } from 'react';

export default function MotionCard({ m }) {
  // См. WorkCard: заглушка при пустом thumbnail и при ошибке загрузки;
  // стартовое состояние «картинка есть» ради совпадения с SSR-разметкой
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(m.thumbnail) && !imgFailed;

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
          {showImg && (
            <img
              className="motion-thumb-img"
              src={m.thumbnail}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              width="900"
              height="1200"
              onError={() => setImgFailed(true)}
            />
          )}
          <span className="play-badge play-badge--sm" aria-hidden="true">▶</span>
          {!showImg && <span className="thumb-label">{m.thumbLabel}</span>}
        </button>
      )}
      <figcaption className="motion-caption">
        <span className="motion-meta">{m.meta}</span>
        <span className="motion-name">{m.title}</span>
      </figcaption>
    </figure>
  );
}
