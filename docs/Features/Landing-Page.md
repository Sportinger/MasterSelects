[Back to Feature Docs](./README.md)

# Landing Page

Current state: dev-only minimal chat entry, separated from the editor.

---

## Goal

Keep the working editor directly reachable while testing a radically simple front-facing surface: one welcoming chat pill and no surrounding website chrome.

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
- The only visible control is a responsive chat pill with an auto-growing prompt field and send action.
- Enter submits; Shift+Enter keeps multiline input available. Focus, disabled, loading, and screen-reader feedback states are built in.
- The debug route does not call an AI provider, require authentication, or spend credits. `LandingPage` exposes an optional prompt-submit boundary for the later production chat connection.
- Desktop places the pill in the visual center; narrow mobile screens dock it above the safe area for thumb reach.
- Hosted Pages requests outside the editor, landing, and credit-claim entry paths return `404` instead of loading the editor fallback.
- This is a staging experiment, not yet the final production routing plan.
