import { useCallback, useEffect, useRef, useState } from 'react';

// Какая секция из навигации сейчас «в фокусе». Чистая функция без своего
// слушателя: её зовёт rAF-throttled обработчик прокрутки из App.jsx.
//
// Активна последняя секция, чей верх поднялся выше линии `line` (доля высоты
// вьюпорта). Выше первой секции из списка (hero, статистика) — никакая.
// У самого низа страницы — последняя: её секция может быть короче вьюпорта
// и не дотянуться верхом до линии.
export function currentSection(ids, line) {
  const vh = window.innerHeight || 0;
  const d = document.documentElement;
  if (ids.length && window.scrollY > 0 && window.scrollY + vh >= d.scrollHeight - 2) return ids[ids.length - 1];
  let active = null;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= vh * line) active = id;
  }
  return active;
}

// Программная прокрутка дошла до цели: верх секции встал под шапку
// (scroll-padding-top у html), либо упёрлась в низ страницы, либо — для
// null — в самый верх.
export function reachedTarget(id) {
  const d = document.documentElement;
  if (id === null) return window.scrollY <= 1;
  const el = document.getElementById(id);
  if (!el) return true;
  const pad = parseFloat(getComputedStyle(d).scrollPaddingTop) || 0;
  const atBottom = window.scrollY + window.innerHeight >= d.scrollHeight - 2;
  return atBottom || Math.abs(el.getBoundingClientRect().top - pad) < 2;
}

// Состояние scroll-spy — один activeId. update() зовёт существующий
// rAF-throttled обработчик прокрутки App.jsx: своего scroll-слушателя у хука
// нет. lockTo(id) — для программной прокрутки (клик по пункту, «наверх»):
// цель подсвечивается сразу, а промежуточные секции по пути не мигают.
// Замок снимается, когда прокрутка дошла до цели (проверка в update на
// каждом кадре прокрутки — работает и в Safari, где нет scrollend), по колесу
// или касанию (пользователь перехватил прокрутку) и, в крайнем случае, по
// таймеру. scrollend намеренно не слушается: событие от прокрутки, которая
// закончилась сразу после клика, снимало замок в начале пути и давало
// мигание по промежуточным секциям.
const LOCK_MAX_MS = 3000;

export function useScrollSpy(ids, line) {
  const [activeId, setActiveId] = useState(null);
  const lockRef = useRef(undefined);  // undefined — замка нет; null — цель «верх»
  const timerRef = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const release = useCallback(() => {
    if (lockRef.current === undefined) return;
    lockRef.current = undefined;
    clearTimeout(timerRef.current);
    setActiveId(currentSection(idsRef.current, line));
  }, [line]);

  const update = useCallback(() => {
    if (lockRef.current !== undefined) {
      if (!reachedTarget(lockRef.current)) return;
      lockRef.current = undefined;
      clearTimeout(timerRef.current);
    }
    setActiveId(currentSection(idsRef.current, line));
  }, [line]);

  const lockTo = useCallback((id) => {
    lockRef.current = id;
    setActiveId(id);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(release, LOCK_MAX_MS);
  }, [release]);

  useEffect(() => {
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      clearTimeout(timerRef.current);
    };
  }, [release]);

  return { activeId, update, lockTo };
}
