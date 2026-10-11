import { useEffect, useState } from 'react';

// Горячие данные (stats, categories+works, testimonials, metricTypes) приходят в рантайме.
// Запрос уходит при вычислении модуля — до гидрации. Режим по умолчанию (cors + same-origin)
// совпадает с <link rel="preload" as="fetch" crossorigin="anonymous"> в <head>: браузер
// отдаёт уже начатый preload, второго запроса нет.
const HOT_URL = '/data/hot.json';
const RETRY_MS = 1500;

// Форма skeleton, когда её не запекла сборка: vite dev рендерит без prerender.js.
export const DEFAULT_SHAPE = { categories: ['16:9', '16:9'], works: 2, testimonials: true };

const request = () =>
  fetch(HOT_URL).then((r) => {
    if (!r.ok) throw new Error('hot.json: HTTP ' + r.status);
    return r.json();
  }).then((d) => {
    const ok = d && d.stats && Array.isArray(d.stats.items) && Array.isArray(d.categories)
      && Array.isArray(d.testimonials) && Array.isArray(d.metricTypes);
    if (!ok) throw new Error('hot.json: неожиданная форма ответа');
    return d;
  });

// Одна повторная попытка; вторая неудача — секции скрываются (status "error").
const hotPromise = typeof window === 'undefined'
  ? null
  : request().catch(() => new Promise((resolve) => { setTimeout(resolve, RETRY_MS); }).then(request));

// Первое состояние всегда "loading" — и на сборке, и на клиенте, даже если ответ уже
// пришёл: первый клиентский рендер обязан совпасть с пререндером (skeleton).
export function useHot() {
  const [hot, setHot] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    hotPromise.then(
      (data) => { if (alive) setHot({ status: 'ready', data }); },
      (error) => { console.error(error); if (alive) setHot({ status: 'error', data: null }); }
    );
    return () => { alive = false; };
  }, []);
  return hot;
}
