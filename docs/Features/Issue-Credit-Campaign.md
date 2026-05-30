[Back to Features](./README.md)

# Issue Credit Campaign

MasterSelects shows a version 2.0 issue-credit campaign banner in the desktop editor. The campaign message is:

- Users can submit a GitHub issue.
- If the issue is completed, the user receives 1000 AI credits.
- The primary action opens `https://github.com/Sportinger/MasterSelects/issues/new`.
- The in-app copy is English-only.

## Behavior

- The banner is mounted by `src/App.tsx` through `IssueCreditCampaignBanner`.
- It appears on every fresh editor page load or browser refresh.
- Dismissing the banner only hides it for the current React session; no project, IndexedDB, or local storage state is written.
- Confetti is CSS-only, starts after the first paint/idle period, runs once, and is removed from the DOM after the short celebration pass.
- `prefers-reduced-motion: reduce` disables the banner entrance/sheen animations and skips confetti.

## Layout

- The banner is fixed at the top center, below the toolbar.
- It uses a colorful version 2.0 treatment with a static rainbow gradient, a short compositor-friendly sheen, and a lightweight glow while keeping text on a darkened overlay for readability.
- Its z-index sits above the editor dock and startup overlays, while remaining below the billing success celebration.
