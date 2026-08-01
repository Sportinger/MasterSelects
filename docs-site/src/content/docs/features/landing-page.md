---
title: "Landing Page"
---

The `START` dock layout is implemented, and the `/landing` and
`landing.localhost` routes resolve the landing entry experience. These routes
load the editor; `START` remains available as a factory favorite.

---

## Goal

Keep the working editor directly reachable through a minimal, layout-based
front-facing surface with AI chat, project-media handling, and an Open action.

---

## Dev URLs

| URL | Behavior |
|---|---|
| `http://localhost:5173/` | Editor using the last active layout |
| `http://landing.localhost:5173/` | Resolves the landing entry experience and loads the editor bundle |
| `http://localhost:5173/landing` | Same landing entry experience when the subdomain is unavailable |

---

## Implementation Notes

- `START` is a protected factory layout and a default favorite immediately to
  the right of `3D EDIT`.
- The layout is one full-size, layout-only panel; it is intentionally hidden
  from the generic panel pickers and has no tab strip or editor toolbar.
- Landing entry selection loads the editor bundle. The landing surface itself
  is the `start` dock panel; there is no separate page layered over the editor.
- When `START` is active, the visible controls are a responsive AI chat pill,
  a small top-right Open action, project-file previews, and a finished-video
  preview when an output is present. Files can be dropped anywhere on the
  surface for import.
- Open loads the factory `VIDEO EDIT` layout in place and reuses the existing
  dock transition with a three-second duration. Media, Preview, the right-side
  tools, and Timeline enter as four distinct overlapping stages; the toolbar
  joins from the top.
- Before the panels enter, the chat pill contracts symmetrically along the
  x-axis and fades away. This 480 ms exit is included in the three-second total.
- The staged reveal uses the dock layout transition in sequence mode. Media,
  Preview, and Timeline are eligible for live-surface animation; other layout
  elements may use transition clones.
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
- Submitting the chat starts a resumable background job: it prepares a single
  source video when available, runs a FlashBoard AI chat turn, and renders the
  current timeline. Hosted AI chat can require authentication and credits.
- Desktop centers the landing content. Narrow screens retain the centered
  layout with safe-area padding; they do not dock the pill above the safe area.
- Hosted Pages requests outside the supported editor, landing, admin,
  credit-claim, and legal paths return `404` instead of loading the editor
  fallback.
- The dock-layout model is the implementation. Routing selects the landing
  experience.
