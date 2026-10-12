// Ключи опций селектов формы. Это контракт с воркером формы, а не контент: значения
// побайтно повторяют PROJECT_TYPES и BUDGETS из worker/src/index.js — заявку с другим
// ключом воркер отвергнет. Сверку делает scripts/check-form-options.mjs в начале сборки.
// Подписи опций остаются в content (contact.project_type / contact.budget) и берутся по ключу.
export const PROJECT_TYPES = ["long_form", "motion_graphics", "series", "other"];
export const BUDGETS = ["200_500", "500_1000", "1000_2000", "2000_plus"];

export const FORM_OPTIONS = { project_type: PROJECT_TYPES, budget: BUDGETS };
