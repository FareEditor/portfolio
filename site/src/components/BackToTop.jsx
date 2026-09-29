// Одна кнопка на всё приложение, вне секций. Видимость приходит атрибутом
// data-visible — тем же приёмом, что data-open у FAQ и data-active у панелей
// работ; оформление и переходы целиком в CSS. Скрытая кнопка получает
// visibility:hidden: выпадает из порядка Tab и из дерева доступности.
export default function BackToTop({ visible, label, onClick }) {
  return (
    <button className="to-top" type="button" data-visible={String(visible)} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
