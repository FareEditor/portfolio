export default function Stats({ items, industries }) {
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
      <ul className="stats-grid" data-reveal="true">
        {items.map((s) => (
          <li className="stat card--interactive" key={s.key}>
            <p className="stat-value">{s.value}</p>
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
