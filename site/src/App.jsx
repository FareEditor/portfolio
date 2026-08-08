import { useEffect, useRef, useState } from 'react';
import ru from './content/ru.js';
import en from './content/en.js';
import { WORKS } from './data/works.js';
import settings from './data/settings.json';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Proof from './components/Proof.jsx';
import Work from './components/Work.jsx';
import Process from './components/Process.jsx';
import Why from './components/Why.jsx';
import Faq from './components/Faq.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';
import './styles/tokens.css';
import './styles/app.css';

const CONTENT = { ru, en };

// cap повторяет FIELD_CAPS воркера: клиент режет длину там же, где режет сервер,
// иначе слишком длинный ввод проходит локальную проверку и падает «сетевой» ошибкой
const FIELD_ORDER = [
  { name: "name", kind: "text", cap: 200 },
  { name: "contact", kind: "text", hint: true, cap: 200 },
  { name: "project_type", kind: "select", cap: 100 },
  { name: "budget", kind: "select", cap: 100 },
  { name: "message", kind: "textarea", cap: 5000 }
];

export default function App({ lang }) {
  const c = CONTENT[lang];

  const [openFaq, setOpenFaq] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState("idle");
  const [invalid, setInvalid] = useState({});
  const [selects, setSelects] = useState({ project_type: "", budget: "" });
  const [playingId, setPlayingId] = useState(null);

  const playheadRef = useRef(null);
  const headerRef = useRef(null);
  const ioRef = useRef(null);
  const triggeredRef = useRef(false);
  const safetyRef = useRef(0);

  const reveal = (el) => { el.dataset.revealed = "1"; };

  const revealInView = () => {
    const vh = window.innerHeight || 0;
    document.querySelectorAll("[data-reveal]").forEach((el) => {
      if (el.dataset.revealed === "1") return;
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.94 && r.bottom > 0) reveal(el);
    });
  };

  const onScroll = () => {
    const d = document.documentElement;
    const max = d.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (playheadRef.current) playheadRef.current.style.width = (p * 100).toFixed(2) + "%";
    revealInView();
    const h = headerRef.current;
    if (h) {
      const on = window.scrollY > 24;
      h.style.background = on ? "var(--bg-blur)" : "transparent";
      h.style.borderBottomColor = on ? "var(--line)" : "transparent";
      h.style.backdropFilter = on ? "blur(14px)" : "none";
    }
  };

  const setupReveal = () => {
    const els = Array.from(document.querySelectorAll("[data-reveal]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ioRef.current) ioRef.current.disconnect();
    if (reduce) { els.forEach(reveal); return; }
    revealInView();
    ioRef.current = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { triggeredRef.current = true; reveal(e.target); ioRef.current.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });
    els.forEach((el) => { if (el.dataset.revealed !== "1") ioRef.current.observe(el); });
  };

  useEffect(() => {
    // js-reveal ставится инлайн-скриптом в <head> обоих документов —
    // до первой отрисовки, иначе пререндеренный контент мигнёт.
    // Отметка о гидрации гасит страховочный таймер из того же скрипта.
    document.documentElement.setAttribute("data-hydrated", "1");
    const onScrollEvent = () => { triggeredRef.current = true; onScroll(); };
    window.addEventListener("scroll", onScrollEvent, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
    setupReveal();
    // страховка: если ни scroll, ни IO не сработали (страница во фрейме) — показываем всё
    safetyRef.current = setTimeout(() => {
      revealInView();
      if (!triggeredRef.current) document.querySelectorAll("[data-reveal]").forEach(reveal);
    }, 500);
    return () => {
      window.removeEventListener("scroll", onScrollEvent);
      window.removeEventListener("resize", onScroll);
      clearTimeout(safetyRef.current);
      if (ioRef.current) ioRef.current.disconnect();
    };
  }, []);

  // Плеер-фасад: до клика — статичное превью, по клику карточка с этим youtube_id
  // монтирует iframe youtube-nocookie (см. WorkCard/MotionCard)
  const openPlayer = (id) => setPlayingId(id);

  const mapWork = (w, extra) => {
    const client = lang === "en" ? w.client_en : w.client;
    const format = lang === "en" ? w.format_en : w.format;
    const duration = lang === "en" ? w.duration_en : w.duration;
    const title = lang === "en" ? w.title_en : w.title_ru;
    return Object.assign({
      key: w.slug,
      youtube_id: w.youtube_id,
      thumbnail: w.thumbnail,
      meta: [client, format, duration].join(" · "),
      title: title,
      body: lang === "en" ? w.body_en : w.body_ru,
      url: "https://www.youtube.com/watch?v=" + w.youtube_id,
      thumbLabel: c.work.thumb,
      playLabel: c.work.play + " — " + title,
      playing: playingId === w.youtube_id,
      play: () => openPlayer(w.youtube_id)
    }, extra || {});
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

  const published = WORKS.filter((w) => w.published).sort((a, b) => a.order - b.order);
  const cases = published.filter((w) => w.type === "case");
  const motion = published.filter((w) => w.type === "motion");

  // адаптивная раскладка по количеству кейсов: 1–2 → одна колонка, 3–6 → две, 7+ → две + «показать все»
  const n = cases.length;
  const single = n <= 2;
  const caseCols = single ? "1fr" : "repeat(auto-fit,minmax(min(100%,420px),1fr))";
  const capped = n >= 7 && !showAll;
  const visible = capped ? cases.slice(0, 6) : cases;

  const visibleCases = visible.map((w) =>
    mapWork(w, {
      span: !single && w.featured ? "1 / -1" : "auto",
      cardCols: single || (!single && w.featured) ? "repeat(auto-fit,minmax(min(100%,340px),1fr))" : "1fr"
    })
  );

  const sending = form === "sending";

  const navItems = c.nav.map((label, i) => ({ label: label, href: ["#work", "#process", "#about", "#contact"][i] }));

  const langLinks = ["ru", "en"].map((code) => ({
    code: code,
    label: code,
    href: code === "ru" ? "/ru/" : "/",
    active: lang === code,
    bg: lang === code ? "var(--accent-soft)" : "transparent",
    fg: lang === code ? "var(--accent)" : "var(--text-dim)"
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
      color: open ? "var(--accent)" : "var(--text)",
      iconTransform: open ? "rotate(45deg)" : "rotate(0deg)",
      rows: open ? "1fr" : "0fr",
      opacity: open ? "1" : "0",
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
    options: f.kind === "select" ? c.contact[f.name] : [],
    showHint: !!f.hint,
    showError: !!invalid[f.name],
    invalid: invalid[f.name] ? "true" : "false",
    borderColor: invalid[f.name] ? "var(--accent-warm)" : "var(--line)",
    value: f.kind === "select" ? selects[f.name] : undefined,
    selectColor: f.kind === "select" && !selects[f.name] ? "var(--text-dim)" : "var(--text)",
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
        headerRef={headerRef}
        onLangSwitch={switchLang}
      />

      <main id="top">
        <Hero
          c={{ ...c.hero, status: lang === "en" ? settings.status_en : settings.status }}
          showreelId={settings.showreel_id}
          openPlayer={openPlayer}
        />
        <Proof c={c.proof} />
        <Work
          c={c.work}
          caseCols={caseCols}
          visibleCases={visibleCases}
          hasMoreCases={capped}
          showAllCases={() => setShowAll(true)}
          motionItems={motion.map((w) => mapWork(w))}
        />
        <Process c={c.process} />
        <Why c={c.why} />
        <Faq c={c.faq} faqItems={faqItems} />
        <Contact
          c={c.contact}
          contactUrl={lang === "en" ? settings.contact_url_en : settings.contact_url}
          fields={fields}
          isSuccess={form === "success"}
          showForm={form !== "success"}
          isError={form === "error"}
          isSending={sending}
          submitLabel={sending ? c.contact.sending : c.contact.button}
          submitCursor={sending ? "not-allowed" : "pointer"}
          submitOpacity={sending ? "0.7" : "1"}
          onSubmit={submit}
        />
      </main>

      <Footer wordmark="FARE" c={c.footer} />
    </>
  );
}
