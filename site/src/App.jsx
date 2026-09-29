import { useCallback, useEffect, useRef, useState } from 'react';
// INTEGRATION: site copy is managed in Decap CMS via data/content/*.json.
import ru from './data/content/ru.json';
import en from './data/content/en.json';
import { CATEGORIES, TESTIMONIALS, METRIC_TYPES } from './data/works.js';
// INTEGRATION: показатели секции статистики — файл stats.json в Decap CMS
import stats from './data/stats.json';
// INTEGRATION: карточки каналов связи — файл contacts.json в Decap CMS
import contacts from './data/contacts.json';
import settings from './data/settings.json';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Stats from './components/Stats.jsx';
import BeforeAfter from './components/BeforeAfter.jsx';
import Work from './components/Work.jsx';
import Testimonials from './components/Testimonials.jsx';
import Process from './components/Process.jsx';
import Why from './components/Why.jsx';
import Faq from './components/Faq.jsx';
import Contact from './components/Contact.jsx';
import ContactCards from './components/ContactCards.jsx';
import Footer from './components/Footer.jsx';
import PlayerModal from './components/PlayerModal.jsx';
import BackToTop from './components/BackToTop.jsx';
import { useScrollSpy } from './hooks/scrollSpy.js';
import './styles/tokens.css';
import './styles/app.css';

const CONTENT = { ru, en };

// Якоря навигации — единственный источник и для ссылок, и для scroll-spy.
const NAV_HREFS = ["#work", "#process", "#about", "#contact"];
const NAV_IDS = NAV_HREFS.map((href) => href.slice(1));
// Линия активации scroll-spy — 38% высоты вьюпорта. Переход по якорю ставит
// верх секции под шапку (~10–12% высоты), то есть заведомо выше линии —
// кликнутый пункт остаётся активным и после прокрутки. При чтении секция
// становится активной, когда её заголовок прошёл верхнюю треть экрана, где
// держится взгляд, а хвост предыдущей ещё занимает низ.
const SPY_LINE = 0.38;
// Линия появления при прокрутке — 85% высоты вьюпорта. На 94% анимация шла
// на самом краю: элемент был виден на 2–30% своей высоты, и подъём почти
// целиком проходил за нижней кромкой. На 85% карточка стартует, когда её
// уже видно, а до верха экрана остаётся запас на весь подъём. rootMargin
// наблюдателя — та же линия (threshold 0: срабатывает, как только верх её
// пересёк), revealInView и IO не расходятся.
const REVEAL_LINE = 0.85;
const REVEAL_ROOT_MARGIN = "0px 0px -15% 0px";
// Окно, в течение которого scrollend считается концом пользовательской
// прокрутки: плавная прокрутка колесом докатывается за 150–400ms.
const USER_SCROLL_MS = 800;
// Кнопка «наверх» появляется, когда первый экран ушёл целиком (доля высоты
// вьюпорта): пока виден hero, верх страницы и так под рукой.
const TO_TOP_AFTER = 1;

// cap повторяет FIELD_CAPS воркера: клиент режет длину там же, где режет сервер,
// иначе слишком длинный ввод проходит локальную проверку и падает «сетевой» ошибкой
const FIELD_ORDER = [
  { name: "name", kind: "text", cap: 200, autoComplete: "name" },
  // канал связи — не email и не телефон, браузеру подсказывать нечего
  { name: "contact", kind: "text", hint: true, cap: 200, autoComplete: "off" },
  { name: "project_type", kind: "select", cap: 100 },
  { name: "budget", kind: "select", cap: 100 },
  { name: "message", kind: "textarea", cap: 5000 }
];

