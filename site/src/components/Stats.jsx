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
          data-reveal висит на сетке, а не на карточках: правило появления
          .js-reveal [data-reveal][data-revealed="1"] фиксирует transform:none
          со специфичностью (0,3,0) и глушило бы hover-масштаб карточки. */}
      <ul className="stats-grid" data-reveal="true" ref={gridRef}>
        {items.map((s, i) => (
          <li className="stat card--interactive" key={s.key}>
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
