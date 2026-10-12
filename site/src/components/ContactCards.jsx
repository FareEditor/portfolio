import { useState } from 'react';
import ContactIcon from './ContactIcon.jsx';

// Одно содержимое на все три формы карточки — меняется только внешний элемент.
function CardBody({ card }) {
  return (
    <>
      <span className="contact-card-icon" aria-hidden="true"><ContactIcon kind={card.kind} /></span>
      <span className="contact-card-label">{card.label}</span>
      <span className="contact-card-value">{card.value}</span>
    </>
  );
}

// Карточка без перехода: физически кликается и активируется с клавиатуры,
// но никуда не ведёт. <button>, а не <a> и не div с role — нативная кнопка
// сама даёт и Enter, и Space, и попадание в таб-порядок.
function NoActionCard({ card }) {
  const [shaking, setShaking] = useState(false);
  return (
    <button
      type="button"
      className={'contact-card card--interactive card--no-action' + (shaking ? ' is-shaking' : '')}
      onClick={() => setShaking(true)}
      onAnimationEnd={() => setShaking(false)}
    >
      <CardBody card={card} />
      {/* Подсказка не заменяет видимый текст, а дополняет его: aria-label
          перекрыл бы подпись целиком и разошёлся бы с ней, как только
          владелец заполнит ярлык. */}
      <span className="sr-only">{card.noActionHint}</span>
    </button>
  );
}

export default function ContactCards({ cards }) {
  return (
    // data-reveal="card" на ячейке, а не на самой карточке: вариант card
    // двигает свойством translate и animation, но hover-зум и shake живут
    // на вложенной .card--interactive — ячейка их не касается вовсе.
    <ul className="contact-cards">
      {cards.map((card) => (
        <li className="contact-cell" key={card.key} data-reveal="card">
          {card.href && (
            <a
              className="contact-card card--interactive"
              href={card.href}
              {...(card.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <CardBody card={card} />
            </a>
          )}
          {!card.href && card.noAction && <NoActionCard card={card} />}
          {/* Неизвестный kind из данных не получает ни ссылки, ни обработчика */}
          {!card.href && !card.noAction && (
            <div className="contact-card card--interactive"><CardBody card={card} /></div>
          )}
        </li>
      ))}
    </ul>
  );
}
