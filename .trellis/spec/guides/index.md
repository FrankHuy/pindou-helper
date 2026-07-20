# Thinking Guides

> Short checklists that point at code-specs — not a second copy of contracts.

---

## Available Guides

| Guide | Purpose | When to use |
|-------|---------|-------------|
| [Code Reuse](./code-reuse-thinking-guide.md) | Avoid forked metrics / packs / loaders | New util, second copy of logic, new dep urge |
| [Cross-Layer](./cross-layer-thinking-guide.md) | SPA ↔ lib ↔ Worker boundaries | API fields, allowlists, privacy copy vs product |

---

## Triggers

### Cross-layer

- [ ] Touching `worker/` and `src/features/` in one change
- [ ] New `/api/*` route or JSON field
- [ ] Turnstile / secrets / `import.meta.env`
- [ ] Privacy or About copy vs real network behavior
- [ ] Image URL leaves the browser or Worker

→ [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) then the matching `frontend/*.md` spec.

### Code reuse

- [ ] About to paste `colorDistance` or grid math
- [ ] New npm dependency for something `src/lib` could do
- [ ] Second tab needs debounce / abort / generation token
- [ ] Merchant pack or palette table change

→ [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### Pre-modification

```bash
rg -n "symbol_or_string" src worker
```

Update every call site and the owning code-spec in the same change when contracts move.

---

## Spec map (contracts live here)

| Topic | Spec |
|-------|------|
| Layout / imports | `frontend/directory-structure.md` |
| Generate + types | `frontend/type-safety.md`, `quality-guidelines.md` |
| Workshop | `frontend/workshop.md` |
| XHS + Turnstile | `frontend/xhs-download.md` |
| UI shell | `frontend/component-guidelines.md` |

---

**Principle**: 30 minutes of boundary thinking beats a broken allowlist or a second color metric.
