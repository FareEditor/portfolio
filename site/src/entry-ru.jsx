// Первым: модуль сразу отправляет запрос горячих данных, не дожидаясь гидрации.
import './hot.js';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';

// __HOT_SHAPE__ кладёт в документ prerender.js; в vite dev его нет — App берёт форму по умолчанию.
const root = document.getElementById('root');
const app = <App lang="ru" shape={window.__HOT_SHAPE__} />;
// В vite dev корень пуст — гидрировать нечего, иначе React сообщает о расхождении.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
