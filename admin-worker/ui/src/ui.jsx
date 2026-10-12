// Общие элементы интерфейса: поля, кнопки, диалог, навигация с защитой несохранённого ввода.
import { useEffect, useId, useRef, useState } from 'react';

// ---------- Навигация (hash) и несохранённые изменения

const guard = { dirty: false, skip: false, last: location.hash };
const LEAVE = 'Есть несохранённые изменения. Уйти без сохранения?';

export const setDirty = (dirty) => { guard.dirty = dirty; };
export const parseHash = () => {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) };
};
// force — переход после сохранения или удаления: спрашивать не о чем.
export function go(hash, force = false) {
  if (force) guard.dirty = false;
  location.hash = hash;
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => {
      if (guard.skip) { guard.skip = false; return; }
      if (guard.dirty && !window.confirm(LEAVE)) {
        guard.skip = true;
        location.hash = guard.last;
        return;
      }
      guard.dirty = false;
      guard.last = location.hash;
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    const onUnload = (e) => { if (guard.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('beforeunload', onUnload); };
  }, []);
  return route;
}

// ---------- Мелочи

export const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg>
);
export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  back: 'M15 5l-7 7 7 7',
};

export const Button = ({ kind = 'default', icon, children, ...props }) => (
  <button type="button" className={`btn btn--${kind}`} {...props}>{icon && <Icon d={ICONS[icon]} />}<span>{children}</span></button>
);

export const Badge = ({ tone = 'mute', children }) => <span className={`badge badge--${tone}`}>{children}</span>;

export const Notice = ({ tone = 'info', children, ...props }) => (
  <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'} {...props}>{typeof children === 'string' ? <p>{children}</p> : children}</div>
);

export const Loading = ({ what = 'Загрузка' }) => <p className="state" role="status">{what}…</p>;
export const Empty = ({ children }) => <p className="state">{children}</p>;

export const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
export const when = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Загрузка данных страницы: { data, error, reload }.
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null });
    loader().then((data) => { if (alive) setState({ data, error: null }); }, (error) => { if (alive) setState({ data: null, error }); });
    return () => { alive = false; };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// ---------- Поля. Каждое — с меткой; ошибка связана с полем через aria-describedby.

export function Field({ label, hint, error, children, lang }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      {/* В паре RU / EN общая подпись стоит в legend; у поля видна только локаль, имя для скринридера — полное. */}
      <label className="field-label" htmlFor={id}>{lang ? <><span className="sr-only">{label} </span><span className="field-lang">{lang}</span></> : label}</label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy })}
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function TextInput({ value, onChange, multiline, mono, readOnly, ...props }) {
  const shared = { value: value ?? '', onChange: (e) => onChange(e.target.value), readOnly, className: `input${mono ? ' input--mono' : ''}`, ...props };
  return multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />;
}

export const Check = ({ label, checked, onChange, hint }) => (
  <label className="check"><input type="checkbox" checked={checked === true} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span>{hint && <span className="field-hint">{hint}</span>}</label>
);

// Модальный диалог на нативном <dialog>: фокус и Escape — от браузера.
export function Dialog({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog--wide' : ''}`} aria-labelledby={id} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="btn btn--quiet" onClick={onClose} aria-label="Закрыть">✕</button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
