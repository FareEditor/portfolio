// Каркас: проверка доступа, шапка, навигация по разделам.
import { api, describeError } from './api.js';
import ContentPage from './Content.jsx';
import RecordEditor from './Editor.jsx';
import { MetricTypesPage, PositionsPage, TestimonialsPage, WorksPage } from './Lists.jsx';
import MediaPage from './Media.jsx';
import PublishPage from './Publish.jsx';
import { Loading, useLoad, useRoute } from './ui.jsx';

const NAV = [
  ['works', 'Работы'], ['testimonials', 'Отзывы'], ['metric-types', 'Типы метрик'], ['stats', 'Статистика'], ['contacts', 'Контакты'],
  ['settings', 'Настройки'], ['content', 'Тексты'], ['media', 'Медиа'], ['publish', 'Публикация'],
];
// Раздел навигации, к которому относится маршрут: категории живут внутри «Работ».
const sectionOf = (first) => (first === 'categories' ? 'works' : NAV.some(([key]) => key === first) ? first : 'works');

function Page({ parts, query }) {
  const [first = 'works', second] = parts;
  switch (first) {
    case 'categories': return second ? <RecordEditor resource="categories" id={second} query={query} /> : <WorksPage />;
    case 'works': return second ? <RecordEditor resource="works" id={second} query={query} /> : <WorksPage />;
    case 'testimonials': return second ? <RecordEditor resource="testimonials" id={second} query={query} /> : <TestimonialsPage />;
    case 'metric-types': return second ? <RecordEditor resource="metric-types" id={second} query={query} /> : <MetricTypesPage />;
    case 'stats': case 'contacts': return second ? <RecordEditor resource={first} id={second} query={query} /> : <PositionsPage resource={first} />;
    case 'settings': return <RecordEditor resource="settings" id="1" query={query} />;
    case 'content': return <ContentPage section={second ?? 'common'} />;
    case 'media': return <MediaPage />;
    case 'publish': return <PublishPage />;
    default: return <WorksPage />;
  }
}

export default function App() {
  const me = useLoad(() => api.get('/api/me'), []);
  const route = useRoute();
  if (me.error) {
    return (
      <main className="denied">
        <h1>Нет доступа</h1>
        <p>{describeError(me.error)}</p>
        <p><button type="button" className="btn btn--primary" onClick={() => location.reload()}>Обновить страницу</button></p>
      </main>
    );
  }
  if (!me.data) return <main className="denied"><Loading what="Проверяю доступ" /></main>;
  const current = sectionOf(route.parts[0]);
  return (
    <>
      <a className="skip" href="#main">К содержимому</a>
      <header className="top">
        <a className="brand" href="#/works">FARE <span>админка</span></a>
        <span className="who" title="Вход через Cloudflare Access">{me.data.email}</span>
      </header>
      <nav className="nav" aria-label="Разделы">
        {NAV.map(([key, label]) => <a key={key} href={`#/${key}`} aria-current={key === current ? 'page' : undefined}>{label}</a>)}
      </nav>
      <main id="main" tabIndex={-1}>
        <Page key={route.parts.join('/')} parts={route.parts} query={route.query} />
      </main>
    </>
  );
}
