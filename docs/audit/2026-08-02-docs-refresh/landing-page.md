# Landing-Page.md - audit 2026-08-02

## Verified (spot checks that held)

- `START` is the protected factory layout `factory-start`, is a default favorite, and follows `3D EDIT` in the factory-layout array: `src/stores/dockStore/panelRegistry.ts`, `src/stores/dockStore/layoutDefaults.ts`.
- `START` contains a single `start` panel; the dock tab bar is hidden for an active `start` panel and the generic picker excludes `start`: `src/stores/dockStore/layoutDefaults.ts`, `src/components/dock/dock.css`, `src/types/dock.ts`, `src/components/dock/tabPane/DockTabMenus.tsx`.
- The START transition constants remain 3,000 ms total with a 480 ms chat exit; leaving START loads `factory-video-edit` with sequence mode: `src/stores/dockStore/panelRegistry.ts`, `src/marketing/LandingPanel.tsx`.
- Enter submits while Shift+Enter preserves multiline input, and the textarea has focus, disabled/loading, and ARIA live-status handling: `src/marketing/LandingPage.tsx`.
- The toolbar detects START through either the active layout ID or a `start` root panel, and startup overlays wait for the START reveal: `src/App.tsx`.

## Outdated or wrong (claim -> reality, with file evidence)

- "dev-only minimal chat entry" and "debug route does not call an AI provider, require authentication, or spend credits" -> START is a shipped dock panel with a working background AI/edit/render flow. It invokes `runFlashBoardBridgeChatTurn`; the hosted chat endpoint performs billing authorization and can return `requires_billing`. Evidence: `src/components/dock/DockPanelContent.tsx`, `src/marketing/LandingPanel.tsx`, `src/marketing/runLandingBackgroundCreation.ts`, `functions/api/ai/chat.ts`.
- "landing.localhost" and `/landing` open the editor directly in START, and entry selection activates START before first paint -> routing recognizes both landing locations, but no code connects the resolved landing experience to `FACTORY_START_LAYOUT_ID`. The persisted START layout is deliberately restored as `factory-video-edit`. Evidence: `src/routing/entryExperience.ts`, `src/main.tsx`, `src/RootApp.tsx`, `src/stores/dockStore/index.ts`.
- "one welcoming chat pill [and] a small Open action" -> the active START surface also shows project-file previews, an optional finished-video player, and a drop-anywhere media-import overlay. Evidence: `src/marketing/LandingPage.tsx`, `src/marketing/LandingPanel.tsx`.
- "live panel surfaces without a final clone-to-live swap" -> only Preview, Timeline, and Media are selected for live-surface animation; other elements can be cloned for the dock transition. Evidence: `src/components/dock/container/layoutAnimationSnapshot.ts`, `src/components/dock/container/layoutAnimationMath.ts`.
- "narrow mobile screens dock [the pill] above the safe area" -> the mobile stylesheet changes padding and control dimensions but leaves `.landing-content` vertically centered. Evidence: `src/marketing/landing.css`.
- "outside the editor, landing, and credit-claim entry paths return 404" -> admin and imprint/privacy legal paths are also supported. Evidence: `src/routing/entryExperience.ts`, `functions/_middleware.ts`.

## Noteworthy / unusual

- The local landing background-job snapshot is persisted in `localStorage` and resumes only when the source media still belongs to the current project. Evidence: `src/marketing/landingBackgroundJob.ts`.
- The START facade intentionally suppresses AI-driven panel activation until the user opens the editor, so background work can change project state without exposing editor panels. Evidence: `src/stores/dockStore/panelVisibilityActions.ts`.
- The production UI strings in the landing background flow contain mojibake. Evidence: `src/marketing/LandingPage.tsx`, `src/marketing/runLandingBackgroundCreation.ts`.
