# Complete Refactor - P5 Preview Export And Common UI

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 5 - Preview, Export, And Common UI

Goal: split mixed React/UI/runtime shells that currently coordinate too many
lifecycles.

Current codebase signals:

- `Preview.tsx`: 2,827 LOC, 31 fan-out, 27 `getState()` usages.
- Preview registers GPU/render targets and mutates render-target state from
  React setup/cleanup; treat it as render lifecycle code, not only UI.
- `SceneObjectOverlay.tsx`: 2,053 LOC.
- `MaskOverlay.tsx`: 1,267 LOC.
- `TextPreviewEditor.tsx`: 1,063 LOC.
- `ExportPanel.tsx`: 3,326 LOC.
- Export UI and `FrameExporter` both affect engine export mode, resolution,
  render-time overrides, readback, and zero-copy paths.
- `ExportPanel.css`: 1,151 LOC.
- large common CSS files: `authBillingDialogs.css` 1,878,
  `WhatsNewDialog.css` 1,360, `dock.css` 875, `SettingsDialog.css` 870.

Target shape:

- Preview:
  - canvas target registration
  - render target lifecycle
  - `RenderTargetSnapshot` input contract
  - source monitor
  - camera/input controller
  - overlay registry
  - focused overlay components
- Export:
  - preset/settings form
  - export job planner
  - `ExportRenderSession` transaction contract
  - progress/result view
  - WebCodecs/FFmpeg/GIF runner adapters
  - bounded or streaming frame delivery for memory-heavy export paths
  - debug/export smoke adapter
- Common UI/CSS:
  - component-scoped CSS files below budget
  - shared tokens/utilities only for real shared primitives
  - dialogs split by responsibility, not broad common sheets

Concrete targets:

- `Preview.tsx`: shell below 700 LOC with overlay registry and runtime adapter.
- `SceneObjectOverlay.tsx`, `MaskOverlay.tsx`, `TextPreviewEditor.tsx`: split
  geometry planning, interaction handlers, painters/views, and persistence
  adapters.
- `ExportPanel.tsx`: shell below 700 LOC; export runners outside component and
  behind an `AbortSignal`-friendly session/cancellation contract.
- Common CSS over 700 LOC split by component/domain.
- Preview/Export implementation waits for render snapshot and output-router
  contracts when touching engine export state, render-target store, Preview
  registration, or export runners.

Gates:

- `P5_PREVIEW_RUNTIME_BOUNDARY`
- `P5_RENDER_TARGET_SNAPSHOT_CONTRACT`
- `P5_PREVIEW_OVERLAY_REGISTRY`
- `P5_EXPORT_PANEL_RUNNER_BOUNDARY`
- `P5_EXPORT_RENDER_SESSION_CONTRACT`
- `P5_BOUNDED_MEMORY_EXPORT`
- `P5_EXPORT_SMOKE_PRESERVED`
- `P5_COMMON_CSS_BUDGET`
- `P5_CSS_GLOBAL_SELECTOR_AND_ZINDEX_GATE`

Checks:

- preview render smoke
- source monitor smoke
- overlay interaction tests
- debugExport smoke
- export unit tests
- visual/CSS usage scan for deleted classes
- global selector, z-index tier, fixed overlay, and pointer-event scan

Do not:

- Do not edit Preview registration, render-target store, engine export mode, or
  export runners before the Phase 5/6 render contracts are frozen.
- Do not delete CSS classes without a usage scan and retired-class entry.
- Do not split overlays by visual order only; split geometry planning,
  interaction, painting/view, and persistence adapters.

