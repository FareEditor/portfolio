// Тексты: документ content по секциям, RU и EN рядом. Форма строится по общей схеме документа.
import { useEffect, useRef, useState } from 'react';
import { CONTENT_SHAPE, contentErrors } from '../../src/rules.js';
import { api, describeError } from './api.js';
import { DiffList, differences } from './diff.jsx';
import { savedNote } from './Editor.jsx';
import History from './History.jsx';
import { CONTENT_SECTIONS, groupLabel, isLong, isOptionKey, leafLabel } from './schema.js';
import { Button, Field, Loading, Notice, TextInput, setDirty, useLoad } from './ui.jsx';

const LOCALES = ['ru', 'en'];
// Верхние строки документа (cta, menu) и nav собраны в одну секцию.
const COMMON = ['cta', 'menu', 'nav'];
const sectionKeys = (section) => (section === 'common' ? COMMON : [section]);
const at = (doc, path) => path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((node, key) => node?.[key], doc);
function withValue(doc, path, value) {
  const copy = structuredClone(doc);
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  keys.slice(0, -1).reduce((node, key) => node[key], copy)[keys.at(-1)] = value;
  return copy;
}

function Leaf({ path, docs, set, errors }) {
  if (isOptionKey(path)) {
    return (
      <div className="field">
        <span className="field-label">{leafLabel(path)}</span>
        <code className="readonly">{at(docs.ru, path)}</code>
        <p className="field-hint">Ключ — часть контракта с формой заявки, не редактируется.</p>
      </div>
    );
  }
  return (
    <fieldset className="pair">
      <legend>{leafLabel(path)}</legend>
      {LOCALES.map((locale) => (
        <Field key={locale} label={leafLabel(path)} lang={locale.toUpperCase()} error={errors[`${locale}:${path}`]}>
          {(props) => <TextInput value={at(docs[locale], path)} onChange={(v) => set(locale, path, v)} multiline={isLong(path)} {...props} />}
        </Field>
      ))}
    </fieldset>
  );
}

function Node({ shape, path, name, index, ...rest }) {
  if (shape === 's') return <Leaf path={path} {...rest} />;
  const children = Array.isArray(shape)
    ? Array.from({ length: shape[0] }, (_, i) => <Node key={i} shape={shape[1]} path={`${path}[${i}]`} name={name} index={i} {...rest} />)
    : Object.entries(shape).map(([key, child]) => <Node key={key} shape={child} path={`${path}.${key}`} name={key} {...rest} />);
  // Список из простых строк и объект верхнего уровня рамки не получают — только вложенные группы.
  if (Array.isArray(shape) || !path.includes('.') && index === undefined) return <>{children}</>;
  return <div className="subgroup"><h3>{groupLabel(name, index)}</h3>{children}</div>;
}

