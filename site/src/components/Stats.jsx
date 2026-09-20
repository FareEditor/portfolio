export default function Stats({ items }) {
  return (
    // Секция без заголовка: четыре числа сами называют себя подписями.
    // aria-labelledby нет намеренно — безымянный <section> не становится
    // лишним landmark'ом в дереве доступности, а придумывать заголовок
    // ради ARIA значило бы писать текст за владельца.
    <section className="section section--stats">
      {/* ul/li, а не div: четыре показателя — однородный перечень,
          скринридер объявляет его длину. Маркеры сняты в .stats-grid. */}
      <ul className="stats-grid">
        {items.map((s) => (
          <li className="stat" data-reveal="true" key={s.key}>
            <p className="stat-value">{s.value}</p>
            <p className="stat-label">{s.label}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
