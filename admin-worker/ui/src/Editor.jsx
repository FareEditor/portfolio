// Форма одной записи: загрузка, проверка теми же правилами, что на сервере, сохранение с
// оптимистичной блокировкой, удаление, история.
import { useEffect, useMemo, useRef, useState } from 'react';
import { validate } from '../../src/rules.js';
import { api, describeError } from './api.js';
import { DiffList, differences } from './diff.jsx';
import History from './History.jsx';
import MediaField from './MediaField.jsx';
import { FORMS, toBody, toValues } from './schema.js';
import { Button, Check, Field, Loading, Notice, TextInput, go, setDirty, useLoad } from './ui.jsx';

// Горячие данные сайт читает на лету; остальное вшивается в сборку и ждёт публикации.
const HOT = ['categories', 'works', 'metric-types', 'testimonials', 'stats'];
export const savedNote = (resource) => (HOT.includes(resource)
  ? 'Сохранено. На сайте появится в течение минуты.'
  : <p>Сохранено. На сайте появится после <a href="#/publish">публикации</a>.</p>);

// ---------- Форма

function FormField({ field, values, set, errors, creating, lists, onUploaded }) {
  const text = (key, label, lang, extra = {}) => (
    <Field key={key} label={label} lang={lang} error={errors[key]} hint={extra.hint}>
      {(props) => <TextInput value={values[key]} onChange={(v) => set(key, v)} multiline={field.multiline} mono={field.mono} readOnly={extra.readOnly} inputMode={extra.inputMode} {...props} />}
    </Field>
  );
  switch (field.type) {
    case 'pair': return (
      <fieldset className="pair">
        <legend>{field.label}{field.optional && <span className="optional"> — необязательно</span>}</legend>
        {text(field.ru, field.label, 'RU')}
        {text(field.en, field.label, 'EN')}
        {field.hint && <p className="field-hint pair-hint">{field.hint}</p>}
      </fieldset>
    );
    case 'bool': return <Check label={field.label} checked={values[field.key]} onChange={(v) => set(field.key, v)} />;
    case 'int': return text(field.key, field.label, undefined, { hint: field.hint, inputMode: 'numeric' });
    case 'select': {
      const options = field.options ?? (field.source === 'categories' ? lists.categories.map((c) => [c.slug, c.title_ru]) : lists.metricTypes.map((m) => [m.slug, m.label_ru]));
      return (
        <Field label={field.label} error={errors[field.key]}>
          {(props) => (
            <select className="input" value={values[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} {...props}>
              <option value="">— выберите —</option>
              {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          )}
        </Field>
      );
    }
    case 'media': return <MediaField field={field} value={values[field.key]} onChange={(v) => set(field.key, v)} media={lists.media} onUploaded={onUploaded} error={errors[field.errorKey ?? field.key]} />;
    default: return text(field.key, field.label, undefined, { hint: field.hint, readOnly: field.once && !creating });
  }
}

function EditorForm({ resource, id, record, lists, initial }) {
  const form = FORMS[resource];
  const creating = record === null;
  const path = form.single ? `/api/${resource}` : `/api/${resource}/${encodeURIComponent(id)}`;
  const [base, setBase] = useState(record);
  const [start, setStart] = useState(() => (creating ? { ...form.blank, ...initial } : toValues(resource, record)));
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState({});
  const [general, setGeneral] = useState([]);
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [media, setMedia] = useState(lists.media);
  const summary = useRef(null);

  const dirty = JSON.stringify(values) !== JSON.stringify(start);
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty]);

  const known = useMemo(() => new Set(form.fields.flatMap((f) => (f.type === 'pair' ? [f.ru, f.en] : [f.errorKey ?? f.key]))), [form]);
  const set = (key, value) => { setValues((v) => ({ ...v, [key]: value })); setNotice(null); };
  const adopt = (fresh) => { const next = toValues(resource, fresh); setBase(fresh); setStart(next); setValues(next); };
  const show = (list) => {
    setErrors(Object.fromEntries(list.filter((e) => known.has(e.field)).map((e) => [e.field, e.message])));
    setGeneral(list.filter((e) => !known.has(e.field)).map((e) => `${e.field}: ${e.message}`));
    requestAnimationFrame(() => summary.current?.focus());
  };

  const save = async () => {
    const body = toBody(resource, values);
    const ctx = { media, categories: lists.categories.map((c) => c.slug), metricTypes: lists.metricTypes.map((m) => m.slug) };
    const { errors: found } = validate(resource, body, ctx);
    setNotice(null);
    if (found.length) { show(found); return; }
    setErrors({}); setGeneral([]); setBusy(true);
    try {
      if (creating) {
        const saved = await api.post(`/api/${resource}`, body);
        go(`#/${resource}/${encodeURIComponent(saved.slug)}`, true);
        return;
      }
      adopt(await api.put(path, { ...body, expected_updated_at: base.updated_at }));
      setConflict(null);
      setNotice(savedNote(resource));
    } catch (e) {
      if (e.status === 422 && e.body.fields) show(e.body.fields);
      else if (e.message === 'exists') show([{ field: 'slug', message: 'запись с таким slug уже есть' }]);
      else if (e.message === 'conflict' && !creating) {
        // Чужая правка: ввод остаётся в форме, показываем, что изменилось на сервере.
        try { const fresh = await api.get(path); setConflict({ fresh, diffs: differences(base, fresh) }); } catch (inner) { setGeneral([describeError(inner)]); }
      } else setGeneral([describeError(e)]);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить запись «${form.title(base) || id}»? Её можно будет вернуть только через историю другой правки.`)) return;
    setBusy(true);
    try { await api.del(path); go(`#/${form.back}`, true); } catch (e) { setGeneral([describeError(e)]); setBusy(false); }
  };
  const cancel = () => { if (creating) go(`#/${form.back}`); else { setValues(start); setErrors({}); setGeneral([]); setConflict(null); } };

  const count = Object.keys(errors).length + general.length;
  return (
    <form className="editor" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="page-head">
        <div>
          {form.back && <a className="back" href={`#/${form.back}`}>← к списку</a>}
          <h1>{creating ? `Новая запись: ${form.one}` : form.title(base) || form.one}</h1>
        </div>
        {!creating && (
          <div className="page-actions">
            <Button icon="history" onClick={() => setHistory(true)}>История</Button>
            {!form.fixed && <Button kind="danger" icon="trash" disabled={busy} onClick={remove}>Удалить</Button>}
          </div>
        )}
      </div>

      {conflict && (
        <Notice tone="warn">
          <p><strong>Запись изменили, пока вы её редактировали.</strong> Ваш ввод не потерян — он остаётся в форме.</p>
          {conflict.diffs.length > 0
            ? <><p>Что изменилось на сервере:</p><DiffList items={conflict.diffs} fromLabel="было, когда вы открыли запись" toLabel="на сервере сейчас" /></>
            : <p>Поля записи на сервере те же; отказ вызван связями с другими записями.</p>}
          <div className="confirm">
            <Button onClick={() => { setBase(conflict.fresh); setConflict(null); setNotice('Ваш ввод сохранён в форме. Нажмите «Сохранить», чтобы записать его поверх версии с сервера.'); }}>Оставить мой ввод</Button>
            <Button onClick={() => { if (window.confirm('Заменить ваш ввод версией с сервера?')) { adopt(conflict.fresh); setConflict(null); } }}>Взять версию с сервера</Button>
          </div>
        </Notice>
      )}
      {count > 0 && (
        <div className="notice notice--error" role="alert" tabIndex={-1} ref={summary}>
          <p><strong>Не сохранено: {count === 1 ? 'одна ошибка' : `ошибок — ${count}`}.</strong> Исправьте отмеченные поля.</p>
          {general.length > 0 && <ul>{general.map((line) => <li key={line}>{line}</li>)}</ul>}
        </div>
      )}
      {notice && <Notice tone="ok">{notice}</Notice>}

      <div className="fields">
        {form.fields.map((field) => (
          <FormField key={field.key ?? field.ru} field={field} values={values} set={set} errors={errors} creating={creating}
            lists={{ ...lists, media }} onUploaded={(item) => setMedia((list) => (list.some((m) => m.id === item.id) ? list : [...list, item]))} />
        ))}
      </div>

      <div className="savebar">
        <Button kind="primary" type="submit" disabled={busy || (!dirty && !creating)}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
        <Button disabled={busy || (!dirty && !creating)} onClick={cancel}>Отменить</Button>
        {dirty && <span className="savebar-note">Есть несохранённые изменения</span>}
      </div>

      {history && <History resource={resource} recordKey={form.single ? '1' : id} current={base} onClose={() => setHistory(false)}
        onRestored={async () => { adopt(await api.get(path)); setHistory(false); setNotice('Версия восстановлена.'); }} />}
    </form>
  );
}

export default function RecordEditor({ resource, id, query }) {
  const form = FORMS[resource];
  const creating = id === 'new' && !form.fixed;
  const { data, error } = useLoad(async () => {
    const [record, media, categories, metricTypes] = await Promise.all([
      creating ? null : api.get(form.single ? `/api/${resource}` : `/api/${resource}/${encodeURIComponent(id)}`),
      api.get('/api/media'), api.get('/api/categories'), api.get('/api/metric-types'),
    ]);
    return { record, lists: { media: media.items, categories: categories.items, metricTypes: metricTypes.items } };
  }, [resource, id]);
  if (error) return <><div className="page-head"><h1>Запись не открылась</h1></div><Notice tone="error"><p>{describeError(error)} <a href={`#/${form.back ?? resource}`}>Вернуться к списку</a></p></Notice></>;
  if (!data) return <Loading />;
  const initial = resource === 'works' && query.get('category') ? { category: query.get('category') } : {};
  return <EditorForm key={`${resource}/${id}`} resource={resource} id={id} record={data.record} lists={data.lists} initial={initial} />;
}
