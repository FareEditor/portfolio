import { useEffect, useRef } from 'react';

// Модальный плеер для шоурила и моушн-фрагментов (16:9 в 9:12 карточку
// не помещается). Кейсы играют инлайн в своих карточках — см. WorkCard.
// Вся работа с DOM и клавиатурой — в эффектах: компонент безопасен для SSR
// и при пустом id не рендерит ничего.
export default function PlayerModal({ youtubeId, onClose, label, closeLabel }) {
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);

  useEffect(() => {
    if (!youtubeId) return;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (closeBtnRef.current) closeBtnRef.current.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // Ловушка фокуса: Tab циклится внутри диалога
        const focusables = dialogRef.current.querySelectorAll(
          'button, iframe, a[href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [youtubeId, onClose]);

  if (!youtubeId) return null;

  return (
    <div className="player-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="player-dialog" role="dialog" aria-modal="true" aria-label={label} ref={dialogRef}>
        <button className="player-close" type="button" onClick={onClose} ref={closeBtnRef} aria-label={closeLabel}>✕</button>
        <div className="player-frame-wrap">
          <iframe
            className="embed-frame"
            src={"https://www.youtube-nocookie.com/embed/" + youtubeId + "?autoplay=1"}
            title={label}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </div>
  );
}
