import { useEffect, useRef, useState } from 'react';

// Порог расхождения дорожек. 150мс — меньше четырёх кадров при 25fps, на глаз
// в сравнении «слева/справа» неразличимо, но заметно больше естественного
// джиттера двух независимо декодируемых потоков, так что подводим редко.
const DRIFT_LIMIT = 0.15;
// Реже раза в секунду: timeupdate прилетает ~4 раза в секунду, и подводить
// currentTime на каждом — дёргать декодер без повода.
const DRIFT_CHECK_MS = 1000;
const KEY_STEP = 5;

// media — settings.beforeAfter из снимка /data/static.json: { before, after }, у каждого
// абсолютный url ролика в R2 (media.fareeditor.com) и его width/height.
export default function BeforeAfter({ c, labels, media: clips }) {
  const rootRef = useRef(null);
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  const lastCheckRef = useRef(0);
  const armedRef = useRef(false);
  // Пауза по кнопке переживает уход секции из вьюпорта: возврат не должен
  // перезапускать то, что пользователь остановил руками.
  const userPausedRef = useRef(false);
  const [pos, setPos] = useState(50);
  const [armed, setArmed] = useState(false);   // секция попала в вьюпорт — грузим
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Позиция шторки — вычисляемая величина, а не оформление: уезжает в CSS
  // переменной тем же приёмом, что доля прокрутки в --playhead.
  useEffect(() => {
    if (rootRef.current) rootRef.current.style.setProperty('--ba-pos', pos + '%');
  }, [pos]);

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const media = () => [beforeRef.current, afterRef.current].filter(Boolean);
  // Обе функции читают только refs, поэтому устаревшее замыкание в наблюдателе
  // им не вредит и пересоздавать его на каждый рендер не нужно.
  const startPlayback = () => {
    const v = media();
    if (!v.length) return;
    // Индикатор поднимается только если данных действительно не хватает:
    // при повторном входе в вьюпорт canplay уже не придёт, и безусловный
    // setLoading(true) оставил бы спиннер навсегда.
    if (v.some((x) => x.readyState < 3)) setLoading(true);
    v.forEach((x) => { x.preload = 'auto'; });
    Promise.all(v.map((x) => x.play().catch(() => {}))).then(() => { setPlaying(true); setLoading(false); });
  };
  const stopPlayback = () => { media().forEach((v) => v.pause()); setPlaying(false); };

  // Исключение из правила «не грузить плеер на загрузке страницы»: до пересечения
  // у обоих video стоит preload="none", ни одного запроса не уходит. Порог 0.08 —
  // тот же, что у reveal-наблюдателя в App.jsx, отдельного числа не вводится.
  useEffect(() => {
    const root = rootRef.current;
    // Без API наблюдателя ролики не грузятся сами — только по кнопке (toggle).
    if (!root || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) {
        // Зацикленное видео вне экрана жжёт декодер и трафик впустую
        stopPlayback();
        return;
      }
      // Первое пересечение только проставляет src — играть нечего, пока
      // атрибут не приехал следующим рендером; дальше работает эффект ниже.
      if (!armedRef.current) { armedRef.current = true; setArmed(true); return; }
      if (reduceMotion() || userPausedRef.current) return;
      startPlayback();
    }, { threshold: 0.08 });
    io.observe(root);
    return () => io.disconnect();
  }, []);

  // Автозапуск только там, где непрерывное движение уместно: при
  // prefers-reduced-motion остаётся первый кадр и кнопка запуска.
  useEffect(() => {
    if (!armed) return;
    if (reduceMotion()) {
      // Нужен только первый кадр: метаданных с началом потока хватает,
      // качать 13 МБ ради статичной картинки незачем.
      media().forEach((v) => { v.preload = 'metadata'; v.load(); });
      return;
    }
    startPlayback();
  }, [armed]);

  const toggle = () => {
    if (playing) { userPausedRef.current = true; stopPlayback(); return; }
    userPausedRef.current = false;
    // src ещё не проставлен (нет IntersectionObserver) — клик и есть сигнал
    // к загрузке; дальше запуск идёт через эффект armed, как обычно.
    if (!armedRef.current) { armedRef.current = true; setArmed(true); return; }
    startPlayback();
  };

  // Ведущий — левый ролик; правый подводится к нему, если разошлись.
  const onTimeUpdate = () => {
    const now = performance.now();
    if (now - lastCheckRef.current < DRIFT_CHECK_MS) return;
    lastCheckRef.current = now;
    const a = beforeRef.current, b = afterRef.current;
    if (!a || !b || b.seeking) return;
    if (Math.abs(a.currentTime - b.currentTime) > DRIFT_LIMIT) b.currentTime = a.currentTime;
  };

  const ready = () => { if (media().every((v) => v.readyState >= 3)) setLoading(false); };

  const fromClientX = (clientX) => {
    const r = rootRef.current.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };
  // Pointer Events покрывают мышь, перо и палец одним обработчиком;
  // setPointerCapture избавляет от слушателей на window и их уборки.
  // Кнопка воспроизведения лежит внутри шторки — её нажатие не должно
  // утаскивать границу под курсор.
  const onPointerDown = (e) => {
    if (e.target.closest('.ba-toggle')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPos(fromClientX(e.clientX));
  };
  const onPointerMove = (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setPos(fromClientX(e.clientX)); };

  const onKeyDown = (e) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP, Home: -100, End: 100 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setPos((p) => Math.min(100, Math.max(0, e.key === 'Home' ? 0 : e.key === 'End' ? 100 : p + step)));
  };

  return (
    <section className="section section--ba" aria-labelledby="ba-title">
      {/* Без JS секция нерабочая по устройству: src у обоих video появляется
          только после IntersectionObserver, шторка двигается состоянием, кнопка
          зовёт обработчик. Пустой кадр с застывшей границей читается как
          поломка, а статичной замены у сравнения двух роликов нет — поэтому
          секция убирается целиком. Механизм тот же, что в Contact.jsx:
          <style> внутри <noscript> браузер разбирает только при выключенных
          скриптах; dangerouslySetInnerHTML нужен, чтобы при включённых не
          получить рассинхрон гидрации (children у noscript тогда — текст).
          Отступы соседей править не нужно: .section задаёт только
          padding-bottom, поэтому пропавшая секция оставляет ровно тот же
          зазор, что между любыми двумя соседними секциями. */}
      <noscript dangerouslySetInnerHTML={{ __html: '<style>.section--ba{display:none}</style>' }} />

      <div className="section-head" data-reveal="true">
        <span className="eyebrow">{c.eyebrow}</span>
        <h2 className="section-title" id="ba-title">{c.title}</h2>
      </div>

      {/* Оба ролика немые и помечены aria-hidden, поэтому само сравнение
          незрячему пользователю недоступно. Служебное описание объясняет,
          что показывает блок; это инфраструктура доступности, а не текст
          страницы, поэтому пишется здесь, как aria-label табов и кнопок. */}
      <p className="sr-only">{labels.description}</p>

      {/* Шторка — сам контейнер: тянуть можно за любую его точку, ручка лишь
          показывает границу и держит фокус. Появляется вторым шагом после
          заголовка секции (data-reveal-step="2"): тот же reveal, что у
          section-head, со сдвигом --reveal-step. Сдвиг идёт только по Y —
          fromClientX читает лишь left и width, подъём их не меняет. */}
      <div className="ba" ref={rootRef} data-armed={String(armed)} data-reveal="true" data-reveal-step="2" onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
        {/* Слои: .ba-clip обрезает inset справа, то есть оставляет видимой
            ЛЕВУЮ полосу до позиции шторки — значит обрезанный слой это «до»,
            а нижний слой проступает справа и это «после». Менять местами
            нельзя, не поменяв заодно направление clip-path. */}
        <video className="ba-video" ref={afterRef} src={armed ? clips.after.url : undefined} preload="none"
               width={clips.after.width} height={clips.after.height}
               muted loop playsInline onCanPlay={ready} tabIndex={-1} aria-hidden="true" />
        <div className="ba-clip">
          <video className="ba-video" ref={beforeRef} src={armed ? clips.before.url : undefined} preload="none"
                 width={clips.before.width} height={clips.before.height}
                 muted loop playsInline onCanPlay={ready} onTimeUpdate={onTimeUpdate} tabIndex={-1} aria-hidden="true" />
        </div>

        <span className="ba-label ba-label--before">{labels.before}</span>
        <span className="ba-label ba-label--after">{labels.after}</span>

        {loading && (
          <div className="ba-loading" role="status">
            <span className="ba-spinner" aria-hidden="true"></span>
            {labels.loading}
          </div>
        )}

        <div
          className="ba-handle"
          role="slider"
          tabIndex={0}
          aria-label={labels.slider}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={Math.round(pos) + '%'}
          onKeyDown={onKeyDown}
        >
          <span className="ba-handle-grip" aria-hidden="true"></span>
        </div>

        <button className="ba-toggle" type="button" aria-label={playing ? labels.pause : labels.play} onClick={toggle}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={playing ? 'M7 5h4v14H7zm6 0h4v14h-4z' : 'M8 5l11 7-11 7z'} />
          </svg>
        </button>
      </div>
    </section>
  );
}
