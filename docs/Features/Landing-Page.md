[Back to Feature Docs](./README.md)

# Landing Page

The public creation-mode chooser is currently disabled in development and
production. `/`, `/landing`, `/landing-preview`, and the legacy
`landing.localhost` entry canonicalize to `/editor`. Closing the legal dialog
also returns to `/editor`, and direct editor/chat/medium entries no longer add a
landing return entry to browser history.

## Public product information

`/about/` is a separate, readable product page. It describes video, audio,
motion, 3D and live workflows, building tools with coding agents while working
on a project, community contributions, bridge diagnostics, and touch/iPad
support (with phone workflows still being refined). It links to the public
AGPL editor source, documentation, and the editor.

The page is ordinary HTML and CSS, available without JavaScript or WebGPU.
Vite builds `about/index.html` as a second entry, without loading the editor
runtime. The editor's **Info → About MasterSelects** link opens it separately,
preserving the current project. The README and docs homepage also link to it.
Pages middleware allows only `/about`, `/about/`, and `/about/index.html`;
unknown child routes continue to return 404.

The editor shell's description, social metadata, JSON-LD and no-JavaScript
fallback describe the same product. The previous embedded tool catalogue and
crawler-directed prompt have been removed; technical readers are linked to
the maintained bridge documentation instead. `public/robots.txt` references
`public/sitemap.xml`, which lists the editor, product page and documentation.
There is no user-agent-specific description or special AI-only page.

Chrome's AI playback chooses how to extract and summarize a page. These changes
make the current description accessible but do not guarantee a particular
audio summary, especially when playback starts inside the editor UI.

The underlying chooser and layouts remain available in source for possible
reactivation. `CHAT` remains available through `/chat` as a factory favorite,
with durable identifier `factory-start`; the Medium layout remains available
through `/medium` as `factory-medium-edit`.

---

## Goal

Keep AI-first creation, a guided editor, and the full professional editor
directly reachable through one responsive entry surface. Easy provides AI
chat, project-media handling, and an Open action inside `CHAT`; Medium keeps AI
and the essential editing surfaces visible together; Hard exposes the normal
editor workspace.

---

## Dev URLs

| URL | Behavior |
|---|---|
| `http://localhost:5173/` | Canonicalizes to `/editor` and opens the last active editor layout |
| `http://landing.localhost:5173/` | Canonicalizes to the editor while the landing chooser is disabled |
| `http://localhost:5173/landing` | Canonicalizes to `/editor` |
| `http://localhost:5173/chat` | Opens Easy in the full-size `CHAT` layout |
| `http://localhost:5173/medium` | Opens the clean, AI-guided Medium editor layout |
| `http://localhost:5173/editor` | Opens Hard in the normal editor workspace |

---

## Implementation Notes

- `CHAT` is a protected factory layout and a default favorite immediately to
  the right of `3D EDIT`.
- The layout is one full-size, layout-only panel; it is intentionally hidden
  from the generic panel pickers and has no tab strip or editor toolbar.
- The creation-mode page presents `EASY`, `MEDIUM`, and `HARD` cards over the
  dark landing backdrop. Desktop keeps all three cards in one row. Compact
  mobile layouts stack all three with controlled vertical overlap and keep the
  cards static so a loaded editor cannot replace or leak across the backdrop.
- The live Easy preview is hidden synchronously while the viewport is changing
  and returns after its measurements settle. This prevents the landing/editor
  split from flashing or exposing oversized intermediate layouts during window
  resize.
- The landing surface owns vertical scrolling so all three overlapping cards
  remain reachable on short Android and WebKit viewports.
- `MEDIUM` is a protected factory layout with an AI panel on the left and the
  existing Assets, Viewer, and Timeline panels arranged on the right. It reuses
  the normal editor panels and behavior instead of maintaining a second editor.
- Medium applies a route-scoped clean presentation: compact global toolbar,
  reduced dock chrome, simplified tabs, and no internal AI workspace selector.
  Its AI chat is activated after project startup so edit requests stay in the
  visible guided workspace. The dedicated factory layout is restored after
  project hydration instead of being replaced by the last Hard layout.
- Loading `/chat` never opens the retired first-run Welcome overlay and never
  replaces `CHAT` with an automatic H/V Mobile editor layout. Project choices
  stay inside Chat; `/editor` uses the current editor project chooser.
- When `CHAT` is active, the visible controls are a responsive AI chat pill,
  top-right Mail, Project, and Open actions, project-file previews, and a
  finished-video preview when an output is present. Files can be dropped
  anywhere on the surface for import.
- Account access is owned by the route shell rather than the full editor
  layout. Login, pricing, account, redeem, and successful auth-return dialogs
  therefore work consistently on `/landing`, `/chat`, and `/editor`, with one
  shared overlay host above entry transitions.
- The project picker offers a new project, an explicit Open project action,
  and recent project files. Project toggles these choices inside Chat instead
  of opening the native folder picker immediately. A second Project click
  closes the choices and restores the last selected project.
- Browser tabs keep independent project selections and chat-session routing.
  Refreshing one `/chat` tab restores that tab's project instead of adopting
  the project or session currently active in another tab.
- Project-file previews expose a small remove action. Removing media uses the
  shared media deletion path and asks for confirmation when the source is
  still referenced by timeline clips; document and text entries use their
  corresponding project stores.
- Open loads the factory `VIDEO EDIT` layout in place and reuses the existing
  400 ms dock transition. Media, Preview, the right-side tools, Timeline, and
  toolbar enter as a compact overlapping sequence.
- Before the panels enter, the chat pill contracts symmetrically along the
  x-axis and fades away during the first 120 ms.
- The staged reveal uses the dock layout transition in sequence mode. Media,
  Preview, and Timeline are eligible for live-surface animation; other layout
  elements may use transition clones.
- The light Chat surface remains fixed underneath the whole sequence. Loading
  `CHAT` from the favorite bar runs the same sequence in reverse: the gray
  editor panes leave stage by stage and reveal the light surface.
- Split handles stay transparent while the light surface is exposed, so the
  final editor grid is not drawn over the transition background in advance.
- The global toolbar enters from above during the compact transition when
  leaving `CHAT`. When returning, it becomes an overlay and exits upward while
  the dock expands underneath it. `CHAT` is also detected from its actual root
  panel, so project hydration cannot accidentally leave the toolbar visible.
- On the reverse transition, existing splitter lines fade out instead of
  disappearing in a single frame.
- Startup dialogs stay paused during the transition so they cannot cover the
  layout reveal.
- Enter submits; Shift+Enter keeps multiline input available. Focus, disabled, loading, and screen-reader feedback states are built in.
- The prompt pill includes browser-local Whisper dictation. Dictated text is appended to the current draft and stays on-device for transcription.
- Submitting the chat starts a resumable background job: it prepares a single
  source video when available, runs a FlashBoard AI chat turn, and renders the
  current timeline. Hosted AI chat can require authentication and credits.
- While the job is active, the chat pill reports authoritative runtime phases
  instead of a static thinking state. Snapshot reads, transcript collection,
  footage preparation, planning, read-only inspection, edit operations,
  verification, commit/rollback, and rendering update the visible headline;
  multi-operation edits also show their current/total count. The last three
  completed phases remain visible as a compact trail.
- Desktop centers the landing content. Narrow screens retain the centered
  layout with safe-area padding; they do not dock the pill above the safe area.
- Hosted Pages requests outside the supported editor, landing, admin,
  credit-claim, and legal paths return `404` instead of loading the editor
  fallback.
- The dock-layout model is the implementation. Routing selects the landing
  experience.
