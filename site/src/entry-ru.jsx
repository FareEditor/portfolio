// Первым: модуль сразу отправляет запрос горячих данных, не дожидаясь гидрации.
import './hot.js';
import { hydrateRoot } from 'react-dom/client';
import App from './App.jsx';

hydrateRoot(document.getElementById('root'), <App lang="ru" />);
