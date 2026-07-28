[Back to Feature Docs](./README.md)

# Landing Page

Current state: dev-only minimal chat entry implemented as the built-in `START`
dock layout.

---

## Goal

Keep the working editor directly reachable while testing a radically simple
front-facing surface: one welcoming chat pill, a small Open action, and no
surrounding website chrome.

---

## Dev URLs

| URL | Behavior |
|---|---|
| `http://localhost:5173/` | Editor using the last active layout |
| `http://landing.localhost:5173/` | Opens the editor directly in `START` |
| `http://localhost:5173/landing` | Same `START` layout when the subdomain is unavailable |

---

## Implementation Notes

- `START` is a protected factory layout and a default favorite immediately to
  the right of `3D EDIT`.
- The layout is one full-size, layout-only panel; it is intentionally hidden
  from the generic panel pickers and has no tab strip or editor toolbar.
- Landing entry selection loads the editor bundle and activates `START` before
  the first visible paint. There is no second page layered over the editor.
- The visible controls are a responsive chat pill and a small top-right Open
  action.
- Open loads the factory `VIDEO EDIT` layout in place and reuses the existing
  dock transition with a three-second duration. Media, Preview, the right-side
  tools, and Timeline enter as four distinct overlapping stages; the toolbar
  joins from the top.
- Before the panels enter, the chat pill contracts symmetrically along the
  x-axis and fades away. This 480 ms exit is included in the three-second total.
- The staged reveal animates the live panel surfaces without the puzzle
  overshoot or a final clone-to-live swap, avoiding a visible end jolt.
- The light Start surface remains fixed underneath the whole sequence. Loading
  `START` from the favorite bar runs the same sequence in reverse: the gray
  editor panes leave stage by stage and reveal the light surface.
- Split handles stay transparent while the light surface is exposed, so the
  final editor grid is not drawn over the transition background in advance.
- The global toolbar enters from above over one second when leaving `START`.
  When returning, it becomes an overlay and exits upward over one second while
  the dock expands underneath it. `START` is also detected from its actual root
  panel, so project hydration cannot accidentally leave the toolbar visible.
- On the reverse transition, existing splitter lines fade out over the same
  one-second interval instead of disappearing in a single frame.
- Startup dialogs stay paused during the transition so they cannot cover the
  layout reveal.
- Enter submits; Shift+Enter keeps multiline input available. Focus, disabled, loading, and screen-reader feedback states are built in.
- The debug route does not call an AI provider, require authentication, or spend credits. `LandingPage` exposes an optional prompt-submit boundary for the later production chat connection.
- Desktop places the pill in the visual center; narrow mobile screens dock it above the safe area for thumb reach.
- Hosted Pages requests outside the editor, landing, and credit-claim entry paths return `404` instead of loading the editor fallback.
- This remains a staging entry surface; the dock-layout model itself is now the
  canonical implementation.
