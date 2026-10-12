// Публикация: пересборка сайта, чтобы в него попали тексты, настройки и контакты.
import { useState } from 'react';
import { api, describeError } from './api.js';
import { Button, Notice } from './ui.jsx';

export default function PublishPage() {
  const [state, setState] = useState({ busy: false, result: null, error: null });
  const run = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      setState({ busy: false, result: await api.post('/api/publish'), error: null });
    } catch (e) {
      const error = e.message === 'too_soon' ? `Публикация уже запускалась меньше минуты назад. Повторите через ${e.body.retry_after ?? 60} с.`
        : e.message === 'publish_failed' ? 'GitLab не принял запуск пайплайна. Проверьте trigger token и повторите позже.'
          : describeError(e);
      setState({ busy: false, result: null, error });
    }
  };
  return (
    <>
      <div className="page-head"><h1>Публикация</h1></div>
      <div className="prose">
        <p><strong>Сразу при сохранении</strong> публикуются работы, категории, отзывы, типы метрик и статистика: сайт читает их на лету, изменения видны в течение минуты.</p>
        <p><strong>После публикации</strong> появляются тексты, настройки и контакты: они вшиваются в страницы при сборке. Кнопка ниже запускает пересборку сайта в GitLab; она занимает несколько минут.</p>
      </div>
      <Button kind="primary" disabled={state.busy} onClick={run}>{state.busy ? 'Запускаю…' : 'Опубликовать тексты'}</Button>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.result && (
        <Notice tone="ok">
          <p>
            Пайплайн №{state.result.id} запущен, статус: <code>{state.result.status ?? 'неизвестен'}</code>.{' '}
            {state.result.web_url && <a href={state.result.web_url} target="_blank" rel="noopener noreferrer">Открыть в GitLab</a>}
          </p>
        </Notice>
      )}
    </>
  );
}
