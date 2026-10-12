import { createRoot } from 'react-dom/client';
import App from './App.jsx';
// Токены и шрифты — те же файлы, что у сайта: админка не заводит своих цветов и гарнитур.
import '../../../site/src/styles/tokens.css';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
