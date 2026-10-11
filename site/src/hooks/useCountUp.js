import { useEffect, useState } from 'react';

// Строка показателя делится на числовую часть и неподвижный текст вокруг неё:
// «100+» → '' / 100 / '+', «24ч» → '' / 24 / 'ч'. Анимируется только число,
// префикс и суффикс остаются ровно такими, как в stats.json. Строка без цифр
// не анимируется вовсе.
const parse = (text) => {
  const m = /^(\D*)(\d+(?:[.,]\d+)?)([\s\S]*)$/.exec(text);
  if (!m) return null;
  const [, prefix, num, suffix] = m;
  const sep = num.includes(',') ? ',' : '.';
  const decimals = num.includes(sep) ? num.split(sep)[1].length : 0;
  return { prefix, suffix, sep, decimals, target: parseFloat(num.replace(',', '.')) };
};

const format = (p, n) =>
  p.prefix + (p.decimals ? n.toFixed(p.decimals).replace('.', p.sep) : String(Math.round(n))) + p.suffix;

// CSS-время в миллисекунды. Единицу нельзя считать заранее известной:
// минификатор сборки переписывает 1100ms в 1.1s.
const toMs = (v) => {
  const n = parseFloat(v);
  return /\ds\s*$/.test(v) && !/ms\s*$/.test(v) ? n * 1000 : n;
};

// ease-out: кубическое замедление к концу, число «доезжает», а не обрывается
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Первое состояние — финальные строки: пререндер и режим без JS показывают
// итог сразу, гидрация не расходится с разметкой. Сброс к нулю происходит
// уже после монтирования, пока блок вне экрана. Длительность живёт в CSS
// (--dur-count на наблюдаемом элементе), здесь только читается.
export default function useCountUp(ref, values) {
  const [shown, setShown] = useState(values);
  const key = values.join('\u0000');

  useEffect(() => {
    const el = ref.current;
    setShown(values);
    // Пустой список — данных ещё нет (skeleton): наблюдать нечего, нулей не показываем.
    if (!values.length) return;
    if (!el || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const duration = toMs(getComputedStyle(el).getPropertyValue('--dur-count'));
    if (!(duration > 0)) return;

    const parsed = values.map(parse);
    setShown(parsed.map((p, i) => (p ? format(p, 0) : values[i])));

    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        const k = easeOut(t);
        // последний кадр — исходная строка, а не пересобранная: форматирование
        // данных не проходит через toFixed и округление
        setShown(parsed.map((p, i) => (p && t < 1 ? format(p, p.target * k) : values[i])));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    // Один запуск за жизнь страницы: после первого пересечения наблюдение
    // снимается, повторный скролл к блоку ничего не перезапускает.
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.unobserve(el);
      run();
    }, { threshold: 0.3 });
    io.observe(el);

    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [key]);

  return shown;
}
