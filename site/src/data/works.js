// INTEGRATION: источник данных — коллекция works в Decap CMS; имена полей = схема CMS
// Записи собираются на этапе сборки из site/src/data/works/*.json — по файлу на работу.
const modules = import.meta.glob('./works/*.json', { eager: true, import: 'default' });

export const WORKS = Object.values(modules)
  .filter((w) => w.published)
  .sort((a, b) => a.order - b.order);
