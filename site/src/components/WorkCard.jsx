import { useState } from 'react';
import PlayIcon from './PlayIcon.jsx';

// Пропорция превью — свойство категории. Белый список: значение из CMS не попадает
// в разметку напрямую, неизвестный aspect молча откатывается на 16:9.
const ASPECT_CLASS = {
  '16:9': 'work-thumb--16x9',
  '9:12': 'work-thumb--9x12',
  '1:1': 'work-thumb--1x1',
  '4:5': 'work-thumb--4x5',
};
const DEFAULT_ASPECT = '16:9';

// Отношение сторон для width/height на <img>: резервирует место до загрузки картинки.
const ASPECT_BOX = {
  '16:9': [1280, 720],
  '9:12': [900, 1200],
  '1:1': [1000, 1000],
  '4:5': [1000, 1250],
};

export default function WorkCard({ w, watch, aspect }) {
  // Битая картинка → полосатая заглушка. Начальное состояние «картинка есть»,
  // чтобы SSR-разметка и первый клиентский рендер совпадали; onError бывает
  // только в браузере.
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(w.thumbnail) && !imgFailed;
  const [boxW, boxH] = ASPECT_BOX[aspect] || ASPECT_BOX[DEFAULT_ASPECT];
  const thumbClass = 'work-thumb ' + (ASPECT_CLASS[aspect] || ASPECT_CLASS[DEFAULT_ASPECT]);

  return (
    <article className={'work-card' + (w.featured ? ' work-card--featured' : '')}>
      {/* Плеер-фасад: iframe (youtube-nocookie, без трекинг-куки до согласия)
          монтируется только по клику — до этого лишь статичное превью */}
      {w.playing ? (
        <div className={thumbClass}>
          <iframe
            className="embed-frame"
            src={"https://www.youtube-nocookie.com/embed/" + w.youtube_id + "?autoplay=1"}
            title={w.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      ) : (
        <button className={thumbClass} type="button" data-youtube-id={w.youtube_id} data-thumbnail={w.thumbnail} onClick={w.play} aria-label={w.playLabel}>
          {showImg && (
            <img
              className="work-thumb-img"
              src={w.thumbnail}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              width={boxW}
              height={boxH}
              onError={() => setImgFailed(true)}
            />
          )}
          {!showImg && <span className="thumb-label">{w.thumbLabel}</span>}
          <span className="play-badge" aria-hidden="true"><PlayIcon /></span>
        </button>
      )}
      {/* Подпись под превью: заголовок ведёт, мета и описание подчинены ему.
          Мета собрана из трёх отдельных полей, а не склеена в строку — имя
          клиента несёт вес, формат и хронометраж остаются фоном.
          Обёртки нет намеренно: строки подписи лежат в гриде карточки,
          чтобы выравниваться между колонками (subgrid в .work-card). */}
      <h4 className="work-title">{w.title}</h4>
      <p className="work-meta">
        <span className="work-client">{w.client}</span>
        <span>{w.format}</span>
        <span>{w.duration}</span>
      </p>
      <p className="work-text">{w.body}</p>
      <a className="work-link" href={w.url} target="_blank" rel="noopener">{watch}</a>
    </article>
  );
}
