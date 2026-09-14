// INTEGRATION: источник данных — коллекции categories и works в Decap CMS; имена полей = схема CMS
// Записи собираются на этапе сборки из site/src/data/{categories,works}/*.json — по файлу на запись.
// Eager glob обязателен: prerender рендерит разметку на этапе сборки, динамический импорт туда не успеет.
const categoryModules = import.meta.glob('./categories/*.json', { eager: true, import: 'default' });
const workModules = import.meta.glob('./works/*.json', { eager: true, import: 'default' });

// Сортируем копию: sort мутирует массив, а Object.values отдаёт живые значения модулей —
// сортировка на месте переупорядочивала бы общий экспорт при каждом вызове.
// Копия, а не toSorted: он появился в Chrome 110/Firefox 115, ниже целевого диапазона Vite.
const byOrder = (items) => [...items].sort((a, b) => a.order - b.order);

// Единственное место фильтрации и сортировки. App.jsx получает готовую структуру и ничего не пересчитывает.
export const CATEGORIES = byOrder(Object.values(categoryModules).filter((c) => c.published))
  .map((category) => ({
    ...category,
    works: byOrder(Object.values(workModules).filter((w) => w.published && w.category === category.slug)),
  }))
  // Категория без опубликованных работ не даёт пустой заголовок на странице
  .filter((category) => category.works.length > 0);
