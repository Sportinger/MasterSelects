# Complete Refactor - P4 Media Panel And FlashBoard

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

### Phase 4 - Media Panel And FlashBoard

Goal: turn the largest UI/service knot into a maintainable Media workspace and
active AI-generation contract.

Current codebase signals:

- `MediaPanel.tsx`: 5,544 LOC.
- `MediaPanel.css`: 1,994 LOC.
- `FlashBoardComposer.tsx`: 3,565 LOC.
- `FlashBoard.css`: 3,054 LOC.
- `MediaAIGenerativeTray.css`: 931 LOC.
- active docs say FlashBoard is the Media Panel generation runtime, not a
  standalone AI-video tab.
- old dock panel types `ai-video`, `youtube`, and `download` are retired
  saved payloads that may be deleted or ignored.
- Media Panel board and FlashBoard board are not the same thing. The Media
  Panel board is an active media workspace surface; the old FlashBoard
  board/canvas/node workspace may be retired legacy.

Target shape:

- Media Panel shell:
  - panel chrome and top-level layout only
  - selected view/mode composition
  - no direct persistence/runtime allocation
- Media workspace modules:
  - folder tree
  - media grid/list
  - board overview or spatial media surface
  - board visual renderer for dense spatial media, connections, thumbnails,
    minimap, selection/marquee, and zoom/pan feedback
  - drag/drop and context menu
  - downloads tray
  - generation tray
  - import status/progress
- FlashBoard active contract:
  - generation request model
  - queue/job state
  - provider task adapter
  - media import metadata
  - pricing/catalog/prompt/chat services
- Retired FlashBoard board-canvas contract:
  - old node workspace CSS
  - viewport/selection/move/resize/duplicate state
  - reference-node canvas behavior
  - dock-level `ai-video` behavior

Concrete targets:

- `MediaPanel.tsx`: root shell below 700 LOC, most child files below 250 LOC.
- Media Panel board renderer: use a hybrid strategy. Keep controls, forms,
  context menus, accessibility, and low-frequency UI in DOM/React. Move dense
  board visuals to a canvas-backed renderer, and use `OffscreenCanvas`/worker
  rendering only when the Phase 0 board performance baseline proves that main
  thread DOM/canvas work is the bottleneck.
- `FlashBoardComposer.tsx`: split into provider/model picker, prompt editor,
  reference media strip, output settings, audio/music settings, queue submit,
  chat/refine controls, and runtime adapter.
- `FlashBoard.css`: split active tray/composer CSS from retired board/node CSS;
  delete retired CSS only after class usage scan and ledger entries.
- `flashboardStore`: split active generation state from retired board workspace
  data; current project schema owns active generation metadata only.
- Media Panel board persistence: classify and keep as active project/UI
  preference behavior, separate from retired FlashBoard board-canvas state.
- FlashBoard services: split request planner, reference resolver, provider
  runner, queue/job state, and media import adapter so services do not reach
  directly into stores except through approved adapters.

Status source:

- Running P4 progress and latest packet results live in
  `docs/ongoing/Complete-refactor-checklist.md`.
- Current and next packet definitions live in
  `docs/ongoing/complete-refactor/execution-queue-and-lanes.md`.
- Do not duplicate packet history in this phase file.

Gates:

- `P4_MEDIA_PANEL_SHELL_SPLIT`
- `P4_MEDIA_STORE_SELECTOR_CONTRACT`
- `P4_FLASHBOARD_ACTIVE_CONTRACT`
- `P4_FLASHBOARD_PROVIDER_TASK_CONTRACT`
- `P4_FLASHBOARD_RETIRED_BOARD_LEDGER` is satisfied by the retired-path ledger
  and usage scan. Deletion waits for a later explicit FlashBoard source packet.
- `P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED` is satisfied by
  `FLASHBOARD_STATE_CLASSIFICATION`.
- `P4_MEDIA_BOARD_RENDER_STRATEGY`
- `P4_MEDIA_BOARD_PROJECT_ROUNDTRIP`
- `P4_MEDIA_GENERATION_PROJECT_ROUNDTRIP`
- `P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL` is satisfied by the dock retirement
  source scan and active Media Panel download tray mapping.

Checks:

- `npm run test -- tests/unit/dockPanelConfigs.test.ts tests/unit/dockStoreLayouts.test.ts tests/unit/completeArchitectureRegistry.test.ts`
- `npm run test -- tests/unit/flashboardRetiredBoardClassification.test.ts`
- `npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx tests/unit/flashboardRetiredBoardClassification.test.ts tests/unit/completeArchitectureRegistry.test.ts`
- `rg -n "'ai-video'|'youtube'|'download'" src/types/dock.ts src/stores/dockStore.ts src/components/common/Toolbar.tsx src/components/dock`
- `rg -n "flashboard-(workspace|toolbar|canvas|canvas-area|canvas-inner|canvas-marquee|node|node-|context|queue-badge)|selectedNodeIds|activeBoardId|viewMode|selectActiveBoard|selectSelectedNodes" src/components/panels/flashboard src/stores/flashboardStore src/services/flashboard`
- Media Panel render smoke
- Media Panel board pan/zoom/selection smoke with FPS and input-latency
  thresholds
- board renderer fallback smoke for browsers without `OffscreenCanvas`
- import media smoke
- download tray smoke
- FlashBoard generate queue smoke with mocked provider
- generated-media import test
- project save/load roundtrip for generation metadata

Do not:

- Do not merge Media Panel board behavior with retired FlashBoard board/canvas
  behavior without a classification entry.
- Do not move Composer/forms/provider settings/chat controls to canvas. Canvas
  is for dense board visualization and interaction feedback, not normal UI.
- Do not require `OffscreenCanvas` as the only path; keep a main-thread canvas
  or DOM fallback unless browser support and smokes prove otherwise.
- Do not delete old FlashBoard CSS, node, viewport, selection, or z-order paths
  before class usage and retired-path ledger entries exist.
- Do not make FlashBoard services reach directly into stores except through
  approved adapters.
- Do not change project schema from this phase unless the Phase 3 adapter owns
  the write set.