export default function App({ lang }) {
  const c = CONTENT[lang];

  const [openFaq, setOpenFaq] = useState(-1);
  const [form, setForm] = useState("idle");
  const [invalid, setInvalid] = useState({});
  const [selects, setSelects] = useState({ project_type: "", budget: "" });
  const [playingId, setPlayingId] = useState(null);
  const spy = useScrollSpy(NAV_IDS, SPY_LINE);
  // null — до монтирования: пререндер и режим без JS кнопку не рисуют вовсе,
  // первый клиентский рендер совпадает с пререндером
  const [showTop, setShowTop] = useState(null);

  const playheadRef = useRef(null);
  const ioRef = useRef(null);
  // IO подал хоть один callback — значит, работает. Первый callback приходит
  // на observe() для каждого элемента, в том числе с isIntersecting:false,
  // поэтому это не «пользователь долистал», а «наблюдатель жив».
  const ioAliveRef = useRef(false);
  const safetyRef = useRef(0);
  const rafRef = useRef(0);

  const reveal = (el) => { el.dataset.revealed = "1"; };

  // Проявляет всё, чей верх уже поднялся выше линии REVEAL_LINE вьюпорта —
  // та же граница, что rootMargin у наблюдателя. Нижней границы нет намеренно:
  // элемент, который проскочили целиком (End, якорь, восстановленный скролл),
  // IO не увидит ни в одном кадре, и без этого он остался бы невидимым над
  // экраном. Его переход отыгрывает вне вьюпорта, глазу не заметен.
  // У самого низа страницы линия 94% может так и не дойти до последних
  // блоков — там проявляется весь остаток. Когда страница стоит (первый
  // проход и scrollend: загрузка, якорь, восстановленная позиция, конец
  // любой прокрутки), линия — весь вьюпорт: край элемента в нижней полосе
  // иначе остался бы пустым до следующего скролла.
  const revealInView = (line = REVEAL_LINE) => {
    const vh = window.innerHeight || 0;
    const d = document.documentElement;
    const atBottom = window.scrollY + vh >= d.scrollHeight - 2;
    document.querySelectorAll("[data-reveal]").forEach((el) => {
      if (el.dataset.revealed === "1") return;
      if (atBottom || el.getBoundingClientRect().top < vh * line) {
        reveal(el);
        if (ioRef.current) ioRef.current.unobserve(el);
      }
    });
  };

  const onScroll = () => {
    const d = document.documentElement;
    const max = d.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    // ширина индикатора — единственное, что остаётся вычисляемым:
    // это доля прокрутки, а не оформление
    if (playheadRef.current) playheadRef.current.style.setProperty("--playhead", p.toFixed(4));
    revealInView();
    spy.update();
    setShowTop(window.scrollY > window.innerHeight * TO_TOP_AFTER);
  };

  const setupReveal = () => {
    const els = Array.from(document.querySelectorAll("[data-reveal]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ioRef.current) ioRef.current.disconnect();
    if (reduce) { els.forEach(reveal); return; }
    revealInView(1);
    // Без API наблюдателя остаётся проявление по scroll и страховка ниже.
    if (!("IntersectionObserver" in window)) return;
    ioRef.current = new IntersectionObserver((entries) => {
      ioAliveRef.current = true;
      entries.forEach((e) => { if (e.isIntersecting) { reveal(e.target); ioRef.current.unobserve(e.target); } });
    }, { rootMargin: REVEAL_ROOT_MARGIN, threshold: 0 });
    els.forEach((el) => { if (el.dataset.revealed !== "1") ioRef.current.observe(el); });
  };

  useEffect(() => {
    // js-reveal ставится инлайн-скриптом в <head> обоих документов —
    // до первой отрисовки, иначе пререндеренный контент мигнёт.
    // Отметка о гидрации гасит страховочный таймер из того же скрипта.
    document.documentElement.setAttribute("data-hydrated", "1");
    // Обработчик скролла ограничен одним вызовом на кадр: revealInView
    // обходит все [data-reveal] через querySelectorAll, а scroll прилетает
    // чаще, чем браузер рисует. rAF, а не setTimeout — привязка к отрисовке,
    // а не к произвольному интервалу; это throttle, не debounce: reveal
    // продолжает срабатывать во время прокрутки, а не после её конца.
    const onScrollEvent = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; onScroll(); });
    };
    // Проход «в покое» по всему вьюпорту нужен после прокрутки без участия
    // пользователя: якорь при загрузке, восстановленная позиция, scrollTo,
    // прыжок по ссылке меню. После колеса, касания или клавиш scrollend
    // приходит между «щелчками» — там полный проход проявлял бы всё у самой
    // нижней кромки, и работала бы не линия REVEAL_LINE, а край экрана.
    let lastUserScroll = -Infinity;
    const onUserScroll = () => { lastUserScroll = performance.now(); };
    const onScrollEnd = () => revealInView(performance.now() - lastUserScroll < USER_SCROLL_MS ? REVEAL_LINE : 1);
    window.addEventListener("scroll", onScrollEvent, { passive: true });
    window.addEventListener("scrollend", onScrollEnd, { passive: true });
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    window.addEventListener("keydown", onUserScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
    setupReveal();
    // Страховка только на случай, когда наблюдатель не работает вовсе: API нет
    // или за 500ms не пришло ни одного callback. Пока IO жив, всё ниже экрана
    // ждёт, пока до него долистают, — раньше таймер проявлял страницу целиком.
    safetyRef.current = setTimeout(() => {
      if (!ioAliveRef.current) document.querySelectorAll("[data-reveal]").forEach(reveal);
    }, 500);
    return () => {
      window.removeEventListener("scroll", onScrollEvent);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
      window.removeEventListener("resize", onScroll);
      clearTimeout(safetyRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (ioRef.current) ioRef.current.disconnect();
    };
  }, []);

  // Плеер-фасад: до клика — статичное превью. Работы играют инлайн в своих
  // карточках (WorkCard); в модалке PlayerModal остаётся только шоурил.
  const openPlayer = (id) => setPlayingId(id);
  const closePlayer = useCallback(() => setPlayingId(null), []);

  const mapWork = (w) => {
    const client = lang === "en" ? w.client_en : w.client;
    const format = lang === "en" ? w.format_en : w.format;
    const duration = lang === "en" ? w.duration_en : w.duration;
    const title = lang === "en" ? w.title_en : w.title_ru;
    return {
      key: w.slug,
      youtube_id: w.youtube_id,
      thumbnail: w.thumbnail,
      featured: w.featured,
      // мета уходит тремя полями, а не склеенной строкой: подача решается в CSS
      client: client,
      format: format,
      duration: duration,
      title: title,
      body: lang === "en" ? w.body_en : w.body_ru,
      url: "https://www.youtube.com/watch?v=" + w.youtube_id,
      thumbLabel: c.work.thumb,
      playLabel: c.work.play + " — " + title,
      // Две карточки давали ссылки с одинаковым доступным именем;
      // видимый текст входит в имя целиком, поэтому 2.5.3 соблюдён.
      watchLabel: c.work.watch + " — " + title,
      playing: playingId === w.youtube_id,
      play: () => openPlayer(w.youtube_id)
    };
  };

  const submit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const inv = {};
    FIELD_ORDER.forEach((f) => { if (!String(fd.get(f.name) || "").trim()) inv[f.name] = true; });
    if (Object.keys(inv).length) { setInvalid(inv); setForm("idle"); return; }
    setInvalid({});
    setForm("sending");
    // INTEGRATION: endpoint формы — POST /api/contact (Cloudflare Worker)
    // FormData включает honeypot `website` и токен `cf-turnstile-response`
    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd))
    })
      .then((r) => r.json().then((d) => {
        if (!r.ok || !d.ok) throw new Error("send_failed");
      }))
      .then(() => setForm("success"))
      .catch(() => setForm("error"));
  };

  // Порядок показателей — позиция в массиве stats.json: список фиксированной длины,
  // переупорядочивается перетаскиванием в CMS. Отдельного поля order нет намеренно.
  const statItems = stats.items.map((s, i) => ({
    key: i,
    value: lang === "en" ? s.value_en : s.value,
    label: lang === "en" ? s.label_en : s.label_ru
  }));

  // Фильтрация и сортировка уже выполнены в data/works.js — здесь только локализация.
  const categories = CATEGORIES.map((category) => ({
    slug: category.slug,
    aspect: category.aspect,
    title: lang === "en" ? category.title_en : category.title_ru,
    blurb: lang === "en" ? category.blurb_en : category.blurb_ru,
    works: category.works.map(mapWork)
  }));

  // Все карточки играют инлайн, поэтому модалка остаётся только за шоурилом
  const inlineIds = CATEGORIES.flatMap((category) => category.works.map((w) => w.youtube_id));
  const modalId = playingId && !inlineIds.includes(playingId) ? playingId : null;
  const playerLabels = lang === "en"
    ? { label: "Video player", close: "Close" }
    : { label: "Видеоплеер", close: "Закрыть" };
  // служебная подпись группы табов: имя роли для скринридера, не текст страницы —
  // поэтому живёт в коде рядом с подписями плеера, а не в content/*.json
  const workTabsLabel = lang === "en" ? "Work categories" : "Категории работ";
  // Служебные подписи слайдера: имена ролей для скринридера, не текст страницы.
  const baLabels = {
    before: c.beforeAfter.before,
    after: c.beforeAfter.after,
    ...(lang === "en"
      ? { slider: "Comparison wipe position", play: "Play comparison", pause: "Pause comparison", loading: "Loading",
          description: "Two silent clips playing side by side under a draggable divider: the raw camera footage on the left, the same fragment after editing on the right." }
      : { slider: "Положение шторки сравнения", play: "Запустить сравнение", pause: "Остановить сравнение", loading: "Загрузка",
          description: "Два немых ролика идут одновременно под перетаскиваемой границей: слева исходный материал с камеры, справа тот же фрагмент после монтажа." })
  };
  // Служебная подпись кнопки «наверх»: имя для скринридера, на экране — стрелка.
  const toTopLabel = lang === "en" ? "Back to top" : "Наверх";
  const testimonialNav = lang === "en"
    ? { prev: "Previous testimonial", next: "Next testimonial" }
    : { prev: "Предыдущий отзыв", next: "Следующий отзыв" };
  // Справочник типов метрик по slug: подпись нижней ячейки приходит оттуда,
  // в самой записи отзыва лежит только ссылка и значение.
  const metricLabels = Object.fromEntries(
    METRIC_TYPES.map((m) => [m.slug, lang === "en" ? m.label_en : m.label_ru])
  );
  // Имя канала — identity, одно на обе локали; тематика, текст и значения
  // метрик локализуются. Слот с неизвестным типом молча выпадает, а не ломает
  // карточку — тот же принцип белого списка, что у aspect в WorkCard.
  const testimonials = TESTIMONIALS.map((t) => ({
    slug: t.slug,
    channel_name: t.channel_name,
    logo: t.logo,
    topic: lang === "en" ? t.channel_topic_en : t.channel_topic_ru,
    quote: lang === "en" ? t.quote_en : t.quote_ru,
    topMetricValue: t.top_metric_value,
    topMetricLabel: lang === "en" ? t.top_metric_label_en : t.top_metric_label_ru,
    metrics: [1, 2, 3]
      .map((i) => ({
        type: t["metric_" + i + "_type"],
        label: metricLabels[t["metric_" + i + "_type"]],
        value: lang === "en" ? t["metric_" + i + "_value_en"] : t["metric_" + i + "_value_ru"]
      }))
      .filter((m) => m.label)
  }));

  // Поведение карточки задаётся kind из CMS через белый список: неизвестное
  // значение не даёт ни ссылки, ни обработчика, а не ломает разметку.
  // Ссылки Telegram и X берутся из settings.contact_url / contact_url_en —
  // это те же самые адреса, второго места хранения для них не заводится.
  const CONTACT_HREF = {
    telegram: settings.contact_url,
    twitter: settings.contact_url_en
  };
  const noActionHint = lang === "en" ? "no link" : "ссылки нет";
  const contactCards = contacts.items.map((item, i) => {
    const value = lang === "en" ? item.value_en : item.value;
    const subject = lang === "en" ? item.subject_en : item.subject_ru;
    // encodeURIComponent обязателен: кириллица и пробелы в теме иначе уезжают
    // в mailto как есть и обрезаются почтовым клиентом на первом же пробеле
    const mailto = "mailto:" + value + (subject ? "?subject=" + encodeURIComponent(subject) : "");
    const href = item.kind === "email" ? mailto : (CONTACT_HREF[item.kind] || null);
    return {
      key: i,
      kind: item.kind,
      label: lang === "en" ? item.label_en : item.label_ru,
      value: value,
      href: href,
      external: Boolean(CONTACT_HREF[item.kind]),
      noAction: item.kind === "location",
      noActionHint: noActionHint
    };
  });

  const sending = form === "sending";

  const navItems = c.nav.map((label, i) => ({ label: label, href: NAV_HREFS[i], active: spy.activeId === NAV_IDS[i] }));
  // Переход по якорю — нативный; здесь только замок scroll-spy на цель
  const navigateTo = (href) => spy.lockTo(href.slice(1));
  // Фокус уходит на wordmark в шапке — первую ссылку страницы, она же ведёт
  // на #top. Иначе он остался бы на кнопке, которая исчезает у верха.
  // behavior "auto" берёт scroll-behavior у html: smooth, а при
  // prefers-reduced-motion — auto, то есть мгновенно.
  const scrollToTop = () => {
    spy.lockTo(null);
    const mark = document.querySelector(".site-header .wordmark");
    if (mark) mark.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const langLinks = ["ru", "en"].map((code) => ({
    code: code,
    label: code,
    href: code === "ru" ? "/ru/" : "/",
    active: lang === code
  }));

  // INTEGRATION: запись выбора языка в localStorage
  const switchLang = (e, lb) => {
    e.preventDefault();
    try {
      localStorage.setItem("lang", lb.code);
    } catch {
      // storage заблокирован (приватный режим) — переходим без сохранения
    }
    location.href = lb.href + location.search + location.hash;
  };

  const faqItems = c.faq.items.map((it, i) => {
    const open = openFaq === i;
    return {
      q: it.q, a: it.a,
      btnId: "faq-btn-" + i,
      panelId: "faq-panel-" + i,
      expanded: String(open),
      toggle: () => setOpenFaq(open ? -1 : i)
    };
  });

  const fields = FIELD_ORDER.map((f) => ({
    key: f.name,
    id: "field-" + f.name,
    name: f.name,
    label: c.contact.labels[f.name],
    isText: f.kind === "text",
    isSelect: f.kind === "select",
    isTextarea: f.kind === "textarea",
    maxLength: f.cap,
    autoComplete: f.autoComplete,
    options: f.kind === "select" ? c.contact[f.name] : [],
    showHint: !!f.hint,
    showError: !!invalid[f.name],
    invalid: invalid[f.name] ? "true" : "false",
    value: f.kind === "select" ? selects[f.name] : undefined,
    onChange: f.kind === "select"
      ? (e) => { const v = e.target.value; setSelects((s) => Object.assign({}, s, { [f.name]: v })); }
      : undefined,
    disabled: sending
  }));

  return (
    <>
      <div className="playhead">
        <div className="playhead-fill" ref={playheadRef}></div>
      </div>

      <Header
        wordmark="FARE"
        navItems={navItems}
        langLinks={langLinks}
        cta={c.cta}
        menuLabel={c.menu}
        onLangSwitch={switchLang}
        onNavigate={navigateTo}
      />

      <main id="top">
        <Hero
          c={{ ...c.hero, status: lang === "en" ? settings.status_en : settings.status }}
          showreelId={settings.showreel_id}
          showreelEnabled={settings.showreel_enabled}
          openPlayer={openPlayer}
        />
        <Stats items={statItems} industries={c.stats.industries} />
        {/* Секции нет, пока оба ролика не лежат в public/media/before-after —
            флаг считает vite.config при чтении конфига. */}
        {__HAS_BEFORE_AFTER__ && <BeforeAfter c={c.beforeAfter} labels={baLabels} />}
        <Work c={c.work} categories={categories} tabsLabel={workTabsLabel} />
        <Testimonials c={c.testimonials} items={testimonials} navLabels={testimonialNav} />
        <Process c={c.process} />
        <Why c={c.why} />
        <Faq c={c.faq} faqItems={faqItems} />
        <Contact
          c={c.contact}
          fields={fields}
          isSuccess={form === "success"}
          showForm={form !== "success"}
          isError={form === "error"}
          isSending={sending}
          submitLabel={sending ? c.contact.sending : c.contact.button}
          onSubmit={submit}
        >
          <ContactCards cards={contactCards} />
        </Contact>
      </main>

      <Footer wordmark="FARE" c={c.footer} />
      {showTop !== null && <BackToTop visible={showTop} label={toTopLabel} onClick={scrollToTop} />}

      <PlayerModal youtubeId={modalId} onClose={closePlayer} label={playerLabels.label} closeLabel={playerLabels.close} />
    </>
  );
}
