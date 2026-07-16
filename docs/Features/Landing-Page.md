[Back to Feature Docs](./README.md)

# Landing Page

Current state: dev-only concept entry, separated from the editor.

---

## Goal

Keep the working editor directly reachable while testing a front-facing website surface that explains MasterSelects before users enter the app.

---

## Dev URLs

| URL | Behavior |
|---|---|
| `http://localhost:5173/` | Editor, unchanged |
| `http://landing.localhost:5173/` | Landing page preview |
| `http://localhost:5173/landing` | Landing page fallback if the subdomain is unavailable |

---

## Implementation Notes

- Entry selection happens before the editor bundle is loaded.
- The landing page is intentionally isolated from the editor UI and its app shell.
- The landing CTA points back to the editor root for now, so the existing workflow stays intact.
- Hosted Pages requests outside the editor, landing, and credit-claim entry paths return `404` instead of loading the editor fallback.
- This is a staging experiment, not yet the final production routing plan.
