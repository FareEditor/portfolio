import { useEffect, useRef } from 'react';

// Публичный site key; без него (локальная сборка) остаётся заглушка слота
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function Contact({ c, contactUrl, fields, isSuccess, showForm, isError, isSending, submitLabel, submitCursor, submitOpacity, onSubmit, children }) {
  const slotRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !slotRef.current) return;
    // Явный рендер: Turnstile сам добавляет в форму hidden-input cf-turnstile-response
    const render = () => {
      if (slotRef.current && widgetIdRef.current === null) {
        widgetIdRef.current = window.turnstile.render(slotRef.current, { sitekey: TURNSTILE_SITE_KEY });
      }
    };
    if (window.turnstile) { render(); return; }
    window.__fareTurnstileOnload = render;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__fareTurnstileOnload';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    // Токен одноразовый: после неудачной отправки виджет надо перевыпустить
    if (isError && window.turnstile && widgetIdRef.current !== null) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [isError]);

  return (
    <section className="section" id="contact" aria-labelledby="contact-title">
      <div className="contact-layout">
        <div className="contact-intro" data-reveal="true">
          <span className="eyebrow">{c.eyebrow}</span>
          <h2 className="section-title" id="contact-title">{c.title}</h2>
          <p className="contact-text">{c.text}</p>
          <p className="contact-reply">
            <span className="reply-dot" aria-hidden="true"></span>{c.reply}
          </p>
          <a className="contact-alt" href={contactUrl} target="_blank" rel="noopener noreferrer">{c.alt}</a>
        </div>

        <div className="contact-panel">
          {isSuccess && (
            <div className="form-success" role="status">
              <span className="success-mark" aria-hidden="true">✓</span>
              <p className="success-text">{c.success}</p>
            </div>
          )}
          {showForm && (
            /* INTEGRATION: endpoint формы — POST /api/contact (Cloudflare Worker) */
            <form className="contact-form" noValidate onSubmit={onSubmit}>
              {fields.map((fd) => (
                <div className="field" key={fd.key}>
                  <label className="field-label" htmlFor={fd.id}>{fd.label}</label>
                  {fd.isText && (
                    <input className="field-input" id={fd.id} name={fd.name} type="text" required maxLength={fd.maxLength} disabled={fd.disabled} aria-invalid={fd.invalid} style={{ borderColor: fd.borderColor }} />
                  )}
                  {fd.isSelect && (
                    <select className="field-select" id={fd.id} name={fd.name} required disabled={fd.disabled} aria-invalid={fd.invalid} value={fd.value} onChange={fd.onChange} style={{ borderColor: fd.borderColor, color: fd.selectColor }}>
                      <option value="" disabled>{c.choose}</option>
                      {fd.options.map((op) => (
                        <option value={op.value} key={op.value}>{op.label}</option>
                      ))}
                    </select>
                  )}
                  {fd.isTextarea && (
                    <textarea className="field-textarea" id={fd.id} name={fd.name} rows="5" required maxLength={fd.maxLength} disabled={fd.disabled} aria-invalid={fd.invalid} style={{ borderColor: fd.borderColor }}></textarea>
                  )}
                  {fd.showHint && <span className="field-hint">{c.hint}</span>}
                  {fd.showError && <span className="field-error" role="alert">{c.required}</span>}
                </div>
              ))}

              {/* INTEGRATION: honeypot — Worker rejects the request if this field is non-empty */}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="field-website">Website</label>
                <input id="field-website" name="website" type="text" tabIndex="-1" autoComplete="off" />
              </div>

              {/* INTEGRATION: Cloudflare Turnstile widget */}
              {TURNSTILE_SITE_KEY ? (
                <div className="turnstile-slot" ref={slotRef}></div>
              ) : (
                /* Ключа нет (локальная сборка): честно показываем, что форма
                   не отправится. Пустой hidden-input хуже, чем ничего —
                   он превращает ошибку конфигурации в «отказ по вине юзера» */
                <div className="turnstile-slot">Turnstile не настроен — задайте VITE_TURNSTILE_SITE_KEY</div>
              )}

              {isError && <p className="form-error" role="alert">{c.error}</p>}

              <button className="btn-primary btn-submit" type="submit" disabled={isSending} style={{ cursor: submitCursor, opacity: submitOpacity }}>
                {isSending && <span className="spinner" aria-hidden="true"></span>}
                {submitLabel}
              </button>
              <p className="form-micro">{c.micro}</p>
            </form>
          )}
        </div>
      </div>

      {/* Карточки каналов связи — параллельный форме путь, не её замена.
          Содержимое приходит слотом: секция ничего не знает об их данных. */}
      {children}
    </section>
  );
}
