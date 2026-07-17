# Implementation Plan — PNG legend + highlight

## Checklist

### 1. pattern.ts drawing
- [ ] 1.1 Extend `DrawOptions` with optional `highlightCode`
- [ ] 1.2 In `drawPattern`, apply dim + stroke when highlight active
- [ ] 1.3 Helper: sorted usage entries from `pattern.counts` + cell hex lookup
- [ ] 1.4 `layoutLegend` / `drawLegend` for wrap chips + title/summary
- [ ] 1.5 `exportPattern`: taller canvas, pattern top, legend bottom, no highlight

### 2. App UI
- [ ] 2.1 `highlightCode` state + clear on invalid/disabled/zero count
- [ ] 2.2 Pass `highlightCode` into preview `drawPattern`
- [ ] 2.3 Color row: body click toggles highlight; trailing icon toggles disable (stopPropagation)
- [ ] 2.4 CSS: highlighted row, disable icon button, hit area

### 3. Validate
- [ ] 3.1 `npm run build`
- [ ] 3.2 `npm run lint` (src clean)
- [ ] 3.3 Manual: export PNG has legend; many colors wrap; highlight toggles; disable icon independent

## Validation commands

```bash
npm run build
npm run lint
```

## Review gates

- Export always includes legend with correct sort
- Preview highlight never bleeds into export
- Disable no longer bound to full-row click

## Rollback

- Revert `pattern.ts` draw/export + App row handlers if regression on export
