// Медиа: библиотека файлов R2, загрузка, удаление неиспользуемых.
import { useRef, useState } from 'react';
import { KINDS, LIMITS } from '../../src/media-rules.js';
import { ApiError, api, describeError, uploadMedia } from './api.js';
import { KIND_LABEL } from './labels.js';
import { MediaPreview } from './MediaField.jsx';
import { Badge, Button, Empty, Field, Loading, Notice, bytes, useLoad } from './ui.jsx';

const USED = { works: (key) => ({ href: `#/works/${key}`, text: `работа ${key}` }), testimonials: (key) => ({ href: `#/testimonials/${key}`, text: `отзыв ${key}` }), settings: () => ({ href: '#/settings', text: 'настройки' }) };
const duration = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;

export default function MediaPage() {
  const { data, error, reload } = useLoad(() => api.get('/api/media'), []);
  const input = useRef(null);
  const [kind, setKind] = useState('work');
  const [stage, setStage] = useState(null);
  const [message, setMessage] = useState(null);

  const send = async () => {
    const file = input.current.files[0];
    if (!file) { setMessage({ tone: 'error', text: 'Выберите файл.' }); return; }
    setMessage(null);
    try {
      const { created, media } = await uploadMedia(file, kind, setStage);
      setMessage({ tone: 'ok', text: created ? `Загружено: ${media.key}` : `Такой файл уже есть в библиотеке: ${media.key}` });
      input.current.value = '';
      reload();
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError && e.body.fields ? e.body.fields.map((f) => f.message).join('; ')
        : e.message === 'too_large' ? `Файл больше ${bytes(e.body.limit)}.` : describeError(e) });
    } finally { setStage(null); }
  };
  const remove = async (item) => {
    if (!window.confirm(`Удалить файл ${item.key}? Вернуть его можно только повторной загрузкой.`)) return;
    try { await api.del(`/api/media/${item.id}`); setMessage({ tone: 'ok', text: `Удалено: ${item.key}` }); reload(); } catch (e) { setMessage({ tone: 'error', text: describeError(e) }); }
  };

  return (
    <>
      <div className="page-head"><h1>Медиа</h1></div>
      <form className="upload" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Field label="Вид">
          {(props) => <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} {...props}>{Object.keys(KINDS).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>}
        </Field>
        <Field label="Файл" hint={`${KINDS[kind].types.map((t) => t.split('/')[1]).join(', ')}; до ${bytes(kind === 'before' || kind === 'after' ? LIMITS.video : LIMITS.image)}`}>
          {(props) => <input ref={input} className="input" type="file" accept={KINDS[kind].types.join(',')} {...props} />}
        </Field>
        <Button kind="primary" type="submit" icon="upload" disabled={stage !== null}>{stage ?? 'Загрузить'}</Button>
      </form>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error && <Notice tone="error">{describeError(error)}</Notice>}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <Empty>Файлов пока нет.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="media-grid">
          {data.items.map((item) => (
            <li key={item.id} className="media-card">
              <MediaPreview item={item} />
              <div className="media-card-body">
                <p className="media-card-title"><Badge tone="info">{KIND_LABEL[item.kind]}</Badge></p>
                <p className="meta">{item.width && item.height ? `${item.width}×${item.height}` : 'размер неизвестен'} · {bytes(item.bytes)}{item.duration_ms ? ` · ${duration(item.duration_ms)}` : ''}</p>
                <p className="meta"><code>{item.key}</code></p>
                <p className="meta">
                  {item.used_by.length === 0 ? 'Нигде не используется' : <>Используется: {item.used_by.map((u, i) => { const link = USED[u.resource](u.key); return <span key={i}>{i > 0 && ', '}<a href={link.href}>{link.text}</a></span>; })}</>}
                </p>
                <Button kind="danger" icon="trash" disabled={item.in_use} title={item.in_use ? 'Сначала уберите ссылки на файл' : undefined} onClick={() => remove(item)}>Удалить</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
