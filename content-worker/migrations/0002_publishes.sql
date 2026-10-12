-- Запуски публикации из админки (admin-worker): не чаще одного в минуту.
-- Строка — успешная заявка на запуск пайплайна; неудачный запуск свою строку удаляет.
CREATE TABLE publishes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL
);
