// Сравнение двух версий записи по полям: общее для истории и для разбора конфликта.

// Вложенная запись → плоский список «путь → значение» для сравнения версий.
export function flatten(value, path = '', out = {}) {
  if (Array.isArray(value)) value.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, path ? `${path}.${key}` : key, out);
  else out[path] = value;
  return out;
}
export function differences(a, b) {
  const left = flatten(a ?? {});
  const right = flatten(b ?? {});
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => key !== 'updated_at' && !/\.(width|height|duration_ms)$/.test(key) && (left[key] ?? '') !== (right[key] ?? ''))
    .map((key) => ({ key, from: left[key], to: right[key] }));
}
const shown = (value) => (value === undefined || value === null || value === '' ? '—' : value === true ? 'да' : value === false ? 'нет' : String(value));

export function DiffList({ items, fromLabel, toLabel }) {
  return (
    <ul className="diff">
      {items.map((d) => (
        <li key={d.key}>
          <code>{d.key}</code>
          <span className="diff-from"><span className="sr-only">{fromLabel}: </span>{shown(d.from)}</span>
          <span className="diff-arrow" aria-hidden="true">→</span>
          <span className="diff-to"><span className="sr-only">{toLabel}: </span>{shown(d.to)}</span>
        </li>
      ))}
    </ul>
  );
}
