// История записи: ревизии с отличиями от текущей версии и восстановление с подтверждением.
import { useState } from 'react';
import { api, describeError } from './api.js';
import { DiffList, differences } from './diff.jsx';
import { Button, Dialog, Loading, Notice, useLoad, when } from './ui.jsx';

export default function History({ resource, recordKey, current, onClose, onRestored }) {
  const { data, error } = useLoad(() => api.get(`/api/revisions?resource=${resource}&key=${encodeURIComponent(recordKey)}`), [resource, recordKey]);
  const [asking, setAsking] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const { updated_at: expected, ...now } = current;
  const restore = async (id) => {
    setBusy(true); setFailure(null);
    try {
      await api.post(`/api/revisions/${id}/restore`, { expected_updated_at: expected });
      onRestored();
    } catch (e) {
      setFailure(e.message === 'conflict' ? 'Запись успели изменить или ревизия ссылается на удалённые данные. Закройте историю и откройте запись заново.' : describeError(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="История изменений" onClose={onClose} wide>
      {error && <Notice tone="error">{describeError(error)}</Notice>}
      {!data && !error && <Loading what="Загружаю историю" />}
      {failure && <Notice tone="error">{failure}</Notice>}
      {data && data.items.length === 0 && <p className="state">Правок ещё не было.</p>}
      {data && data.items.length > 0 && (
        <ol className="revisions">
          {data.items.map((revision) => {
            const diffs = revision.record === null ? [] : differences(revision.record, resource === 'content' ? now.doc : now);
            return (
              <li key={revision.id} className="revision">
                <div className="revision-head">
                  <strong>{when(revision.created_at)}</strong>
                  <span className="revision-note">версия, которая была до правки</span>
                </div>
                {revision.record === null && <p className="state">Записи ещё не существовало: это момент её создания.</p>}
                {revision.record !== null && diffs.length === 0 && <p className="state">Совпадает с текущей версией.</p>}
                {diffs.length > 0 && <DiffList items={diffs} fromLabel="в этой версии" toLabel="сейчас" />}
                {revision.record !== null && diffs.length > 0 && (asking === revision.id ? (
                  <div className="confirm">
                    <span>Вернуть запись к этой версии? Текущая сохранится в истории.</span>
                    <Button kind="primary" disabled={busy} onClick={() => restore(revision.id)}>Да, восстановить</Button>
                    <Button disabled={busy} onClick={() => setAsking(null)}>Отмена</Button>
                  </div>
                ) : <Button icon="history" onClick={() => setAsking(revision.id)}>Восстановить</Button>)}
              </li>
            );
          })}
        </ol>
      )}
      {data && data.items.length > 0 && <p className="field-hint">Слева — значение в старой версии, справа — текущее. Имена полей — как в API.</p>}
    </Dialog>
  );
}
