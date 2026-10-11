// Первым: модуль сразу отправляет запрос горячих данных, не дожидаясь гидрации.
import './hot.js';
import { hydrateRoot } from 'react-dom/client';
import App from './App.jsx';

// Редирект первого визита живёт инлайн-скриптом в <head> index.html —
// он должен сработать до первой отрисовки пререндеренной разметки.
hydrateRoot(document.getElementById('root'), <App lang="en" />);
