// Поле с медиа в форме записи: выбор из библиотеки или загрузка нового файла.
import { useRef, useState } from 'react';
import { KINDS } from '../../src/media-rules.js';
import { ApiError, describeError, uploadMedia } from './api.js';
import { KIND_LABEL } from './labels.js';
import { Button, Field } from './ui.jsx';

const fileName = (key) => key.split('/').pop();

export function MediaPreview({ item }) {
  if (!item) return <div className="media-thumb media-thumb--empty" aria-hidden="true">нет</div>;
  return item.content_type === 'video/mp4'
    ? <video className="media-thumb" src={item.url} preload="metadata" muted playsInline aria-label={`Ролик ${fileName(item.key)}`} />
    : <img className="media-thumb" src={item.url} alt={`Изображение ${fileName(item.key)}`} loading="lazy" />;
}

export default function MediaField({ field, value, onChange, media, onUploaded, error }) {
  const input = useRef(null);
  const [stage, setStage] = useState(null);
  const [problem, setProblem] = useState(null);
  const options = media.filter((m) => m.kind === field.kind);
  const pick = async (file) => {
    if (!file) return;
    setProblem(null);
    try {
      const { media: item } = await uploadMedia(file, field.kind, setStage);
      onUploaded(item);
      onChange(item.url);
    } catch (e) {
      setProblem(e instanceof ApiError && e.body.fields ? e.body.fields.map((f) => f.message).join('; ') : describeError(e));
    } finally { setStage(null); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="media-field">
      <MediaPreview item={options.find((m) => m.url === value)} />
      <div className="media-field-body">
        <Field label={field.label} error={error} hint={`${KIND_LABEL[field.kind]}: ${KINDS[field.kind].types.map((t) => t.split('/')[1]).join(', ')}`}>
          {(props) => (
            <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...props}>
              <option value="">{field.optional ? '— нет —' : '— выберите —'}</option>
              {options.map((m) => <option key={m.id} value={m.url}>{fileName(m.key)} · {m.width}×{m.height}</option>)}
            </select>
          )}
        </Field>
        <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={KINDS[field.kind].types.join(',')} onChange={(e) => pick(e.target.files[0])} />
        <Button icon="upload" disabled={stage !== null} onClick={() => input.current.click()}>{stage ?? 'Загрузить новый файл'}</Button>
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </div>
    </div>
  );
}
