import { useRef } from 'react';
import useCountUp from '../hooks/useCountUp.js';

// Неразрывный пробел держит высоту строки в заглушке: размер даёт сама типографика.
const BLANK = '\u00a0';

// loading — данные /data/hot.json ещё не пришли: те же четыре плашки, но заглушками.
// Узлы <li> при приходе данных остаются теми же, их reveal не проигрывается заново.
export default function Stats({ items, industries, loading }) {
  const gridRef = useRef(null);
  const shown = useCountUp(gridRef, loading ? [] : items.map((s) => s.value));

  return (
    // Секция без заголовка: четыре числа сами называют себя подписями.
    // aria-labelledby нет намеренно — безымянный <section> не становится
    // лишним landmark'ом в дереве доступности, а придумывать заголовок
    // ради ARIA значило бы писать текст за владельца.
    <section className="section section--stats" data-hot={loading ? 'loading' : 'ready'} aria-busy={loading || undefined}>
      {/* ul/li, а не div: четыре показателя — однородный перечень,
          скринридер объявляет его длину. Маркеры сняты в .stats-grid.
          Появление — карточный вариант на каждом показателе, как у прочих
          сеток: он двигает translate и играет animation, transform и
          transition остаются hover-масштабу .card--interactive. Сетка
          остаётся целью счётчика (gridRef): набег чисел не зависит от reveal. */}
      <ul className="stats-grid" ref={gridRef}>
        {items.map((s, i) => (
          <li className="stat card--interactive" data-reveal="card" key={s.key}>
            {/* Набегающее число скрыто от скринридера: промежуточные «0+», «37+»
                он мог бы зачитать как данные. Итоговое значение читается из
                sr-only — одно и то же до, во время и после анимации. */}
            <p className={loading ? 'stat-value skel' : 'stat-value'}>
              {/* shown отстаёт на кадр от прихода данных — пустой, а не «undefined» */}
              <span aria-hidden="true">{shown[i] ?? BLANK}</span>
              {!loading && <span className="sr-only">{s.value}</span>}
            </p>
            <p className={loading ? 'stat-label skel' : 'stat-label'}>{loading ? BLANK : s.label}</p>
          </li>
        ))}
      </ul>
      {/* Подпись ко всему ряду, а не пятый показатель: лежит вне ul,
          иначе попала бы в перечень как пятый элемент списка. */}
      {industries && <p className="stats-note" data-reveal="true">{industries}</p>}
    </section>
  );
}
