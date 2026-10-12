// Публикация: запуск пайплайна GitLab, который пересобирает сайт со свежим контентом.
import { HttpError } from './http.js';

const MIN_INTERVAL_S = 60;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export async function publish(env, fetchImpl = fetch) {
  // Заявка на запуск: строка появляется, только если за последнюю минуту запусков не было.
  // Одно выражение — два одновременных клика не пройдут оба.
  const claim = await env.DB.prepare(`INSERT INTO publishes (created_at) SELECT ${NOW}
    WHERE NOT EXISTS (SELECT 1 FROM publishes WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${MIN_INTERVAL_S} seconds'))`).run();
  if (claim.meta.changes !== 1) throw new HttpError(429, 'too_soon', { retry_after: MIN_INTERVAL_S });
  const release = () => env.DB.prepare('DELETE FROM publishes WHERE id = ?1').bind(claim.meta.last_row_id).run();

  let pipeline;
  try {
    if (!env.GITLAB_TRIGGER_TOKEN) throw new Error('секрет GITLAB_TRIGGER_TOKEN не задан');
    const response = await fetchImpl(`https://gitlab.com/api/v4/projects/${env.GITLAB_PROJECT_ID}/trigger/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: env.GITLAB_TRIGGER_TOKEN, ref: env.GITLAB_REF }),
    });
    if (!response.ok) throw new Error(`GitLab: HTTP ${response.status}`);
    pipeline = await response.json();
    if (!Number.isInteger(pipeline?.id)) throw new Error('GitLab: в ответе нет id пайплайна');
  } catch (error) {
    // Неудачный запуск минуту не занимает; текст ошибки — только в журнал.
    await release();
    console.warn(JSON.stringify({ event: 'publish_failed', message: String(error?.message ?? error) }));
    throw new HttpError(502, 'publish_failed');
  }
  return { id: pipeline.id, web_url: pipeline.web_url ?? null, status: pipeline.status ?? null };
}
