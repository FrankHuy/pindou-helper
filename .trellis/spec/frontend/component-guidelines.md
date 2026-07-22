# Component Guidelines

> How UI surfaces are structured in this Vite + React app.

---

## Overview

There is **no component library**, no CSS modules, no Tailwind. UI is:

| Surface | Location | Role |
|---------|----------|------|
| App shell | `src/App.tsx` + `App.css` | Tabs, bead generate UI, footer, path shell pages |
| Feature tabs | `src/features/<name>/` | Self-contained tab body + co-located CSS |
| Info pages | `src/features/info/` | Privacy / About full-page views |

Default export function components. Chinese user-facing copy. Prefer plain buttons/`label` + native controls over heavy abstractions.

---

## Shell vs feature tabs

### App shell (`App.tsx`)

Owns:

- `ShellPage`: `'app' | 'privacy' | 'about' | 'admin' | auth pages` synced with `/`, `/privacy`, `/about`, `/admin`, `/login`… via `history.pushState` + `popstate` (no react-router)
- `AppTab`: `'bead' | 'workshop' | 'xhs'`
- Bead generation state and canvas (large local state tree)
- Footer links → Privacy / About

Rules:

- **Bead** and **workshop** sections stay **mounted** when inactive: `className={… is-hidden}` + `aria-hidden` so generate / highlight state survives tab switches.
- **XHS** may mount only when active (`{tab === 'xhs' && <XhsDownloadTab />}`) — network tab; remount is acceptable.
- Header **upload** is **bead-only**. Workshop and XHS own their inputs.
- When `shellPage !== 'app'`, render info page layout (back → `navigateShell('app')`); do not require a router package.

### Feature tab modules

```
src/features/<feature>/
  <Name>Tab.tsx   # or Page.tsx for info
  <feature>.css   # import from the TSX file
  optional *Api.ts / helpers
```

- **Do not** import bead generate pipeline into XHS, or XHS client into bead/workshop.
- Workshop may import pure `src/lib/workshop/*`, `color-match`, `drawPattern`, palette data.
- Info pages: **Privacy copy is bead-tool only** — no 小红书 / xhs / share-link language (product decision). About: tip QR unlabeled, email visible.

---

## Component structure

Typical feature tab:

1. Imports (React, pure lib, CSS)
2. Local types (`Phase`, props)
3. Module-level helpers (script loaders, constants) if needed
4. `export default function …`
5. State + refs (including **generation token** for async)
6. Effects (object URL revoke, external script widgets)
7. Handlers
8. JSX: Chinese labels, error banners, primary actions

Props are rare for tabs (shell does not pass bead state down). Info pages take minimal callbacks:

```ts
type PrivacyPageProps = { onBack: () => void }
```

---

## Styling

| Pattern | Where |
|---------|--------|
| Global shell | `App.css`, `index.css` |
| Feature-scoped | `features/*/\*.css` imported by that feature only |
| Utility hide | `.is-hidden` on keep-alive sections |

- Class names: kebab or BEM-ish (`app-tab`, `color-row`, `workshop-host`)
- Active chips: `chip-button` + `active`
- No inline style except dynamic colors (`backgroundColor: bead.hex`) and canvas sizing

---

## Interaction patterns

| Pattern | Reference |
|---------|-----------|
| Chip / stepper controls | Bead controls in `App.tsx` |
| Color row: body = highlight, trailing = disable | Bead palette list |
| Dim highlight preview | `drawPattern` + `highlightCode`; workshop pixel path uses `HIGHLIGHT_DIM_ALPHA` |
| External widget lifecycle | Turnstile in `XhsDownloadTab` (load script once, render/reset/remove) |
| Split handle | `BeadWorkshopTab` — live line on move; analyze on pointerup |
| Lightbox + keyboard | XHS tab |

---

## Accessibility (practical bar)

- Tabs: `aria-current="page"` on active app tab; `aria-label` on tab nav
- Icon-only controls: `title` + `aria-label` (e.g. disable color)
- Keep-alive hidden regions: `aria-hidden={true}` when not active
- Prefer `<button type="button">` over clickable divs
- Form submit for XHS parse; disable while `loading`

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Unmount bead/workshop on tab switch | Keep mounted + `is-hidden` |
| Wire bead header upload to workshop | Separate file input in workshop |
| Hotlink XHS CDN in `<img>` | Only `proxyPath` from parse API |
| Put OCR or network in workshop | Local Canvas only |
| Privacy page mentions XHS download | Forbidden product copy |
| New runtime UI dependency for one tab | Prefer existing CSS + React patterns |
