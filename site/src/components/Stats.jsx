import { useRef } from 'react';
import useCountUp from '../hooks/useCountUp.js';

export default function Stats({ items, industries }) {
  const gridRef = useRef(null);
  const shown = useCountUp(gridRef, items.map((s) => s.value));

  return (
    // Секция без заголовка: четыре числа сами называют себя подписями.
    // aria-labelledby нет намеренно — безымянный <section> не становится
    // лишним landmark'ом в дереве доступности, а придумывать заголовок
    // ради ARIA значило бы писать текст за владельца.
    <section className="section section--stats">
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
            <p className="stat-value">
              <span aria-hidden="true">{shown[i]}</span>
              <span className="sr-only">{s.value}</span>
            </p>
            <p className="stat-label">{s.label}</p>
          </li>
        ))}
      </ul>
      {/* Подпись ко всему ряду, а не пятый показатель: лежит вне ul,
          иначе попала бы в перечень как пятый элемент списка. */}
      {industries && <p className="stats-note" data-reveal="true">{industries}</p>}
    </section>
  );
}
