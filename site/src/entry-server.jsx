import { renderToString } from 'react-dom/server';
import App from './App.jsx';

// Пререндер на этапе сборки: prerender.js вызывает render() для обеих
// локалей и вклеивает разметку в готовые документы. Контент виден без JS.
// shape — форма skeleton горячих секций, её получает prerender.js.
export function render(lang, shape) {
  return renderToString(<App lang={lang} shape={shape} />);
}
