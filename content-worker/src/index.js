// Заглушка: Content Worker ещё не реализован и не деплоится.
export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
