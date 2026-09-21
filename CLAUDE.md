# fareeditor.com

Portfolio site for a freelance video editor. Single purpose: convert visitors
into project enquiries. Not a showcase, not an art piece.

## Stack

- Vite + React, static output, deployed to GitLab Pages
- Decap CMS (GitLab backend, PKCE auth) for content
- Cloudflare Worker at `/api/*` for the contact form
- Cloudflare KV for lead archive
- Monorepo: `site/` and `worker/` are independent packages

## Hard rules

- **No Docker, no containers.** Native tooling only.
- **No Electron-based tooling.**
- **No animation libraries.** CSS transitions and IntersectionObserver only.
- **No UI component libraries.** No Tailwind, no shadcn, no MUI.
- **No localStorage/sessionStorage abstractions** — use the API directly.
- Keep dependencies minimal. Every new package needs a stated reason.
- Prefer explicit configuration over convention-based magic.

## Design history

`design/FARE_Landing_dc.html` is the original approved design, produced in
Claude Design. It uses a proprietary template runtime (`<x-dc>`, `<sc-for>`,
`<sc-if>`, `{{ }}`) that does NOT run here.

**It is a historical artefact, not the source of truth.** The site has since
moved to its own visual direction: tokens, type scale and CSS rules have been
redefined and no longer match that file. Read it for provenance only — do not
port from it, do not re-derive tokens from it, do not treat divergence from it
as a defect.

Current source of truth:
- `site/src/styles/tokens.css` — design tokens.
- `site/src/styles/app.css` — component styles.

Standing rules that survived the redesign:
- Presentation values (colours, opacity, transforms, layout strings) live in
  CSS, not in props and not in `element.style`. Use a class or a custom
  property.
- Preserve every `INTEGRATION:` comment as a code comment at the same location.

## Content rules

- Bilingual RU/EN. **The two locales are not translations of each other** —
  they have deliberately different social proof and CTA channels. Never
  auto-translate one into the other or "sync" them.
- Every localised field has an explicit `_en` counterpart
  (`client`/`client_en`, `duration`/`duration_en`, etc.). If you add a field
  that appears on a card, add its `_en` pair.
- Do not rewrite, shorten or "improve" any user-facing copy. It is final.

## Accessibility floor

`aria-expanded` / `aria-controls` on the accordion, `role="region"` on panels,
`role="alert"` on errors, `aria-invalid` on fields, visible `:focus-visible`,
`prefers-reduced-motion` respected, content readable with JS disabled.

## Language routing

- `/` serves English and is `x-default`. `/ru/` serves Russian.
- Both are real, physically built HTML documents — not client-side routes.
- Redirect from `/` to `/ru/` happens in the browser only: read localStorage,
  fall back to `navigator.language`. Never redirect server-side or by IP —
  it breaks indexing and Cloudflare caches the wrong variant for everyone.
- The language switcher writes the choice to localStorage and navigates.

## Never do

- Do not commit secrets. Tokens live in `.dev.vars` locally and in
  `wrangler secret` / GitLab CI variables in production.
- Do not add a YouTube iframe on page load. Previews are static images;
  the player mounts on click.
  **Agreed exception — the before/after section.** Its two `<video>` elements
  carry `preload="none"` and no `src` until an `IntersectionObserver` reports
  the section on screen; nothing is requested while the visitor has not
  scrolled to it. This follows the rule rather than breaking it: the ban is on
  loading a player the visitor is not looking at. Do not "fix" it back to a
  click-to-play facade — the two clips only make sense playing side by side.
- Do not send transactional email. iCloud custom domain cannot do it and
  Workers cannot speak SMTP. Telegram + KV only.
