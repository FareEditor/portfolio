// Фоновые ореолы: чисто декоративный слой позади контента. Разметка
// постоянная — восемь ореолов по два пустых элемента (место и тело); размеры, места, цвет и дрейф
// задаёт CSS (.ambient в app.css, --ambient-* в tokens.css), поэтому
// пререндер и гидрация совпадают, а без JS слой выглядит так же.
const GLOWS = 8;

export default function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      {Array.from({ length: GLOWS }, (_, i) => <span className="ambient-glow" key={i}><span className="ambient-glow-body"></span></span>)}
    </div>
  );
}
