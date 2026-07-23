# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

One-time Trellis init task: populate `.trellis/spec/` so implement/check agents follow real project conventions.

---

## Status

- [x] Fill frontend guidelines
- [x] Add code examples (paths and contracts from real modules)

Completed: 2026-07-22 (close-out). Specs under `.trellis/spec/frontend/` are filled from codebase reality, including bead, workshop, XHS, and Phase 1 auth/admin/AI guard layout.

---

## Spec files (frontend)

| File | Status |
|------|--------|
| `directory-structure.md` | Filled — features, worker auth/guard/admin/db, import boundaries |
| `component-guidelines.md` | Filled — shell tabs, no router, co-located CSS |
| `hook-guidelines.md` | Filled — inline patterns, no hooks bag |
| `state-management.md` | Filled — debounce, generation tokens, keep-alive |
| `type-safety.md` | Filled — palette/pattern/workshop/Worker contracts |
| `quality-guidelines.md` | Filled — forbidden/required, auth mail/Turnstile invariants |
| `workshop.md` | Filled — domain pipeline |
| `xhs-download.md` | Filled — parse/proxy/Turnstile |
| `index.md` | Filled — checklist + design decisions (incl. auth) |

Thinking guides in `.trellis/spec/guides/` remain shared defaults.

---

## Completion

Developer requested finish of bootstrap. Checklist met with real examples (not placeholders).

Archive with:

```bash
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, new joiners get `00-join-*` onboarding instead of this bootstrap task.