function ContentForm({ loaded, section }) {
  const [base, setBase] = useState(loaded);
  const [docs, setDocs] = useState({ ru: loaded.ru.doc, en: loaded.en.doc });
  const [errors, setErrors] = useState({});
  const [general, setGeneral] = useState([]);
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const summary = useRef(null);

  const changed = LOCALES.filter((l) => JSON.stringify(docs[l]) !== JSON.stringify(base[l].doc));
  const dirty = changed.length > 0;
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty]);
  const set = (locale, path, value) => { setDocs((d) => ({ ...d, [locale]: withValue(d[locale], path, value) })); setNotice(null); };

  const show = (list) => {
    setErrors(Object.fromEntries(list.map((e) => [e.field, e.message])));
    // Ошибка может быть в другой секции: перечисляем все с адресом поля.
    setGeneral(list.map((e) => `${e.field.slice(0, 2).toUpperCase()} · ${e.field.slice(3)}: ${e.message}`));
    requestAnimationFrame(() => summary.current?.focus());
  };

  const save = async () => {
    const found = changed.flatMap((l) => contentErrors(docs[l]).map((e) => ({ field: `${l}:${e.field}`, message: e.message })));
    setNotice(null);
    if (found.length) { show(found); return; }
    setErrors({}); setGeneral([]); setBusy(true);
    const next = { ...base };
    try {
      for (const locale of changed) {
        try {
          next[locale] = await api.put(`/api/content/${locale}`, { doc: docs[locale], expected_updated_at: base[locale].updated_at });
        } catch (e) {
          if (e.status === 422 && e.body.fields) show(e.body.fields.map((f) => ({ field: `${locale}:${f.field}`, message: f.message })));
          else if (e.message === 'conflict') {
            const fresh = await api.get(`/api/content/${locale}`);
            setConflict({ locale, fresh, diffs: differences(base[locale].doc, fresh.doc) });
          } else setGeneral([describeError(e)]);
          return;
        }
      }
      setConflict(null);
      setNotice(savedNote('content'));
    } catch (e) { setGeneral([describeError(e)]); } finally { setBase(next); setBusy(false); }
  };
  const cancel = () => { setDocs({ ru: base.ru.doc, en: base.en.doc }); setErrors({}); setGeneral([]); setConflict(null); };

  return (
    <form className="editor" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="page-head">
        <h1>Тексты: {CONTENT_SECTIONS[section]}</h1>
        <div className="page-actions">
          {LOCALES.map((l) => <Button key={l} icon="history" onClick={() => setHistory(l)}>История {l.toUpperCase()}</Button>)}
        </div>
      </div>
      <nav className="subnav" aria-label="Секции текстов">
        {Object.entries(CONTENT_SECTIONS).map(([key, label]) => <a key={key} href={`#/content/${key}`} aria-current={key === section ? 'page' : undefined}>{label}</a>)}
      </nav>

      {conflict && (
        <Notice tone="warn">
          <p><strong>Тексты {conflict.locale.toUpperCase()} изменили, пока вы их редактировали.</strong> Ваш ввод не потерян — он остаётся в форме.</p>
          <DiffList items={conflict.diffs} fromLabel="было, когда вы открыли тексты" toLabel="на сервере сейчас" />
          <div className="confirm">
            <Button onClick={() => { setBase((b) => ({ ...b, [conflict.locale]: conflict.fresh })); setConflict(null); setNotice('Ваш ввод сохранён в форме. Нажмите «Сохранить», чтобы записать его поверх версии с сервера.'); }}>Оставить мой ввод</Button>
            <Button onClick={() => { if (window.confirm('Заменить ваш ввод версией с сервера?')) { setBase((b) => ({ ...b, [conflict.locale]: conflict.fresh })); setDocs((d) => ({ ...d, [conflict.locale]: conflict.fresh.doc })); setConflict(null); } }}>Взять версию с сервера</Button>
          </div>
        </Notice>
      )}
      {general.length > 0 && (
        <div className="notice notice--error" role="alert" tabIndex={-1} ref={summary}>
          <p><strong>Не сохранено.</strong> Исправьте поля:</p>
          <ul>{general.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <div className="fields">
        {sectionKeys(section).map((key) => <Node key={key} shape={CONTENT_SHAPE[key]} path={key} name={key} docs={docs} set={set} errors={errors} />)}
      </div>

      <div className="savebar">
        <Button kind="primary" type="submit" disabled={busy || !dirty}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
        <Button disabled={busy || !dirty} onClick={cancel}>Отменить</Button>
        {dirty && <span className="savebar-note">Есть несохранённые изменения{changed.length === 1 ? ` (${changed[0].toUpperCase()})` : ''}</span>}
      </div>

      {history && <History resource="content" recordKey={history} current={base[history]} onClose={() => setHistory(null)}
        onRestored={async () => {
          const fresh = await api.get(`/api/content/${history}`);
          setBase((b) => ({ ...b, [history]: fresh })); setDocs((d) => ({ ...d, [history]: fresh.doc })); setHistory(null); setNotice('Версия восстановлена.');
        }} />}
    </form>
  );
}

export default function ContentPage({ section }) {
  const { data, error } = useLoad(() => api.get('/api/content'), []);
  if (error) return <Notice tone="error">{describeError(error)}</Notice>;
  if (!data) return <Loading />;
  return <ContentForm loaded={data} section={section in CONTENT_SECTIONS ? section : 'common'} />;
}
