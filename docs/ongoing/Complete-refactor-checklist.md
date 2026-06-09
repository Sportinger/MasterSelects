# Complete Refactor Checklist

Status: execution plan
Updated: 2026-06-09

This checklist tracks the actual codebase refactor plan in
`docs/ongoing/Complete-refactor.md`.

Handoff files are prepared as execution templates. Use them when the master
orchestrator or worker-agent execution run starts.

## Progress Snapshot

- Complete Refactor execution plan: active
- Baseline: static scan counts refreshed from current worktree; runtime smoke
  baselines remain open
- Working docs: keep to plan + checklist unless data becomes too large
- Handoff templates: prepared for execution only
- Source implementation: current bounded source packet has explicit write set,
  forbidden files, and gates
- Current bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-139`,
  read-only packet to classify the remaining FlashBoard Composer boundary after
  the prompt-refine controller hook split.
- Completed source/tooling packet: `P0-REG-001`; focused registry checks passed.
- Completed bounded packet: `P0-BASELINE-REFRESH-001`, read-only plus docs.
- Completed bounded packet: `P1-CONTRACT-001`, contracts and focused boundary
  test only.
- Completed bounded packet: `P1A-RUNTIME-LEASE-001`, media runtime lease
  contracts, persisted-state guard, HMR singleton hardening, and focused tests.
- Completed bounded packet: `P1B-SIGNAL-DTO-001`, signal DTO runtime-free
  guard, universal format matrix, unknown-file fallback contract, and focused
  tests.
- Advanced bounded packet: `P1-P3-SCHEMA-FREEZE-001`; project schema no longer
  imports stores/components/engine/runtime services or the broad `src/types`
  barrel. P1 schema import gates are satisfied; P2/P3 integration remains open.
- Completed bounded packet: `P3-HYDRATION-ADAPTER-001`; sequence-frame
  `File`/object-URL fields are removed from persisted project DTOs and
  `projectLoad.ts` owns runtime hydration from project raw paths or handles.
- Completed bounded packet: `P3-DEPRECATED-PAYLOADS-001`; obsolete
  `ProjectFile.youtube` payloads are removed from current project schema and
  YouTube store changes no longer mark projects dirty.
- Completed bounded packet: `P4-P3-UI-LAYOUT-PREFLIGHT-001`; dock deprecated
  panel cleanup and retired FlashBoard board/canvas cleanup now have executable
  gates, high-conflict ownership, and retired-path ledger entries.
- Completed bounded packet: `P4-P3-UI-LAYOUT-CLEANUP-001`; retired dock
  `youtube`/`download`/`ai-video` ids are removed from the active dock contract,
  old restored-layout payloads are dropped, active downloads remain in the
  Media Panel tray, and FlashBoard store state is classified into active
  composer/reference-hover versus retired board workspace fields.
- Completed bounded packet: `P4-MEDIA-PANEL-SHELL-PREFLIGHT-001`; Media Panel
  shell/grid/import/context split targets, FlashBoard composer module targets,
  focused smoke checks, and the retired FlashBoard board/canvas usage scan are
  recorded.
- Completed first source slice: `P4-MEDIA-PANEL-SHELL-SPLIT-001`; extracted
  Media Panel search, view-mode controls, shared Add item menu, context-menu
  shape, and grid duration formatting. `MediaPanel.tsx` is reduced from 5,544
  to 5,369 LOC; shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-GRID-CONTEXT-SPLIT-002`;
  extracted grid item rendering, grid breadcrumb rendering, and context-menu
  frame positioning. `MediaPanel.tsx` is reduced from 5,369 to 5,298 LOC;
  shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-LIST-PRESENTATION-SPLIT-003`;
  extracted classic list row shell, folder indentation chrome, rename input,
  status badges, and metadata cell presentation. `MediaPanel.tsx` is reduced
  from 5,298 to 4,978 LOC; shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-ACTIONS-SPLIT-004`;
  extracted non-board context action sections, move-folder submenu,
  regenerate-artifact submenu, explorer submenu, and selected-item action
  presentation. `MediaPanel.tsx` is reduced from 4,978 to 4,809 LOC; shell
  split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-ANNOTATION-CONTEXT-SPLIT-005`;
  extracted board annotation color context presentation. `MediaPanel.tsx` is
  reduced from 4,809 to 4,785 LOC; shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-DROP-EMPTY-STATES-SPLIT-006`;
  extracted external drop overlay, no-media empty state, and search-empty
  presentation. `MediaPanel.tsx` is reduced from 4,785 to 4,769 LOC; shell
  split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-HEADER-ACTIONS-SPLIT-007`;
  extracted header count, relink prompt, import button, view controls, and Add
  dropdown shell. `MediaPanel.tsx` is reduced from 4,769 to 4,738 LOC; shell
  split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-CLASSIC-LIST-CHROME-SPLIT-008`;
  extracted classic list wrapper, column headers, virtual spacers, and marquee
  overlay presentation. `MediaPanel.tsx` is reduced from 4,738 to 4,669 LOC;
  shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-GRID-CHROME-SPLIT-009`;
  extracted grid wrapper, breadcrumb placement, grid container, and grid
  marquee overlay presentation. `MediaPanel.tsx` is reduced from 4,669 to
  4,645 LOC; shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-FEEDBACK-TRAY-SHELL-SPLIT-010`;
  extracted floating feedback portal and generation-tray mount shell.
  `MediaPanel.tsx` is reduced from 4,645 to 4,636 LOC; shell split remains
  open.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-SELECTOR-PREFLIGHT-011`;
  read-only source inspection classified the next safe source slice as board
  extraction, not selector or folder/import-status extraction. No source files
  changed in this packet.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-VIEW-HOST-SPLIT-012`;
  extracted the typed `MediaBoardHost` prop boundary and exported
  `MediaBoardViewProps`; Media Board renderer, layout, storage, overview
  canvas, gesture, store, and project behavior stayed unchanged. Current
  worktree count is 5,166 LOC; shell split remains open.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-DATA-SPLIT-013`;
  extracted Media Board annotation types, constants, storage key, load/save,
  and normalization helpers into `media/board/annotations.ts`. `MediaPanel.tsx`
  is reduced from 5,166 to 5,077 LOC in the current worktree; annotation UI,
  drag/resize math, context-menu wiring, and renderer markup stayed unchanged.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-LAYER-SPLIT-014`;
  extracted Media Board annotation layer JSX/presentation event attachment into
  `media/board/MediaBoardAnnotationLayer.tsx`. `MediaPanel.tsx` is reduced
  from 5,077 to 5,006 LOC in the current worktree; annotation data helpers,
  drag/resize math, context-menu presentation, and renderer behavior stayed
  unchanged.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-CONTROLLER-PREFLIGHT-015`;
  read-only scans show annotation state/save/update can move first, while
  visible filtering, drag/resize math, edit-focus, and context-menu selection
  should stay in `MediaPanel.tsx` until a later controller packet.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-STATE-SPLIT-016`;
  extracted Media Board annotation state, selected annotation state, save
  effect, reload, and update normalization into
  `media/board/useMediaBoardAnnotationState.ts`. `MediaPanel.tsx` is reduced
  from 5,006 to 4,975 LOC in the current worktree; annotation creation,
  visible filtering, drag/resize math, edit-focus, context-menu selection,
  layer presentation, and renderer behavior stayed unchanged.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-CREATE-SPLIT-017`;
  moved Media Board annotation creation, append, and selection command into
  `useMediaBoardAnnotationState.ts`. `MediaPanel.tsx` is reduced from 4,975 to
  4,954 LOC in the current worktree; context-menu point ownership, visible
  filtering, drag/resize math, edit-focus, context-menu selection UI, layer
  presentation, and renderer behavior stayed unchanged.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-VISIBILITY-SPLIT-018`;
  extracted Media Board annotation visible-rect filtering into
  `media/board/annotations.ts` as a pure helper. `MediaPanel.tsx` is reduced
  from 4,954 to 4,951 LOC in the current worktree; drag/resize math,
  edit-focus, context-menu selection UI, layer presentation, board renderer,
  media store, project, Timeline, render, export, preview, and media runtime
  stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-GESTURE-PREFLIGHT-019`;
  read-only scans show annotation resize geometry is the next safe source
  slice; drag still owns body cursor/user-select side effects and context-menu
  suppression, while focus owns a DOM lookup through `boardCanvasRef`.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-RESIZE-MATH-SPLIT-020`;
  extracted pure Media Board annotation resize geometry into
  `media/board/annotations.ts`. `MediaPanel.tsx` is reduced from 4,951 to
  4,933 LOC in the current worktree; listener lifetime, viewport zoom delta
  conversion, drag behavior, body style side effects, context-menu suppression,
  focus, layer presentation, board renderer, media store, project, Timeline,
  render, export, preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-FOCUS-HELPER-SPLIT-021`;
  extracted the Media Board annotation text-focus DOM lookup into
  `media/board/annotationDom.ts`. `MediaPanel.tsx` is reduced from 4,933 to
  4,932 LOC in the current worktree; requestAnimationFrame timing,
  drag/resize behavior, context-menu behavior, layer presentation, renderer,
  media store, project, Timeline, render, export, preview, and media runtime
  stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-DRAG-MATH-SPLIT-022`;
  extracted pure Media Board annotation drag-position calculation into
  `media/board/annotations.ts`. `MediaPanel.tsx` remains 4,932 LOC in the
  current worktree; drag distance gating, listener lifetime, body style side
  effects, context-menu suppression, focus, layer presentation, renderer,
  media store, project, Timeline, render, export, preview, and media runtime
  stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-CONTROLLER-PREFLIGHT-023`;
  read-only scans show the remaining annotation drag/resize controller can move
  as a focused hook if it receives selection, close-context, suppression,
  viewport, and update callbacks as dependencies; MediaBoardView, renderer,
  media store, project, Timeline, render, export, preview, and media runtime
  stay out of scope.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-GESTURE-HOOK-SPLIT-024`;
  extracted Media Board annotation drag/resize controller callbacks into
  `media/board/useMediaBoardAnnotationGestures.ts`. `MediaPanel.tsx` is
  reduced from 4,932 to 4,844 LOC in the current worktree; context-menu
  selection, edit-toggle, focus, layer presentation, renderer, media store,
  project, Timeline, render, export, preview, and media runtime stayed
  untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-COMMAND-HOOK-SPLIT-025`;
  extracted Media Board annotation context-menu selection, focus, edit-toggle,
  and text-focus request callbacks into
  `media/board/useMediaBoardAnnotationCommands.ts`. `MediaPanel.tsx` is
  reduced from 4,844 to 4,830 LOC in the current worktree; gesture behavior,
  layer presentation, renderer, media store, project, Timeline, render, export,
  preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-BOARD-ANNOTATION-CONTEXT-MENU-SPLIT-026`;
  extracted Media Board annotation context-menu lookup and frame/menu mount into
  `media/context/MediaAnnotationContextMenuMount.tsx`. `MediaPanel.tsx` is
  reduced from 4,830 to 4,824 LOC in the current worktree; annotation color
  update behavior, non-annotation context actions, gestures, layer
  presentation, renderer, media store, project, Timeline, render, export,
  preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-ACTIONS-MOUNT-PREFLIGHT-027`;
  classified the normal Media context-actions mount and confirmed the next safe
  source slice is a pure derived-state planner, not another frame wrapper or
  handler grouping. Source stayed untouched; media store selectors/actions,
  FlashBoard, Media Board renderer/layout/storage/constants/types, project,
  Timeline, render, export, preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-ACTIONS-DERIVED-PROPS-SPLIT-028`;
  extracted normal Media context-actions derived props into
  `media/context/contextActionState.ts`. `MediaPanel.tsx` is reduced from 4,824
  to 4,788 LOC in the current worktree; context action presentation, async
  explorer/download fallback, proxy-folder handler, media store
  selectors/actions, FlashBoard, project, Timeline, render, export, preview,
  and media runtime stayed untouched. Checks passed: `npx tsc -b --pretty
  false`; `npm run test -- tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; FlashBoard boundary scan showed
  only existing composer reference ownership. A read-only Claude reviewer found
  no behavioral regression or boundary violation.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-SELECTED-ITEM-STATE-SPLIT-029`;
  extracted normal context-menu selected-item lookup and media/composition/solid
  role classification into `media/context/contextSelectedItemState.ts`.
  `MediaPanel.tsx` is reduced from 4,788 to 4,779 LOC in the current worktree;
  selected-item lookup order, context action presentation, async
  explorer/download fallback, proxy-folder handler, media store
  selectors/actions, FlashBoard, project, Timeline, render, export, preview,
  and media runtime stayed untouched. Checks passed: `npx tsc -b --pretty
  false`; `npm run test -- tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; FlashBoard boundary scan showed
  only existing composer reference ownership.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-HANDLER-OWNERSHIP-PREFLIGHT-030`;
  classified the remaining inline normal context action handlers and selected a
  small explorer/proxy-folder handler hook as the next safe source slice. Source
  stayed untouched; context action presentation, solid settings, move-to-folder,
  media store selectors/actions, FlashBoard, project, Timeline, render, export,
  preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-EXPLORER-HANDLERS-SPLIT-031`;
  extracted raw source explorer, proxy explorer, and pick-proxy-folder callbacks
  into `media/context/useMediaContextExplorerHandlers.ts`. `MediaPanel.tsx` is
  reduced from 4,779 to 4,764 LOC in the current worktree; raw fallback download
  behavior, close timing, solid settings, move-to-folder, context action
  presentation, media store selectors/actions, FlashBoard, project, Timeline,
  render, export, preview, and media runtime stayed untouched. Checks passed:
  `npx tsc -b --pretty false`; `npm run test --
  tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; FlashBoard boundary scan showed
  only existing composer reference ownership.
- Completed bounded packet: `P4-MEDIA-PANEL-CONTEXT-LOCAL-HANDLERS-SPLIT-032`;
  extracted the move-to-folder adapter and solid-settings callback into
  `media/context/useMediaContextLocalHandlers.ts`. `MediaPanel.tsx` is reduced
  from 4,764 to 4,758 LOC in the current worktree; move-to-folder selection
  semantics, solid-settings dialog payload, close timing, async explorer
  handlers, AI reference, rename, create, duplicate, delete, context action
  presentation, media store selectors/actions, FlashBoard, project, Timeline,
  render, export, preview, and media runtime stayed untouched. Checks passed:
  `npx tsc -b --pretty false`; `npm run test --
  tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; FlashBoard boundary scan showed
  only existing composer reference ownership.
- Accepted interim warning: Media Board source boundaries are still uneven.
  Current worktree counts are `MediaBoardView.tsx` 734 LOC, `layout.ts` 817
  LOC, and `MediaBoardHost.tsx` 7 LOC. This is not a blocker for completed
  context-menu slices; treat it as a later Board/View/Layout boundary packet,
  not as a reason to undo the current split.
- Completed bounded packet: `P4-MEDIA-BOARD-VIEW-LAYOUT-BOUNDARY-PREFLIGHT-033`;
  classified the accepted Media Board source-size warning. The next safe source
  packet is a pure `layout.ts` reconciliation split, not a JSX view split or
  host removal. Source stayed untouched; `MediaBoardView.tsx` remains a later
  view/node boundary candidate, `MediaBoardHost.tsx` remains an accepted thin
  pass-through for now, and media store selectors/actions, FlashBoard, project,
  Timeline, render, export, preview, and media runtime stayed untouched.
- Completed bounded packet: `P4-MEDIA-BOARD-LAYOUT-RECONCILE-SPLIT-034`;
  extracted `reconcileMediaBoardLayouts` into
  `media/board/layoutReconcile.ts`. `layout.ts` is reduced from 817 to 641 LOC
  in the current worktree, and `layoutReconcile.ts` is 188 LOC; layout
  reconciliation behavior, caller semantics, layout geometry, storage,
  constants, overview canvas, type contracts, `MediaBoardView.tsx`,
  `MediaBoardHost.tsx`, media store selectors/actions, FlashBoard, project,
  Timeline, render, export, preview, and media runtime stayed unchanged. Checks
  passed: `npx tsc -b --pretty false`; `npm run test --
  tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; boundary scan shows
  `reconcileMediaBoardLayouts` imported from `layoutReconcile.ts`.
- Remaining accepted interim warning: `MediaBoardView.tsx` is still 734 LOC and
  `MediaBoardHost.tsx` is still a 7 LOC pass-through. Treat that as a later
  Board View/Node boundary packet; do not undo the completed context or layout
  splits.
- Completed bounded packet: `P4-MEDIA-BOARD-VIEW-NODE-BOUNDARY-PREFLIGHT-035`;
  classified the remaining `MediaBoardView.tsx` boundary and confirmed the next
  safe source packet is a node renderer split. `MediaBoardNode` and its
  video-scrub/poster helpers are a self-contained renderer responsibility;
  Board shell, groups, insert gaps, `children`, marquee rendering, host
  pass-through, layout, storage, constants, overview canvas, type contracts,
  media store selectors/actions, FlashBoard, project, Timeline, render, export,
  preview, and media runtime stay out of that source packet.
- Completed bounded packet: `P4-MEDIA-BOARD-NODE-RENDERER-SPLIT-036`;
  extracted `MediaBoardNode` and its video preview helpers into
  `media/board/MediaBoardNode.tsx`. `MediaBoardView.tsx` is reduced from 734 to
  315 LOC in the current worktree, and `MediaBoardNode.tsx` is 429 LOC; node
  JSX semantics, video-preview behavior, thumbnail request timing, refresh
  fallback behavior, focused-original overlay math, selection classes,
  context-menu suppression, Board shell, groups, insert gaps, `children`,
  marquee, host pass-through, layout, storage, constants, overview canvas,
  MediaPanel behavior, type contracts, media store selectors/actions,
  FlashBoard, project, Timeline, render, export, preview, and media runtime
  stayed unchanged. Checks passed: `npx tsc -b --pretty false`; `npm run test
  -- tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; boundary scan shows the node
  renderer and video helpers only in `MediaBoardNode.tsx`.
- Remaining accepted interim warning: `MediaBoardHost.tsx` is still a 7 LOC
  pass-through. Treat it as a host-boundary preflight/deletion candidate, not a
  drive-by deletion.
- Completed bounded packet: `P4-MEDIA-BOARD-HOST-BOUNDARY-PREFLIGHT-037`;
  classified `MediaBoardHost.tsx` as a delete-now candidate. It is imported only
  by `MediaPanel.tsx`, aliases `MediaBoardViewProps`, and renders
  `<MediaBoardView {...props} />` without owning runtime state, board shell
  behavior, event handling, or a durable boundary. Source stayed untouched in
  the preflight.
- Completed bounded packet: `P4-MEDIA-BOARD-HOST-PASSTHROUGH-DELETE-038`;
  deleted `media/board/MediaBoardHost.tsx` and switched `MediaPanel.tsx` to
  import/render `MediaBoardView` directly. `MediaBoardView.tsx` remains 315 LOC,
  `MediaBoardNode.tsx` 429 LOC, `layout.ts` 641 LOC, and `layoutReconcile.ts`
  188 LOC in the current worktree; `MediaBoardViewProps`, Board shell, node
  renderer, layout, storage, constants, overview canvas, MediaPanel behavior,
  board contracts, media store selectors/actions, FlashBoard, project,
  Timeline, render, export, preview, and media runtime stayed unchanged. Checks
  passed: `npx tsc -b --pretty false`; `npm run test --
  tests/unit/mediaPanelDropImport.test.ts
  tests/unit/mediaPanelItemTypeGuards.test.ts
  tests/unit/mediaPanelSourceMonitor.test.tsx`; boundary scan shows no
  `MediaBoardHost` source reference remains.
- Resolved interim Media Board source warning: `MediaBoardView.tsx`,
  `MediaBoardNode.tsx`, `layout.ts`, and `layoutReconcile.ts` are all below the
  product-source ceiling, and the no-value host pass-through is deleted.
- Completed bounded packet: `P4-FLASHBOARD-RETIRED-BOARD-USAGE-PREFLIGHT-039`;
  re-scanned retired FlashBoard board/canvas CSS, store fields, selectors,
  runtime, Composer, and services before deletion. `npm run test --
  tests/unit/flashboardRetiredBoardClassification.test.ts` passed. The scan
  confirms direct deletion is not yet safe: retired board workspace fields
  (`activeBoardId`, `boards`, `selectedNodeIds`, `viewMode`) are still used by
  `FlashBoardComposer`, `useFlashBoardRuntime`, store selectors/slices, and
  `FlashBoardMediaBridge` for active draft/job/import behavior. Source stayed
  untouched.
- Project compatibility policy: current schema only; old saved projects may
  break; deprecated payloads are delete-or-ignore candidates.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-RETIRED-STORE-BOUNDARY-PREFLIGHT-040`; re-scanned
  active generation job/import dependencies. `npm run test --
  tests/unit/flashboardRetiredBoardClassification.test.ts` passed. Active
  Composer/runtime/job/import still uses FlashBoard nodes as draft/job/result
  records, and `FlashBoardMediaBridge` reads board nodes to build generated
  media metadata and complete imports.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-RECORD-ADAPTER-SPLIT-041`; added
  `src/stores/flashboardStore/activeGenerationRecords.ts` and updated
  `FlashBoardMediaBridge` to use it for request lookup and completion instead
  of directly importing `useFlashBoardStore`/`FlashBoardNode`. Focused tests and
  `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-MEDIA-AI-GENERATION-QUEUE-RECORD-ADAPTER-SPLIT-042`; extended the active
  generation record adapter with queue list/dismiss access and updated
  `MediaAIGenerationQueue.tsx` to stop directly reading `boards`,
  `FlashBoardNode`, or `removeNode`. Focused tests and
  `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-COMPOSER-SUBMIT-ADAPTER-SPLIT-043`; extended the active
  generation record adapter with board availability and request submission, and
  updated `FlashBoardComposer.tsx` to stop importing `selectActiveBoard` and
  direct draft/request/queue node actions. Focused tests and
  `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-RUNTIME-UPDATE-ADAPTER-SPLIT-044`; extended the active
  generation record adapter with runtime board bootstrap, job update/fail, and
  selection/delete access, and updated `useFlashBoardRuntime.ts` to stop
  importing FlashBoard store internals or `selectActiveBoard`. Focused tests and
  `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P3-P4-FLASHBOARD-ACTIVE-GENERATION-PERSISTENCE-PREFLIGHT-045`; re-scanned
  FlashBoard project save/load/lifecycle persistence. `npm run test --
  tests/unit/projectSchemaBoundary.test.ts
  tests/unit/flashboardActiveGenerationRecords.test.ts` passed. Remaining
  retired board/node coupling is concentrated in `ProjectFlashBoardState`,
  `projectSave.ts`, `projectLoad.ts`, `projectLifecycle.ts`, store types, and
  backing store internals; active UI/service paths already use the active
  generation record adapter.
- Completed bounded packet:
  `P3-P4-FLASHBOARD-ACTIVE-GENERATION-PERSISTENCE-SCHEMA-SPLIT-046`; current
  project persistence now saves/loads active FlashBoard `generationRecords` and
  generation metadata instead of retired board/node payloads. Project load
  hydrates records through the active generation adapter, lifecycle/autosave no
  longer subscribe to retired board payloads, old saved project migration was
  not added, and focused tests plus `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-RETIRED-BOARD-CSS-DELETE-047`; deleted the unused retired
  `.flashboard-*` workspace/toolbar/canvas/node/context CSS block from
  `FlashBoard.css` while preserving active `.fb-*` Composer and Media AI
  queue/tray styles. Retired class usage scan is clean, active style scan still
  finds the expected classes, focused tests passed, and `npx tsc -b --pretty
  false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-STORE-INTERNALS-PREFLIGHT-048`; read-only
  scans and focused tests classify the remaining retired FlashBoard
  `activeBoardId`/`boards`/`selectedNodeIds`, board/node selectors, and
  board/node slice actions as local store/test backing-model debt. The next
  source packet can stay inside `flashboardStore` plus FlashBoard unit tests;
  project schema, MediaStore, Timeline, render, export, preview, Media Board,
  and media runtime stay out of scope.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-STORE-MODEL-SPLIT-049`; replaced the local
  FlashBoard backing board/node store model with first-class
  `activeGenerationRecords`, deleted the old board/node slices, updated
  reference-usage selectors and FlashBoard unit tests, and moved global history
  FlashBoard snapshots/restores to active generation records. Focused
  FlashBoard tests, `tests/stores/historyStore.test.ts`, old board-field
  scans, and `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-NAMING-PREFLIGHT-050`; read-only scans
  classify remaining `nodeId` names as local FlashBoard job-service,
  runtime-callback, and media-bridge identifiers for active generation records.
  `draftNodeId`/`openComposer`/`closeComposer` are now local Composer-state
  naming debt. The rename can stay inside FlashBoard service/runtime/store
  files and FlashBoard unit tests; project schema, MediaStore, Timeline,
  render, export, preview, Media Board, and media runtime stay out of scope.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-RECORD-ID-RENAME-051`; renamed local
  FlashBoard job-service/runtime/media-bridge identifiers from `nodeId` to
  `recordId`, removed the unused Composer `draftNodeId`/`openComposer`/
  `closeComposer` state remnant, and updated FlashBoard unit fixtures. Rename
  scans, old board-field scans, focused FlashBoard tests, and `npx tsc -b
  --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SERVICE-SIZE-PREFLIGHT-052`; read-only
  classification shows the remaining P4 pressure is active size/coupling:
  `FlashBoardComposer.tsx` is 3895 LOC, `FlashBoard.css` is 2469 LOC, and
  `FlashBoardJobService.ts` is 715 LOC. The smallest safe next split is an
  active CSS section split that preserves class names and import order without
  changing Composer, job-service, project, MediaStore, Timeline, render,
  export, preview, Media Board, or media runtime source.
- Phase details: split under `docs/ongoing/complete-refactor/`; the root
  `Complete-refactor.md` is now the orchestrator index.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CSS-SECTION-SPLIT-053` to split active
  `FlashBoard.css` into role-specific CSS section files while preserving active
  `.fb-*` and Media AI tray behavior.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CSS-SECTION-SPLIT-053`; split active `FlashBoard.css`
  into an ordered import manifest plus `FlashBoardBubble.css`,
  `FlashBoardReferences.css`, `FlashBoardMultishot.css`,
  `FlashBoardControls.css`, and `FlashBoardPopovers.css`. Class names and
  cascade order are preserved, `MediaAIGenerativeTray.css` stayed read-only,
  the retired `.flashboard-*` board-class scan remained clean, active `.fb-*`
  selector scans passed, and focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-JOB-SOURCE-PREFLIGHT-054` to classify the next
  TS source split after the CSS split: Composer UI/controller boundary versus
  job-service provider runner boundary.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-JOB-SOURCE-PREFLIGHT-054`; read-only scans
  show `FlashBoardComposer.tsx` remains a 3895 LOC UI/controller hub, while
  `FlashBoardJobService.ts` is a 715 LOC provider-dispatch hub with one long
  `startJob` path for Suno, ElevenLabs/audio, image, and video runners. Focused
  FlashBoard tests passed. The next TS split should target the job-service
  provider runner boundary first because it has a narrower runtime contract and
  direct unit coverage, while the Composer split needs a later UI/controller
  packet.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-JOB-PROVIDER-RUNNER-SPLIT-055` to move provider runner
  execution out of `FlashBoardJobService.ts` while keeping queue/cancel/retry
  ownership in the service.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-JOB-PROVIDER-RUNNER-SPLIT-055`; moved provider task
  execution into `FlashBoardProviderRunners.ts` while keeping queue, cancel,
  retry, concurrency, running cleanup, and update orchestration in
  `FlashBoardJobService.ts`. `FlashBoardJobService.ts` is now 373 LOC and the
  role-specific runner module is 420 LOC. Focused FlashBoard tests and
  `npx tsc -b --pretty false` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-BOUNDARY-PREFLIGHT-056` to classify the next
  Composer TSX source split by UI/controller ownership before editing
  `FlashBoardComposer.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-BOUNDARY-PREFLIGHT-056`; read-only
  classification confirms `FlashBoardComposer.tsx` is still 3895 LOC and its
  major clusters are provider/model selection, prompt/chat/refine flows,
  reference strip interaction, multishot controls, audio/voice/Suno settings,
  request assembly, and JSX rendering. Focused FlashBoard tests passed. The
  smallest safe Composer source split is the multishot presentational panel:
  its JSX is contiguous, its CSS is already isolated, and Composer can keep
  state, validation, request assembly, and helper ownership.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PANEL-SPLIT-057` to extract the active
  Multishot panel presentation from `FlashBoardComposer.tsx` without moving
  Composer state or request assembly.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PANEL-SPLIT-057`; extracted the active
  Multishot panel presentation to `FlashBoardMultishotPanel.tsx`.
  `FlashBoardComposer.tsx` still owns multishot state, helper functions,
  validation, request assembly, and callbacks. `FlashBoardComposer.tsx` is now
  3847 LOC and `FlashBoardMultishotPanel.tsx` is 91 LOC. Focused FlashBoard
  tests and `npx tsc -b --pretty false` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PREFLIGHT-058` to classify the
  reference-strip extraction boundary before moving reference JSX or
  interaction code.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PREFLIGHT-058`; read-only scans show
  reference badge derivation, hover state, role mutation, focus/auto-scroll,
  drag/drop, and JSX are still in `FlashBoardComposer.tsx`. The safest next
  source slice is presentation-only: move the reference strip JSX and badge type
  to a role component while Composer keeps badge derivation, refs,
  pointer/focus/auto-scroll handlers, hover updates, role mutation, drag/drop,
  and store updates. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PRESENTATION-SPLIT-059` to extract
  reference strip presentation without moving interaction or store logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PRESENTATION-SPLIT-059`; extracted
  reference strip presentation and `ComposerReferenceBadge` to
  `FlashBoardReferenceStrip.tsx`. `FlashBoardComposer.tsx` keeps badge
  derivation, refs, focus/auto-scroll callbacks, hover updates, role mutation,
  drag/drop, and store updates. `FlashBoardComposer.tsx` is now 3767 LOC and
  `FlashBoardReferenceStrip.tsx` is 121 LOC. Focused FlashBoard tests and
  `npx tsc -b --pretty false` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-INTERACTION-PREFLIGHT-060` to classify
  whether the next Composer source split should move reference focus/auto-scroll
  into a hook or handle drag/drop/store mutation separately.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-INTERACTION-PREFLIGHT-060`; read-only scans
  show remaining reference interaction has two separate clusters. Focus and
  auto-scroll are local DOM/ref behavior in `FlashBoardComposer.tsx`, while
  drag/drop and role mutation touch Composer/store state. Focused FlashBoard
  tests passed. The next safe source split is the focus/auto-scroll hook first.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-FOCUS-HOOK-SPLIT-061` to move reference
  focus and auto-scroll refs/callbacks into a local hook while keeping drag/drop
  and store updates in Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-FOCUS-HOOK-SPLIT-061`; moved reference
  focus, auto-scroll refs, RAF state, pointer callbacks, reset/leave behavior,
  and cleanup into `useFlashBoardReferenceFocus.ts`. `FlashBoardComposer.tsx`
  keeps drag/drop, hover, role mutation, store updates, and request assembly.
  `FlashBoardComposer.tsx` is now 3633 LOC and the focus hook is 151 LOC.
  Focused FlashBoard tests and `npx tsc -b --pretty false` passed.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-DROP-PREFLIGHT-062`; read-only scans classify
  reference drag/drop as a narrow hook boundary. `FlashBoardComposer.tsx` is
  3633 LOC before the source split. Drag-over/drop state, MIME/payload parsing,
  reference append/clamp, and the reference-list `updateComposer` mutation can
  move together without changing role mutation, hover updates, request assembly,
  CSS, stores, project schema, Media Board, Timeline, render, export, preview,
  or media runtime. Focused FlashBoard tests passed.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-DROP-HOOK-SPLIT-063`; moved reference
  drag-over/drop state, MIME/payload parsing, duplicate filtering, and
  reference append/clamp update wiring into `useFlashBoardReferenceDrop.ts`.
  `FlashBoardComposer.tsx` still owns role mutation, hover updates,
  `FlashBoardReferenceStrip`, provider settings, prompt/request assembly, and
  submit behavior. `FlashBoardComposer.tsx` is now 3583 LOC and the drop hook
  is 109 LOC. Focused FlashBoard tests, `npx tsc -b --pretty false`, and
  `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-EDITOR-PREFLIGHT-064` to classify the next
  prompt editor, prompt-refine, and chat-input boundary before any additional
  Composer source split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-EDITOR-PREFLIGHT-064`; read-only scans show a
  safe presentation-only prompt editor boundary. Prompt/chat textarea refs,
  autosize calls, prompt text inputs, Suno lyrics/style/negative inputs, clear
  actions, restore-before-rewrite button, and reference-count hint can move to a
  component with callback props. Prompt-refine service calls, chat output/history
  rendering, chat provider settings, request assembly, queue submit, CSS, stores,
  services, project schema, Media Board, Timeline, render, export, preview, and
  media runtime must stay out of the next split. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-EDITOR-SHELL-SPLIT-065` to extract only the
  prompt/chat input presentation shell into `FlashBoardPromptEditor.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-EDITOR-SHELL-SPLIT-065`; extracted prompt/chat
  input presentation, Suno lyrics/style/negative input fields, clear/restore
  buttons, autosize callback wiring, and reference-count hint into
  `FlashBoardPromptEditor.tsx`. Composer keeps prompt/chat state,
  prompt-refine service calls, chat output/history, provider controls, request
  assembly, and submit behavior. `FlashBoardComposer.tsx` is now 3506 LOC and
  `FlashBoardPromptEditor.tsx` is 173 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-OUTPUT-PREFLIGHT-066` to classify chat output and
  chat-history presentation before any chat source split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-OUTPUT-PREFLIGHT-066`; read-only scans show chat
  output/history as a safe presentation-only boundary. Chat log rendering,
  copied-message visual state, error-message rendering, and error cloud-action
  buttons can move to a component with callback props. Chat provider settings,
  `sendFlashBoardChatMessage`, prompt input, chat state mutation,
  clear/copy handlers, request assembly, queue submit, CSS, stores, services,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime must stay out of the next split. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-OUTPUT-SHELL-SPLIT-067` to extract only chat
  output/history presentation into `FlashBoardChatOutput.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-OUTPUT-SHELL-SPLIT-067`; extracted chat log,
  copied-message visual state, error rendering, and chat error cloud-action
  buttons into `FlashBoardChatOutput.tsx`. Composer keeps `chatHistoryRef`,
  chat state, copied-message state, clear/copy handlers, provider settings,
  `sendFlashBoardChatMessage`, prompt input, request assembly, and submit
  behavior. `FlashBoardComposer.tsx` is now 3473 LOC and
  `FlashBoardChatOutput.tsx` is 77 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLS-PREFLIGHT-068` to classify chat provider,
  model, reasoning, temperature, approval, and clear-history controls before any
  chat-controls source split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLS-PREFLIGHT-068`; read-only scans show the
  chat controls/provider bar as a safe presentation boundary. Provider/model/
  reasoning/temperature popover presentation, auto-approval toggle, clear-history
  button, Lemonade status label, and selected chat model label can move to a
  component with callback props. Chat service calls, provider/model state
  ownership, prompt input, chat output, request assembly, queue submit, CSS,
  stores, services, project schema, Media Board, Timeline, render, export,
  preview, and media runtime must stay out of the next split. The chat send/stop
  action button remains in Composer for now because it shares the action stack
  with normal generation. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLS-SHELL-SPLIT-069` to extract only the chat
  controls/provider presentation bar into `FlashBoardChatControls.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLS-SHELL-SPLIT-069`; extracted chat
  provider/model/reasoning/temperature popover presentation, auto-approval
  toggle presentation, clear-history button, Lemonade status label, and selected
  chat model label into `FlashBoardChatControls.tsx`. Composer keeps popover
  state ownership, provider/model state ownership, chat service calls, prompt
  input, chat output, chat send/stop action button, request assembly, and submit
  behavior. `FlashBoardComposer.tsx` is now 3354 LOC and
  `FlashBoardChatControls.tsx` is 238 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-PREFLIGHT-070` to classify the shared
  generate/chat action button stack before any action-stack source split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-PREFLIGHT-070`; read-only scans show the
  shared generate/chat action stack is a safe presentation-only boundary. The
  action-stack shell, SVG icons, button classes, disabled state, labels, and
  precomputed title strings can move to a focused component with callback props.
  Composer keeps `handleGenerate`, `handleChatButtonClick`, `currentPrice`,
  `generateActionLabel`, request assembly, `sendFlashBoardChatMessage`,
  `submitFlashBoardActiveGenerationRequest`, provider state, prompt input, CSS,
  stores, services, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. `FlashBoardComposer.tsx` is 3354 LOC; focused
  FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-SHELL-SPLIT-071` to extract only the
  generate/chat send-stop action stack into `FlashBoardActionStack.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-SHELL-SPLIT-071`; extracted the shared
  generate/chat send-stop button stack into `FlashBoardActionStack.tsx`.
  Composer now passes primitive labels, precomputed titles, `chatPanelOpen`,
  `canGenerate`, and callback props while keeping `handleGenerate`,
  `handleChatButtonClick`, price computation, request assembly, chat service
  calls, queue submit, provider state, prompt input, CSS, stores, services,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. `FlashBoardComposer.tsx` is now 3322 LOC and
  `FlashBoardActionStack.tsx` is 70 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROLS-PREFLIGHT-072` to classify the
  remaining normal generation control stack and model/audio/Suno/parameter
  popovers before any further Composer source split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROLS-PREFLIGHT-072`; read-only scans
  show the normal generation popover contents are still coupled to provider
  selection, price estimates, ElevenLabs/Suno state mutation, and prompt-refine
  service triggers. The smallest safe next source split is the control-shell
  and pill-row presentation only, with existing popover JSX passed as children.
  Composer keeps popover content, `handleProviderChange`, price estimates,
  audio/Suno state ownership, prompt-refine implementation, request assembly,
  CSS, stores, services, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROL-SHELL-SPLIT-073` to extract the
  non-chat control shell and pill-row presentation into
  `FlashBoardGenerationControls.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROL-SHELL-SPLIT-073`; extracted the
  non-chat generation control shell, pill-row presentation, selected model
  label, and popover host wrapper into `FlashBoardGenerationControls.tsx`.
  Existing model/audio/Suno/parameter popover JSX is passed as children, so
  Composer still owns popover contents, `handleProviderChange`, price
  estimates, audio/Suno state mutation, prompt-refine implementation, request
  assembly, CSS, stores, services, project schema, Media Board, Timeline,
  render, export, preview, and media runtime. `FlashBoardComposer.tsx` is now
  3244 LOC and `FlashBoardGenerationControls.tsx` is 209 LOC. Focused
  FlashBoard tests, `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-POPOVERS-PREFLIGHT-074` to classify the
  remaining model/audio/Suno/parameter popovers before moving any popover
  content out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-POPOVERS-PREFLIGHT-074`; read-only scans
  show model picker and generic parameter popovers still depend on provider
  selection and price estimates, while ElevenLabs popovers depend on voice/model
  loading, preview, and local voice state. The Suno model/mode/tuning popover
  group is the smallest safe source boundary because it can move as pure
  presentation with primitive values and callback props. Composer keeps
  provider selection, price estimates, ElevenLabs state/loading/preview, generic
  parameter estimates, prompt-refine implementation, request assembly, CSS,
  stores, services, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUNO-POPOVERS-SHELL-SPLIT-075` to extract only the
  Suno model, Suno mode, and Suno tuning popover presentation into
  `FlashBoardSunoPopovers.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUNO-POPOVERS-SHELL-SPLIT-075`; extracted Suno model,
  Suno mode, and Suno tuning popover presentation into
  `FlashBoardSunoPopovers.tsx`. Composer passes primitive values, option lists,
  close callbacks, tuning setters, model setter, mode setter, and reset callback;
  Composer still owns Suno state, version normalization, reset logic,
  prompt-refine behavior, request assembly, services, stores, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 3170 LOC and `FlashBoardSunoPopovers.tsx` is
  167 LOC. Focused FlashBoard tests, `npx tsc -b --pretty false`, and
  `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-POPOVERS-PREFLIGHT-076` to classify the
  ElevenLabs model, voice, output, and voice-settings popovers before moving
  any ElevenLabs popover content out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-POPOVERS-PREFLIGHT-076`; read-only scans
  show the Voice popover is still coupled to voice-list loading, search state,
  preview playback, manual voice fields, and hosted/local availability copy. The
  smallest safe next source split is the ElevenLabs settings popover group:
  model selector, output/language options, and voice-settings controls.
  Composer keeps the Voice picker, voice loading/search/preview/manual fields,
  output normalization, voice-setting mutation, request assembly, services,
  stores, CSS, project schema, Media Board, Timeline, render, export, preview,
  and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-SETTINGS-POPOVERS-SPLIT-077` to extract only
  the ElevenLabs model, output, and voice-settings popover presentation into
  `FlashBoardElevenLabsSettingsPopovers.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-SETTINGS-POPOVERS-SPLIT-077`; extracted the
  ElevenLabs model selector, output/language options, and voice-settings
  popover presentation into `FlashBoardElevenLabsSettingsPopovers.tsx`. The
  Voice picker stays in Composer because it still owns voice-list loading,
  search state, preview playback, manual voice fields, and hosted/local empty
  copy. Composer also keeps output normalization, voice-setting mutation,
  request assembly, services, stores, CSS, project schema, Media Board,
  Timeline, render, export, preview, and media runtime. `FlashBoardComposer.tsx`
  is now 3075 LOC and `FlashBoardElevenLabsSettingsPopovers.tsx` is 168 LOC.
  Focused FlashBoard tests, `npx tsc -b --pretty false`, and `git diff --check`
  passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-PREFLIGHT-078` to classify the
  remaining ElevenLabs Voice picker before moving its loading/search/preview
  presentation.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-PREFLIGHT-078`; read-only
  scans show the Voice picker presentation can move without moving voice-loading
  effects or preview playback. Composer should keep voice-list loading/search
  effects, `handleSelectVoice`, `handlePreviewVoice`, hosted/local access
  decisions, voice state ownership, request assembly, services, stores, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. The next source packet passes a primitive voice-option list, empty
  message, manual field values, loading/error state, and callback props to a
  focused Voice picker component. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-SPLIT-079` to extract only the
  ElevenLabs Voice picker presentation into
  `FlashBoardElevenLabsVoicePopover.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-SPLIT-079`; extracted the
  ElevenLabs Voice picker presentation into
  `FlashBoardElevenLabsVoicePopover.tsx`. Composer passes primitive voice
  options, selected voice id, loading/error/empty text, search/manual-field
  values, and callback props. Composer keeps voice-loading effects,
  `handleSelectVoice`, `handlePreviewVoice`, hosted/local access decisions,
  voice state ownership, request assembly, services, stores, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 3029 LOC and
  `FlashBoardElevenLabsVoicePopover.tsx` is 122 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-PREFLIGHT-080` to
  classify the remaining model picker and generic aspect, duration, image-size,
  and mode popovers before moving any of that presentation.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-PREFLIGHT-080`;
  read-only scans show the model picker still depends on provider categories,
  provider switching, selected-entry state, and per-entry price estimates. The
  generic aspect, duration, image-size, and mode popovers are the smallest safe
  next source boundary if Composer keeps `selectedEntry`, price estimation,
  option planning, current parameter state, request assembly, services, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and
  media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-SPLIT-081` to extract
  only generic aspect, duration, image-size, and mode popover presentation into
  `FlashBoardParameterPopovers.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-SPLIT-081`; extracted
  generic aspect, duration, image-size, and mode popover presentation into
  `FlashBoardParameterPopovers.tsx`. Composer passes primitive option lists
  with labels, active state, optional credit text, and callbacks. Composer keeps
  the model picker, selected entry, price estimation, option planning,
  parameter state ownership, request assembly, services, stores, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 3008 LOC and
  `FlashBoardParameterPopovers.tsx` is 107 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-PREFLIGHT-082` to classify the remaining
  model picker, provider category tabs, provider switching, and per-entry price
  estimates before moving model picker presentation or adding a planner.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-PREFLIGHT-082`; read-only scans show the
  model picker can move as presentation if Composer keeps provider category
  grouping, active-category state, selected-entry state, per-entry price/source
  label computation, and `handleProviderChange`. The next source packet passes
  primitive category and entry DTOs plus callback props to a focused model
  picker component; Composer keeps provider switching, catalog types, price
  services, request assembly, services, stores, CSS, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Focused
  FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-SPLIT-083` to extract only model picker
  presentation into `FlashBoardModelPopover.tsx`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-SPLIT-083`; extracted model picker
  presentation into `FlashBoardModelPopover.tsx`. Composer passes primitive
  category DTOs, primitive entry DTOs, active category id, active entry id, and
  callback props. Composer keeps category/entry option planning, price/source
  labels, active-category state, selected-entry state, `handleProviderChange`,
  service/provider state, request assembly, services, stores, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 2955 LOC and `FlashBoardModelPopover.tsx` is
  111 LOC. Focused FlashBoard tests, `npx tsc -b --pretty false`, and
  `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUBMIT-PIPELINE-PREFLIGHT-084` to classify generation
  validation, request assembly, price/action labels, and submit orchestration
  before moving any business logic out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUBMIT-PIPELINE-PREFLIGHT-084`; read-only scans show
  validation/action-label state and submit queue orchestration should stay in
  Composer for now. The narrow safe source boundary is the generation request
  payload builder inside `handleGenerate`: it can move as a pure planner that
  receives primitive/composer values and returns `FlashBoardGenerationRequest`.
  Composer keeps `canGenerate`, `currentPrice`, button labels/titles,
  validation errors, `submitFlashBoardActiveGenerationRequest`, queue submit,
  prompt-refine, stores, services, CSS, project schema, Media Board, Timeline,
  render, export, preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-REQUEST-BUILDER-SPLIT-085` to extract only
  the pure generation request builder into
  `FlashBoardGenerationRequestPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-REQUEST-BUILDER-SPLIT-085`; extracted the
  pure generation request payload builder into
  `FlashBoardGenerationRequestPlanner.ts`. Composer now passes primitive
  values, selected-entry capabilities, voice/Suno values, normalized multishot
  data, reference ids, and media ids to `buildFlashBoardGenerationRequest`.
  Composer keeps `canGenerate`, validation/action label derivation,
  `handleGenerate` submit guard, `submitFlashBoardActiveGenerationRequest`,
  stores, services, CSS, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. `FlashBoardComposer.tsx` is now 2948 LOC and
  `FlashBoardGenerationRequestPlanner.ts` is 128 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-VALIDATION-ACTION-STATE-PREFLIGHT-086` to classify
  validation errors, `canGenerate`, current price, and action labels before
  moving any derived action-state logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-VALIDATION-ACTION-STATE-PREFLIGHT-086`; read-only
  scans show validation errors, current price, button labels/titles, and
  `canGenerate` form a coherent pure derived-state boundary. The next source
  packet can extract this into a planner that receives primitive/composer,
  provider, pricing, auth, and validation inputs and returns derived action
  state. Composer keeps prompt-refine, provider switching, request builder,
  `handleGenerate` submit guard, `submitFlashBoardActiveGenerationRequest`,
  stores, queue submit, CSS, project schema, Media Board, Timeline, render,
  export, preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-GENERATION-ACTION-STATE-SPLIT-087` to extract
  validation errors, current price, button labels/titles, and `canGenerate`
  into `FlashBoardGenerationActionStatePlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-GENERATION-ACTION-STATE-SPLIT-087`; extracted pure
  generation action-state derivation into
  `FlashBoardGenerationActionStatePlanner.ts`. Composer now passes
  primitive/composer values, selected-entry capabilities, auth/key flags, price
  inputs, prompt length, multishot state, Seedance validation result, and
  ElevenLabs/Suno settings. Composer keeps prompt-refine, provider switching,
  request builder calls, `handleGenerate` submit guard,
  `submitFlashBoardActiveGenerationRequest`, stores, queue submit, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 2829 LOC and
  `FlashBoardGenerationActionStatePlanner.ts` is 277 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PREFLIGHT-088` to classify
  provider switching, parameter resets, and composer patch assembly before
  moving any provider-transition logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PREFLIGHT-088`; read-only scans
  show provider transition is a coherent pure planner boundary. The current
  Composer block sets local provider ids, resolves the selected catalog entry,
  picks the first supported version, resets unsupported mode/duration/aspect
  ratio/image-size values, and assembles the composer patch for output type,
  audio flags, multishot data, media references, ElevenLabs voice settings,
  and Suno settings. The next source packet can move that derived transition
  decision into a planner while Composer keeps React setters, `updateComposer`,
  popover closing, provider option planning, prompt-refine, submit
  orchestration, stores, services with side effects, CSS, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Focused
  FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PLANNER-SPLIT-089` to extract only
  pure provider-transition planning into
  `FlashBoardProviderTransitionPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PLANNER-SPLIT-089`; extracted pure
  provider-transition planning into
  `FlashBoardProviderTransitionPlanner.ts`. Composer still owns selected-entry
  lookup, React setters for service/provider/version/mode/duration/aspect
  ratio/image size, `updateComposer`, popover closing, provider option
  planning, prompt-refine, submit orchestration, stores, services with side
  effects, CSS, project schema, Media Board, Timeline, render, export, preview,
  and media runtime. `FlashBoardComposer.tsx` is now 2825 LOC and
  `FlashBoardProviderTransitionPlanner.ts` is 152 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PREFLIGHT-090` to classify the Composer
  sync effect that mirrors local provider/audio/Suno/ElevenLabs state into the
  persisted composer patch.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PREFLIGHT-090`; read-only scans show the
  Composer sync effect is a coherent pure patch-planner boundary. It derives
  the persisted composer patch from selected-entry output type, service,
  provider, version, effective audio state, multishot prompts, ElevenLabs voice
  fields, Suno fields, audio/media-reference cleanup rules, and reference-media
  clamping output. Composer should keep the `useEffect` lifecycle,
  `updateComposer`, local state setters, prompt-refine, submit orchestration,
  stores, services with side effects, CSS, project schema, Media Board,
  Timeline, render, export, preview, and media runtime. Focused FlashBoard
  tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PLANNER-SPLIT-091` to extract only the
  pure composer sync patch builder into `FlashBoardComposerSyncPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PLANNER-SPLIT-091`; extracted pure
  local-state-to-persisted-composer patch derivation into
  `FlashBoardComposerSyncPlanner.ts`. Composer keeps the `useEffect`
  lifecycle, `updateComposer`, local state setters, selected-entry lookup,
  prompt-refine, submit orchestration, stores, services with side effects, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. `FlashBoardComposer.tsx` is now 2775 LOC and
  `FlashBoardComposerSyncPlanner.ts` is 164 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-PREFLIGHT-092` to classify the
  prompt-refine async controller and identify whether a pure request/input
  planner can split before any service orchestration changes.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-PREFLIGHT-092`; read-only scans show the
  prompt-refine block mixes several responsibilities, but its request/input
  assembly is a safe pure boundary. Composer should keep hosted/BYO gating,
  auth/pricing/settings dialogs, abort-controller ownership, streaming
  callbacks, `parseSunoPromptRefinement` application, before/after restore
  state, prompt field setters, prompt-refine services, stores, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-INPUT-PLANNER-SPLIT-093` to extract only
  prompt-refine input availability and `RefineFlashBoardPromptInput` assembly
  into `FlashBoardPromptRefinePlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-INPUT-PLANNER-SPLIT-093`; extracted pure
  prompt-refine input availability and `RefineFlashBoardPromptInput` assembly
  into `FlashBoardPromptRefinePlanner.ts`. Composer keeps hosted/BYO gating,
  auth/pricing/settings dialogs, abort-controller ownership, streaming
  callbacks, `parseSunoPromptRefinement` application, before/after restore
  state, prompt field setters, prompt-refine service calls, stores, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. `FlashBoardComposer.tsx` is now 2768 LOC and
  `FlashBoardPromptRefinePlanner.ts` is 129 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-RESPONSE-PREFLIGHT-094` to classify Suno
  streamed response application, fallback restore behavior, and undo/clear
  state before moving any remaining prompt-refine controller logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-RESPONSE-PREFLIGHT-094`; read-only scans
  show the remaining prompt-refine controller still owns async service calls,
  abort lifetime, streaming callbacks, and actual field setters, but the field
  update decisions are a safe pure boundary. The next source packet can extract
  streaming delta application, final response application, error restore
  planning, and undo restore planning as pure functions that return prompt/Suno
  field updates. Composer should keep `parseSunoPromptRefinement`, setter
  execution, abort-controller ownership, prompt-refine service calls,
  hosted/BYO gating, dialogs, stores, CSS, project schema, Media Board,
  Timeline, render, export, preview, and media runtime. Focused FlashBoard
  tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-FIELD-PLANNER-SPLIT-095` to add pure
  prompt-refine field update planning to `FlashBoardPromptRefinePlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-FIELD-PLANNER-SPLIT-095`; added pure
  prompt-refine field update planning for streaming deltas, final responses,
  error fallback restore, and undo restore to `FlashBoardPromptRefinePlanner.ts`.
  Composer still owns `parseSunoPromptRefinement`, actual React setters,
  `streamedPrompt`/`streamedSunoFields`, abort-controller ownership,
  prompt-refine service calls, hosted/BYO gating, dialogs, stores, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. `FlashBoardComposer.tsx` is now 2767 LOC and
  `FlashBoardPromptRefinePlanner.ts` is exactly 250 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-CONTROLLER-PREFLIGHT-096` to classify
  whether the remaining prompt-refine async controller can move safely, or
  should stay in Composer while the next lane shifts to another Composer
  controller.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-CONTROLLER-PREFLIGHT-096`; read-only
  scans show the remaining prompt-refine controller should stay in Composer for
  now. It owns hosted/BYO gating, auth/pricing/settings dialog side effects,
  abort-controller lifetime, prompt-refine service calls, streaming callback
  lifetime, setter execution, error state, and loading state. Moving it now
  would create a side-effectful wrapper rather than a cleaner pure boundary.
  Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PREFLIGHT-097` to classify chat send gating,
  request/message planning, abort behavior, and provider-specific credential
  checks before moving any chat logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PREFLIGHT-097`; read-only scans show chat
  send contains a coherent pure planning boundary. The block currently owns
  open-panel behavior, abort-on-active-chat behavior, empty prompt validation,
  OpenAI hosted/BYO credential gating with dialog target, Anthropic key gating,
  request prompt assembly, optimistic user/assistant message creation, chat
  request payload assembly, and completion/error message patching. The next
  source packet can move pure planning while Composer keeps actual dialog
  calls, AbortController lifetime, ref mutation, React setters,
  `sendFlashBoardChatMessage`, clipboard behavior, Lemonade health effects,
  stores, CSS, project schema, Media Board, Timeline, render, export, preview,
  and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PLANNER-SPLIT-098` to extract pure chat send
  gating, request/message planning, and assistant message patching into
  `FlashBoardChatSendPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PLANNER-SPLIT-098`; extracted pure chat send
  action selection, credential gating, request prompt assembly, optimistic
  message planning, chat request payload planning, and assistant response/error
  message patching into `FlashBoardChatSendPlanner.ts`. Composer still owns
  close-popover calls, dialog execution, AbortController lifetime, ref
  mutation, React setters, `sendFlashBoardChatMessage`, clipboard behavior,
  Lemonade health effects, stores, CSS, project schema, Media Board, Timeline,
  render, export, preview, and media runtime. `FlashBoardComposer.tsx` is now
  2746 LOC and `FlashBoardChatSendPlanner.ts` is 155 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PREFLIGHT-099` to classify chat provider
  options, Lemonade discovered model merge, active model lookup, temperature
  and reasoning-support derivation, provider fallback, and model fallback
  before moving any chat option planning.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PREFLIGHT-099`; read-only scans show chat
  model option derivation, active model lookup, temperature support, OpenAI
  reasoning support/options, provider options, provider label, hosted credit
  label, chat button/charge label, default provider model, provider fallback,
  model fallback, and reasoning-effort fallback are a coherent pure planning
  boundary. Composer should keep Lemonade health effect execution, provider and
  model React setters, chat panel state, stores, CSS, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Focused
  FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PLANNER-SPLIT-100` to extract pure chat
  option derivation and fallback planning into
  `FlashBoardChatOptionsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PLANNER-SPLIT-100`; extracted pure chat
  model option derivation, active model lookup, temperature/reasoning support,
  reasoning options, provider options, labels, hosted credit labels,
  provider/model fallback, and reasoning fallback into
  `FlashBoardChatOptionsPlanner.ts`. Composer still owns Lemonade health effect
  execution, provider/model/reasoning React setters, chat panel state, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and
  media runtime. `FlashBoardComposer.tsx` is now 2459 LOC and
  `FlashBoardChatOptionsPlanner.ts` is 145 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLLER-PREFLIGHT-101` to classify remaining
  chat controller behavior: provider selection side effects, clear history,
  prompt changes, clipboard copy, history scroll, Lemonade health side effects,
  and whether any pure command planning remains worth extracting.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLLER-PREFLIGHT-101`; read-only scans show
  the remaining chat controller work is intentionally side-effectful and should
  stay in Composer for now: provider/model setter sequencing, panel open/error
  resets, AbortController cleanup, copied-message timeout cleanup, clipboard
  writes, history scroll refs, Lemonade health effect execution, and small
  prompt input setters. A further chat split would mostly wrap React setters,
  DOM refs, browser APIs, or service-effect lifetime. `FlashBoardComposer.tsx`
  is now 2459 LOC, `FlashBoardChatSendPlanner.ts` is 141 LOC, and
  `FlashBoardChatOptionsPlanner.ts` is 145 LOC. Focused FlashBoard tests
  passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUBMIT-CONTROLLER-PREFLIGHT-102` to reclassify the
  remaining generation submit controller after the later request/action-state,
  provider-transition, composer-sync, prompt-refine, and chat planner splits.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUBMIT-CONTROLLER-PREFLIGHT-102`; read-only scans show
  submit orchestration should stay in Composer for now. `handleGenerate` is now
  only the `canGenerate`/`selectedEntry` guard, request audio/Suno mode
  derivation, `buildFlashBoardGenerationRequest`, and
  `submitFlashBoardActiveGenerationRequest`. The request payload and
  action-state business rules are already split into
  `FlashBoardGenerationRequestPlanner.ts` and
  `FlashBoardGenerationActionStatePlanner.ts`; another submit planner would be
  a thin wrapper around queue submission and existing planners. Focused
  FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PREFLIGHT-103` to classify aspect,
  duration, image-size, and mode popover option derivation before moving any
  parameter option planning out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PREFLIGHT-103`; read-only scans show
  aspect, duration, image-size, and mode option derivation is a coherent pure
  planning boundary. Composer currently builds the arrays inline for
  `FlashBoardParameterPopovers`, including duration/image-size/mode price
  metadata through `getFlashBoardPriceEstimate`; `FlashBoardParameterPopovers`
  only renders options and calls parameter setters plus popover close. Composer
  should keep selected-entry state, active popover state, React setters,
  popover close calls, stores, CSS, project schema, Media Board, Timeline,
  render, export, preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PLANNER-SPLIT-104` to extract only
  the pure aspect/duration/image-size/mode option derivation into
  `FlashBoardParameterOptionsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PLANNER-SPLIT-104`; extracted pure
  aspect, duration, image-size, and mode option derivation plus price metadata
  into `FlashBoardParameterOptionsPlanner.ts`. Composer now passes the planner
  DTOs to `FlashBoardParameterPopovers` and still owns selected-entry state,
  active popover state, React setters, popover close calls, stores, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. `FlashBoardComposer.tsx` is now 2410 LOC and
  `FlashBoardParameterOptionsPlanner.ts` is 157 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PREFLIGHT-105` to classify model catalog
  visibility, category grouping, active category fallback, model entry DTOs,
  and model price/source labels before moving any model option planning out of
  Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PREFLIGHT-105`; read-only scans show
  model catalog visibility, category grouping, selected/initial entry lookup,
  active category fallback, model button labels, source labels, and model entry
  price metadata form a coherent pure planning boundary. Composer should keep
  provider switch execution, provider-transition setter/application,
  selected-entry consumers, active category setter, React setters, popover close
  calls, stores, CSS, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PLANNER-SPLIT-106` to extract only
  model catalog visibility, category grouping, initial/selected entry lookup,
  model button label, active category fallback, and model popover entry DTOs
  into `FlashBoardModelOptionsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PLANNER-SPLIT-106`; extracted model
  catalog visibility, category grouping, initial/selected entry lookup, active
  category fallback, model button label, and model popover entry DTO
  construction into `FlashBoardModelOptionsPlanner.ts`. Composer now keeps
  provider switch execution, provider-transition setter/application,
  selected-entry consumers, active category setter, React setters, popover
  close calls, stores, CSS, project schema, Media Board, Timeline, render,
  export, preview, and media runtime. `FlashBoardComposer.tsx` is now 2300 LOC
  and `FlashBoardModelOptionsPlanner.ts` is 288 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PREFLIGHT-107` to classify
  ElevenLabs model option fallback, selected model/limit derivation, model
  popover DTOs, voice DTOs, and selected-voice lookup before moving any
  ElevenLabs option planning out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PREFLIGHT-107`; read-only scans
  show ElevenLabs model fallback/options, selected model lookup, character
  limit, audio model/output labels, model meta text, output option DTOs, voice
  option DTOs, and selected-voice lookup form a coherent pure planning
  boundary. Composer should keep ElevenLabs API loading effects, refresh nonce,
  loading/error state setters, voice/model/output selection execution, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and
  media runtime. Focused FlashBoard tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PLANNER-SPLIT-108` to extract only
  pure ElevenLabs option/state DTO derivation into
  `FlashBoardElevenLabsOptionsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PLANNER-SPLIT-108`; extracted pure
  ElevenLabs model fallback/options, selected model lookup, character-limit
  derivation, audio model/output labels, model meta text, output option DTOs,
  voice option DTOs, and selected-voice lookup into
  `FlashBoardElevenLabsOptionsPlanner.ts`. Composer now keeps ElevenLabs API
  loading effects, refresh nonce, loading/error state setters,
  voice/model/output selection execution, stores, CSS, project schema, Media
  Board, Timeline, render, export, preview, and media runtime.
  `FlashBoardComposer.tsx` is now 2254 LOC and
  `FlashBoardElevenLabsOptionsPlanner.ts` is 123 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-CONTROLLER-PREFLIGHT-109` to classify the
  remaining ElevenLabs API loading effects, refresh behavior, preview command,
  voice/model/output selection execution, and voice-settings setters before
  moving any controller logic.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-CONTROLLER-PREFLIGHT-109`; read-only scans
  show the remaining ElevenLabs controller behavior should stay in Composer for
  now. The remaining code owns model/voice API loading effects, AbortController
  and timeout lifetime, refresh nonce, loading/error setters, voice preview,
  voice/model/output selection execution, and voice settings setters. A further
  split would mostly wrap service calls and React setters. Focused FlashBoard
  tests passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PREFLIGHT-110` to classify Suno model,
  mode, tuning label, tuning reset, and Suno popover option derivation before
  moving any Suno option planning out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PREFLIGHT-110`; read-only scans show the
  current model id normalization, Suno model button label, Suno mode button
  label, tuning-changed flag, reset defaults, model option DTOs, and vocal
  gender option DTOs can split as pure planning. Composer must keep React
  state setters, Suno model/mode/tuning selection execution, prompt-refine side
  effects, stores, CSS, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. Current snapshots: `FlashBoardComposer.tsx` 2472
  LOC, `FlashBoardSunoPopovers.tsx` 167 LOC, focused FlashBoard tests passed
  with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PLANNER-SPLIT-111` to extract only pure
  Suno option-state and reset-default planning into
  `FlashBoardSunoOptionsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PLANNER-SPLIT-111`; extracted pure Suno
  model normalization, model/mode button labels, tuning-changed flag, model
  option DTOs, vocal gender option DTOs, and reset-default state into
  `FlashBoardSunoOptionsPlanner.ts`. Composer keeps React state, setter
  execution, Suno model/mode/tuning application, prompt-refine side effects,
  stores, CSS, project schema, Media Board, Timeline, render, export, preview,
  and media runtime. Current snapshots: `FlashBoardComposer.tsx` 2471 LOC,
  `FlashBoardSunoOptionsPlanner.ts` 97 LOC, `FlashBoardSunoPopovers.tsx` 167
  LOC. Focused FlashBoard tests, `npx tsc -b --pretty false`, `git diff
  --check`, and `fc.exe /b AGENTS.md CLAUDE.md` passed; `git diff --check`
  reported only existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-SUNO-CONTROLLER-PREFLIGHT-112` to classify the
  remaining Suno model/mode/tuning setter execution, prompt-refine integration,
  and request/hydration touchpoints before any further Suno controller split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-SUNO-CONTROLLER-PREFLIGHT-112`; read-only scans show
  the remaining Suno behavior should stay in Composer for now. The remaining
  code owns React setter execution for model/mode/tuning, `version` changes,
  prompt-refine service flow and field-update application, sync-patch
  application, request-builder invocation, and prompt restore state. Existing
  planners already own the pure Suno option state, prompt-refine field updates,
  request assembly, and sync-patch derivation. A Suno controller source split
  would mostly wrap state setters or side-effect orchestration. Focused
  FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-113` to map the
  remaining `FlashBoardComposer.tsx` responsibilities and select the next
  narrow non-Suno source boundary.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-113`; read-only
  scans map the remaining Composer clusters as chat service controller,
  prompt-refine service controller, ElevenLabs API controller, provider/sync
  effects, multishot controller, and reference role/remove commands. The next
  safe source boundary is the reference command hook because reference focus,
  drop, and strip presentation are already split, while the role/remove command
  code only owns Composer patch calculation and hover cleanup. Focused
  FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-COMMAND-HOOK-SPLIT-114` to extract reference
  remove and role-change callbacks into `useFlashBoardReferenceCommands.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-COMMAND-HOOK-SPLIT-114`; extracted reference
  remove and role-change callbacks into `useFlashBoardReferenceCommands.ts`.
  Composer now wires the hook next to the existing reference drop and focus
  hooks, while reference badge derivation, drop parsing, focus/auto-scroll,
  strip presentation, store update execution, provider/request/sync/chat/
  prompt-refine/ElevenLabs controllers, CSS, project schema, Media Board,
  Timeline, render, export, preview, and media runtime remain unchanged.
  Current snapshots: `FlashBoardComposer.tsx` 2379 LOC,
  `useFlashBoardReferenceCommands.ts` 150 LOC,
  `useFlashBoardReferenceDrop.ts` 109 LOC, `useFlashBoardReferenceFocus.ts` 151
  LOC, and `FlashBoardReferenceStrip.tsx` 121 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; `git diff --check` reported only
  existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PREFLIGHT-115` to classify whether
  reference badge derivation can split as pure planning before moving any more
  reference source.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PREFLIGHT-115`; read-only scans show
  reference badge construction can split as pure planning. The extractable
  logic maps `startMediaFileId`, `endMediaFileId`, the already-clamped
  reference id list, and `mediaFilesById` into primitive badge DTOs for
  `FlashBoardReferenceStrip`. Composer must keep MediaStore reads,
  `mediaFilesById` construction, reference type guarding, drop/focus/command
  hooks, store update execution, prompt-refine reference counts, CSS, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
  Current snapshots: `FlashBoardComposer.tsx` 2379 LOC,
  `FlashBoardReferenceStrip.tsx` 121 LOC,
  `useFlashBoardReferenceCommands.ts` 150 LOC,
  `useFlashBoardReferenceDrop.ts` 109 LOC, and
  `useFlashBoardReferenceFocus.ts` 151 LOC. Focused FlashBoard tests passed
  with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PLANNER-SPLIT-116` to extract only
  reference badge DTO construction into `FlashBoardReferenceBadgePlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PLANNER-SPLIT-116`; extracted
  reference badge DTO construction into `FlashBoardReferenceBadgePlanner.ts`.
  Composer still owns MediaStore reads, `mediaFilesById` construction,
  reference type guarding, drop/focus/command hook wiring, store update
  execution, prompt-refine reference counts, CSS, project schema, Media Board,
  Timeline, render, export, preview, and media runtime. Current snapshots:
  `FlashBoardComposer.tsx` 2337 LOC, `FlashBoardReferenceBadgePlanner.ts` 87
  LOC, `FlashBoardReferenceStrip.tsx` 121 LOC,
  `useFlashBoardReferenceCommands.ts` 150 LOC,
  `useFlashBoardReferenceDrop.ts` 109 LOC, and
  `useFlashBoardReferenceFocus.ts` 151 LOC. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, and `git diff --check` passed; `git diff
  --check` reported only existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-PREFLIGHT-117` to classify
  remaining Multishot state, helper math, and callbacks before moving any
  Multishot controller logic out of Composer.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-PREFLIGHT-117`; read-only scans
  show the next safe source boundary is pure Multishot planning/math, not the
  full React controller yet. Extractable logic includes max-shot limiting,
  duration rebalancing, default shot creation, add/remove shot math, and
  fallback prompt construction. Composer should keep Multishot React state,
  panel open/close timeout lifetime, `setGenerateAudio` coupling, selected
  provider support checks, UI callbacks, request/sync inputs, CSS, stores,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 2337 LOC,
  `FlashBoardMultishotPanel.tsx` 91 LOC,
  `FlashBoardGenerationControls.tsx` 209 LOC, and
  `FlashBoardGenerationActionStatePlanner.ts` 277 LOC. Focused FlashBoard tests
  passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PLANNER-SPLIT-118` to extract only pure
  Multishot helper math into `FlashBoardMultishotPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PLANNER-SPLIT-118`; extracted pure
  Multishot helper math into `FlashBoardMultishotPlanner.ts`: max-shot
  limiting, duration rebalancing, default shot creation, add/remove shot math,
  and fallback prompt construction. Composer still owns Multishot React state,
  panel open/close timeout lifetime, `setGenerateAudio` coupling, selected
  provider support checks, UI callbacks, request/sync inputs, CSS, stores,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 2235 LOC,
  `FlashBoardMultishotPlanner.ts` 116 LOC,
  `FlashBoardMultishotPanel.tsx` 91 LOC,
  `FlashBoardGenerationControls.tsx` 209 LOC, and
  `FlashBoardGenerationActionStatePlanner.ts` 277 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; `git diff --check` reported only
  existing LF-to-CRLF working-copy warnings. The Multishot planner has no
  React, store, CSS, project, timeline, render/export/preview, or runtime
  imports.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-PREFLIGHT-119` to classify
  whether the remaining Multishot React state/effects/callback execution can
  split into a hook after pure math is separated.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-PREFLIGHT-119`; read-only
  scans show the remaining Multishot React state, panel open/close timeout
  lifetime, audio-forcing effect, support-reset effect, and shot-edit callbacks
  can split into a local hook if Composer injects `setGenerateAudio`, duration,
  selected output type, and provider support booleans. Composer must keep
  GenerateAudio state, provider/support derivation, request/sync inputs,
  generation control wiring, prompt-refine/chat/ElevenLabs controllers, CSS,
  stores, project schema, Media Board, Timeline, render, export, preview, and
  media runtime. Focused FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-SPLIT-120` to extract only
  local Multishot React state/effects/callbacks into
  `useFlashBoardMultishotController.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-SPLIT-120`; extracted local
  Multishot React state/effects/callbacks into
  `useFlashBoardMultishotController.ts`. Composer now injects duration,
  `generateAudio`, `setGenerateAudio`, audio/multishot support booleans, and
  selected output type, while keeping GenerateAudio state, provider/support
  derivation, request/sync inputs, generation control wiring,
  prompt-refine/chat/ElevenLabs controllers, CSS, stores, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Current
  snapshots: `FlashBoardComposer.tsx` 2122 LOC,
  `useFlashBoardMultishotController.ts` 183 LOC,
  `FlashBoardMultishotPlanner.ts` 116 LOC,
  `FlashBoardMultishotPanel.tsx` 91 LOC,
  `FlashBoardGenerationControls.tsx` 209 LOC, and
  `FlashBoardGenerationActionStatePlanner.ts` 277 LOC. Focused FlashBoard
  tests, `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; `git diff --check` reported only
  existing LF-to-CRLF working-copy warnings. The Multishot controller hook has
  no store, service, project, Timeline, render/export/preview, Media Board, or
  media runtime dependencies.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-121` to rescan
  the remaining Composer clusters after Reference and Multishot boundaries are
  split.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-121`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after Reference and
  Multishot controller splits. Current snapshots: `FlashBoardComposer.tsx`
  2122 LOC, `useFlashBoardMultishotController.ts` 183 LOC,
  `FlashBoardMultishotPlanner.ts` 116 LOC, `FlashBoardReferenceBadgePlanner.ts`
  87 LOC, `FlashBoardSunoOptionsPlanner.ts` 97 LOC, and adjacent role modules
  remain under their budgets except the known `FlashBoardModelOptionsPlanner.ts`
  at 329 LOC and `FlashBoardGenerationActionStatePlanner.ts` at 277 LOC.
  Remaining Composer-owned controller clusters are chat send/lifetime and
  clipboard behavior, prompt-refine service/stream lifetime, ElevenLabs
  model/voice loading, generation submit orchestration, store/settings/account
  selectors, and persistence sync. Those stay in Composer for now because they
  are service, browser, dialog, queue, or setter orchestration. The next safe
  source boundary is the local popover controller: popover state/ref,
  open/close/toggle, outside-click and closing-timer effects, and inline submenu
  class derivation. Focused FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-POPOVER-HOOK-SPLIT-122` to extract only local
  Composer popover UI behavior into `useFlashBoardComposerPopovers.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-POPOVER-HOOK-SPLIT-122`; extracted local
  Composer popover state/ref, open/close/toggle behavior, outside-click and
  closing-timer effects, and inline submenu class derivation into
  `useFlashBoardComposerPopovers.ts`. Composer keeps model category state,
  provider transition logic, generation submit, chat, prompt-refine,
  ElevenLabs loading, Suno/voice setting setters, persistence sync, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 2037 LOC and
  `useFlashBoardComposerPopovers.ts` 110 LOC. The hook dependency scan stayed
  free of stores, services, CSS, Media Board, Timeline, render/export/preview,
  and media runtime. Focused FlashBoard tests, `npx tsc -b --pretty false`,
  `git diff --check`, and `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check
  reported only existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-VOICE-CONTROLS-PREFLIGHT-123` to classify whether the
  remaining local ElevenLabs voice/output/settings helpers can split without
  moving ElevenLabs service loading or broader Composer controller behavior.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-VOICE-CONTROLS-PREFLIGHT-123`; classified the remaining
  ElevenLabs voice/output/settings logic. ElevenLabs model/voice loading,
  `cloudAiService`/`elevenLabsService` calls, `AbortController` lifetime,
  voice search/refresh state, and browser audio preview stay in Composer.
  Pure local helpers for voice settings normalization/equality, output-format
  normalization, numeric voice-setting parsing, speaker-boost patching, reset
  state, and voice selection can split without touching CSS, services, stores,
  project schema, Media Board, Timeline, render/export/preview, or media
  runtime. Focused FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-VOICE-SETTINGS-PLANNER-SPLIT-124` to extract only pure
  voice/output/settings planning into `FlashBoardVoiceSettingsPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-VOICE-SETTINGS-PLANNER-SPLIT-124`; extracted pure
  voice settings normalization/equality, ElevenLabs output-format fallback,
  voice selection, numeric voice-setting parsing, speaker-boost patching, and
  reset-default state into `FlashBoardVoiceSettingsPlanner.ts`. Composer keeps
  ElevenLabs model/voice loading, service calls, `AbortController` lifetime,
  voice search/refresh state, browser audio preview, component setter wiring,
  stores, CSS, project schema, Media Board, Timeline, render, export, preview,
  and media runtime. Current snapshots: `FlashBoardComposer.tsx` 2012 LOC and
  `FlashBoardVoiceSettingsPlanner.ts` 92 LOC. The planner dependency scan
  stayed free of stores/hooks, services, CSS, Media Board, Timeline,
  render/export/preview, and media runtime. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check reported only existing
  LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-125` to rescan
  the remaining Composer clusters after popover and voice-settings splits.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-125`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after popover and
  voice-settings planner splits. Composer remains at 2012 LOC. Store/settings/
  account selectors, model/category state, ElevenLabs loading effects, chat
  service lifetime, prompt-refine service lifetime, generation submit, dialog
  calls, browser clipboard/audio preview APIs, persistence sync, and JSX assembly
  stay in Composer. The next safe source boundary is local prompt textarea
  autosize behavior: `promptInputRef`, `chatInputRef`, `resizePromptInput`, and
  the layout effect that resizes the active prompt input. Focused FlashBoard
  tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-PROMPT-AUTOSIZE-HOOK-SPLIT-126` to extract only prompt
  textarea refs/autosize into `useFlashBoardPromptAutosize.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-AUTOSIZE-HOOK-SPLIT-126`; extracted local prompt
  textarea refs, resize function, and active-input layout resize effect into
  `useFlashBoardPromptAutosize.ts`. `FlashBoardPromptEditor.tsx` props stayed
  unchanged. Composer keeps prompt/chat state setters, prompt-refine, chat,
  submit, dialogs, browser clipboard/audio preview, persistence sync, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 2000 LOC and
  `useFlashBoardPromptAutosize.ts` 48 LOC. The hook dependency scan stayed free
  of stores/hooks, services, CSS, Media Board, Timeline, render/export/preview,
  and media runtime. Focused FlashBoard tests, `npx tsc -b --pretty false`,
  `git diff --check`, and `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check
  reported only existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-127` to rescan
  whether any remaining Composer code can split without wrapping controller
  service lifetimes.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-127`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after prompt autosize.
  Composer remains at 2000 LOC. Store/settings/account selectors,
  model/category state, ElevenLabs loading effects, chat service lifetime,
  prompt-refine service lifetime, generation submit, dialog calls, browser
  clipboard/audio preview APIs, persistence sync, and JSX assembly stay in
  Composer. The next safe source boundary is local chat-history scroll behavior:
  `chatHistoryRef` and the layout effect that scrolls the chat output after chat
  messages or chat errors change. Focused FlashBoard tests passed with 5 files
  and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-HISTORY-SCROLL-HOOK-SPLIT-128` to extract only
  chat-history scroll ref/effect into `useFlashBoardChatHistoryScroll.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-HISTORY-SCROLL-HOOK-SPLIT-128`; extracted local
  chat-history scroll ref/effect into `useFlashBoardChatHistoryScroll.ts`.
  `FlashBoardChatOutput.tsx` props stayed unchanged. Composer keeps chat state
  setters, chat send/clear/copy handlers, chat service lifetime, prompt-refine,
  submit, dialogs, browser clipboard/audio preview, persistence sync, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 1995 LOC and
  `useFlashBoardChatHistoryScroll.ts` 24 LOC. The hook dependency scan stayed
  free of stores/hooks, services, CSS, Media Board, Timeline,
  render/export/preview, and media runtime. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check reported only existing
  LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-129` to rescan
  whether any remaining Composer code can split without wrapping service
  lifetimes, submit, stores, schema, Media Board, Timeline, render, export,
  preview, or media runtime.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-129`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after chat-history scroll.
  Composer remains at 1995 LOC. Store/settings/account selectors,
  model/category state, ElevenLabs loading effects, Lemonade health effect,
  chat service lifetime, prompt-refine service lifetime, generation submit,
  dialog calls, browser clipboard/audio preview APIs, persistence sync, and JSX
  assembly stay in Composer. The next safe source boundary is local initial
  entry sync: `appliedInitialTargetRef`, `initialTargetKey`, and the effect that
  applies `initialEntry`/`initialVersion` to local service/provider/version/mode/
  duration/aspect/image-size state. Focused FlashBoard tests passed with 5
  files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-INITIAL-ENTRY-SYNC-HOOK-SPLIT-130` to extract only
  initial-entry-to-local-state synchronization into
  `useFlashBoardInitialEntrySync.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-INITIAL-ENTRY-SYNC-HOOK-SPLIT-130`; extracted local
  initial-entry target dedupe and `initialEntry`/`initialVersion` to local
  service/provider/version/mode/duration/aspect/image-size synchronization into
  `useFlashBoardInitialEntrySync.ts`. Composer keeps model catalog derivation,
  provider transition, generation submit, chat, prompt-refine, ElevenLabs
  loading, Lemonade health, persistence sync, stores, CSS, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Current
  snapshots: `FlashBoardComposer.tsx` 1955 LOC and
  `useFlashBoardInitialEntrySync.ts` 98 LOC. The hook dependency scan stayed
  free of stores/hooks, services, CSS, Media Board, Timeline,
  render/export/preview, and media runtime. Focused FlashBoard tests,
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check reported only existing
  LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-131` to rescan
  whether any remaining Composer code can split without wrapping controller
  service lifetimes, submit, stores, schema, Media Board, Timeline, render,
  export, preview, or media runtime.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-131`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after initial-entry sync.
  Composer remains at 1955 LOC. Store/settings/account selectors,
  model/category state, ElevenLabs loading effects, Lemonade health effect,
  chat service lifetime, prompt-refine service lifetime, generation submit,
  dialog calls, browser clipboard/audio preview APIs, persistence sync, and JSX
  assembly stay in Composer. The next safe source boundary is pure reference
  media helper logic: referenceable media type classification, reference id
  dedupe/limit clamping, and reference id append/dedupe. Focused FlashBoard
  tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-REFERENCE-MEDIA-PLANNER-SPLIT-132` to extract only pure
  reference media helper logic into `FlashBoardReferenceMediaPlanner.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-MEDIA-PLANNER-SPLIT-132`; extracted pure
  referenceable media type classification, reference id dedupe/limit clamping,
  and reference id append/dedupe into `FlashBoardReferenceMediaPlanner.ts`.
  Composer keeps store/settings/account selectors, model/category state,
  ElevenLabs loading effects, Lemonade health effect, chat service lifetime,
  prompt-refine service lifetime, generation submit, dialog calls, browser
  clipboard/audio preview APIs, persistence sync, JSX assembly, existing
  reference hook/component contracts, provider transition, sync modules, stores,
  CSS, project schema, Media Board, Timeline, render, export, preview, and
  media runtime. Current snapshots: `FlashBoardComposer.tsx` 1806 LOC and
  `FlashBoardReferenceMediaPlanner.ts` 37 LOC. The planner dependency scan
  stayed free of stores/hooks, services, browser APIs, CSS, Media Board,
  Timeline, render/export/preview, and media runtime. Focused FlashBoard tests
  passed with 5 files and 16 tests; `npx tsc -b --pretty false`,
  `git diff --check`, and `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check
  reported only existing LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-133` to rescan
  the remaining Composer clusters and choose the next coherent boundary before
  any further source refactor.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-133`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after the reference-media
  planner split. Current snapshots: `FlashBoardComposer.tsx` 1806 LOC,
  `FlashBoardControls.css` 895 LOC, `FlashBoardPopovers.css` 633 LOC, and all
  adjacent FlashBoard TS/TSX role modules are below 300 LOC except the accepted
  `FlashBoardModelOptionsPlanner.ts` at 288 LOC. JSX assembly from line 1624 is
  still broad enough that a view extraction would mostly become a prop funnel.
  The next coherent source boundary is the local ElevenLabs controller:
  model/voice list loading, hosted/local ElevenLabs service selection, voice
  search/refresh state, voice preview audio, voice selection, output format, and
  voice settings setters. It can move to a hook without touching stores,
  project schema, Media Board, Timeline, render, export, preview, or media
  runtime. Focused FlashBoard tests passed with 5 files and 16 tests.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-CONTROLLER-HOOK-SPLIT-134` to extract only
  the local ElevenLabs controller into `useFlashBoardElevenLabsController.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-CONTROLLER-HOOK-SPLIT-134`; extracted local
  ElevenLabs model/voice loading, hosted/local service selection, voice search
  and refresh state, voice preview audio, voice selection, output format,
  language override/code, and voice settings callbacks into
  `useFlashBoardElevenLabsController.ts`. Composer injects settings/account
  inputs and shared `version`/`setVersion`, and still owns provider/model
  selection, composer sync, generation request/submit, chat, prompt-refine,
  Suno, stores, CSS, project schema, Media Board, Timeline, render, export,
  preview, and media runtime. Current snapshots: `FlashBoardComposer.tsx` 1647
  LOC and `useFlashBoardElevenLabsController.ts` 274 LOC. Composer no longer
  directly imports `elevenLabsService`, `cloudAiService`, or creates preview
  audio; the hook dependency scan stayed free of stores, submit/chat/refine,
  clipboard, CSS, Media Board, Timeline, render/export/preview, and media
  runtime. Focused FlashBoard tests passed with 5 files and 16 tests;
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check reported only existing
  LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-135` to rescan
  the remaining Composer clusters and choose the next coherent boundary before
  any further source refactor.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-135`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after the ElevenLabs
  controller hook split. Current snapshots: `FlashBoardComposer.tsx` 1647 LOC,
  `useFlashBoardElevenLabsController.ts` 274 LOC, `FlashBoardControls.css` 895
  LOC, and `FlashBoardPopovers.css` 633 LOC. Chat state and lifetime are now
  the next coherent source boundary: `sendFlashBoardChatMessage`,
  `checkLemonadeHealth`, `chatAbortRef`, copied-message timeout cleanup,
  provider/model/reasoning fallback, chat send/open/abort/error handling,
  history clear, input change/clear/key handling, and assistant-response
  clipboard copy are one local controller. Prompt-refine is similarly
  side-effectful but remains more tightly coupled to Suno/prompt field state;
  provider transition, composer sync, generation request/submit, validation
  warnings, and JSX assembly stay in Composer for now. Focused FlashBoard tests
  passed with 5 files and 16 tests; `git diff --check` and
  `fc.exe /b AGENTS.md CLAUDE.md` passed with only existing LF-to-CRLF
  warnings from diff-check.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLLER-HOOK-SPLIT-136` to extract only the
  local chat controller into `useFlashBoardChatController.ts`.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLLER-HOOK-SPLIT-136`; extracted local chat
  panel state, prompt, provider/model/temperature/reasoning state, message
  history, copied-message state, error/is-chatting state, Lemonade health/model
  state, chat options, send/open/abort/error handling, clear-history,
  input-change/clear/key handling, assistant-response clipboard copy, and chat
  cleanup into `useFlashBoardChatController.ts`. Composer injects API keys,
  account/settings capability flags, dialog callbacks, `closePopover`, and
  hosted-provider policy, and still owns prompt-refine, generation submit,
  provider switching, composer sync, Suno, validation warnings, stores, CSS,
  project schema, Media Board, Timeline, render, export, preview, and media
  runtime. Current snapshots: `FlashBoardComposer.tsx` 1427 LOC and
  `useFlashBoardChatController.ts` 337 LOC. Composer no longer directly owns
  `sendFlashBoardChatMessage`, `checkLemonadeHealth`, chat abort refs,
  copied-message timeout refs, or `navigator.clipboard`; the hook dependency
  scan stayed free of stores, generation submit, prompt-refine, ElevenLabs/
  cloud services, CSS, Media Board, Timeline, render/export/preview, and media
  runtime. Focused FlashBoard tests passed with 5 files and 16 tests;
  `npx tsc -b --pretty false`, `git diff --check`, and
  `fc.exe /b AGENTS.md CLAUDE.md` passed; diff-check reported only existing
  LF-to-CRLF working-copy warnings.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-137` to rescan
  the remaining Composer clusters and choose the next coherent boundary before
  any further source refactor.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-137`; re-scanned
  remaining `FlashBoardComposer.tsx` responsibilities after the chat controller
  hook split. Current snapshots: `FlashBoardComposer.tsx` 1427 LOC,
  `useFlashBoardChatController.ts` 337 LOC, and
  `useFlashBoardElevenLabsController.ts` 274 LOC. Prompt-refine is the next
  coherent source boundary: hosted/BYO prompt-refine service calls,
  `promptRefineAbortRef`, streaming delta application, undo/error restore,
  prompt-refine error/refining state, and before-rewrite snapshots form one
  local controller. It is coupled to Suno/prompt fields, but those can be
  injected as state and setter inputs without touching stores, services,
  project schema, Media Board, Timeline, render, export, preview, or media
  runtime. Provider transition, composer sync, generation request/submit,
  Suno tuning reset, validation warnings, and JSX assembly stay in Composer.
  Focused FlashBoard tests passed with 5 files and 16 tests; `git diff
  --check` and `fc.exe /b AGENTS.md CLAUDE.md` passed with only existing
  LF-to-CRLF warnings from diff-check.
- Completed bounded packet:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-CONTROLLER-HOOK-SPLIT-138`; extracted
  the local prompt-refine controller into
  `useFlashBoardPromptRefineController.ts`. Composer now injects prompt/Suno
  values and setters, selected model inputs, reference badge/media lookup, Cloud
  capability/dialog callbacks, and popover close behavior, while the hook owns
  prompt-refine error/refining state, before-rewrite snapshots, abort cleanup,
  hosted/BYO service execution, streaming delta/final/error application, and
  undo restore. Current snapshots: `FlashBoardComposer.tsx` 1298 LOC and
  `useFlashBoardPromptRefineController.ts` 362 LOC. Composer no longer imports
  `FlashBoardPromptRefiner` services or `FlashBoardPromptRefinePlanner`
  builders/types. The hook dependency scan stayed free of stores, chat submit,
  ElevenLabs/cloud services, clipboard, CSS, Media Board, Timeline,
  render/export/preview, and media runtime. Focused FlashBoard tests passed with
  5 files and 16 tests; `npx tsc -b --pretty false` and
  `fc.exe /b AGENTS.md CLAUDE.md` passed.
- Next eligible packet: execute
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-139` as a
  read-only scan of remaining Composer responsibilities before selecting another
  source split.
- Product source refactors remain blocked outside approved packet write sets.

## Document Map

- [x] `docs/ongoing/Complete-refactor.md`: orchestrator index, success rules,
      read order, and current execution state.
- [x] `docs/ongoing/Complete-refactor-checklist.md`: progress dashboard and
      user-visible gate state.
- [x] `docs/ongoing/complete-refactor/p0-baseline-and-guard-rails.md`: P0
      baselines, executable scans, and smoke thresholds.
- [x] `docs/ongoing/complete-refactor/p1-foundation-contracts.md`: P1, P1A,
      and P1B foundation contracts.
- [x] `docs/ongoing/complete-refactor/p2-p3-state-and-project-persistence.md`:
      store/runtime and project persistence phases.
- [x] `docs/ongoing/complete-refactor/p4-media-panel-and-flashboard.md`: Media
      Panel and FlashBoard phase.
- [x] `docs/ongoing/complete-refactor/p5-preview-export-common-ui.md`: Preview,
      export, and common UI phase.
- [x] `docs/ongoing/complete-refactor/p6-render-audio-codecs-proxy-cache.md`:
      render, audio, codecs, proxy, and cache hot paths.
- [x] `docs/ongoing/complete-refactor/p7-ai-tools-dev-bridge-smokes.md`: AI
      tools, dev bridge, guided actions, and smoke quarantine.
- [x] `docs/ongoing/complete-refactor/p8-tests-and-architecture-gates.md`: test
      migration and architecture gates.
- [x] `docs/ongoing/complete-refactor/execution-queue-and-lanes.md`: dependency
      order, high-conflict ownership, packet queue, lane records, and execution
      readiness.
- [x] `docs/ongoing/complete-refactor/execution-history-2026-06-09.md`:
      archived completed packet specs, reports, and check details for historical
      lookup only.

## How To Read Gates

Each phase gate is reviewable only when it has:

- [ ] gate id
- [ ] subchecks
- [ ] allowed write set
- [ ] forbidden files
- [ ] do-not rules
- [ ] focused checks or smoke commands
- [ ] exit criteria

A checked phase definition means the plan names the target. It does not mean
source implementation is complete. A gate is implementation-ready only when all
items above are explicit.

## Timeline Reuse Decision

- [x] Treat the completed timeline refactor as the method template.
- [x] Reuse the shapes for gate registry, lane write manifest, high-conflict
      ownership, retired-path ledger, adapter-debt ledger, test-migration
      ledger, exit-criteria coverage, and architecture-registry tests.
- [x] Protect timeline source from broad re-refactor work.
- [x] Define the future whole-codebase registry from the timeline method without
      copying timeline-specific ids.
- [ ] Define explicit integration packets before touching timeline source for
      project hydration, runtime leases, signals, or render/export snapshots.

## Plan Document

- [x] Define success criteria for maintainability, performance, and no god
      objects.
- [x] Define role-based LOC budgets with 700 LOC as product-source ceiling.
- [x] Define valid versus invalid splits.
- [x] Define dead-code and retired-path deletion policy.
- [x] Define master orchestrator execution model.
- [x] Define worker-agent packet format.
- [x] Define parallel-agent use for planning, implementation, verification, and
      cleanup waves.
- [x] Add actual codebase refactor phases based on current source scans.
- [x] Keep planning artifacts minimal: index + checklist + bounded phase files.
- [x] Split oversized phase details into bounded files while keeping
      `Complete-refactor.md` as the canonical index.
- [x] Prepare current handoff and handoff-history templates for execution.
- [x] Run 2 Codex and 2 Claude read-only plan-vs-codebase reviews.
- [x] Add agent review corrections to the actual plan.
- [x] Tighten phase gates into reviewable gate/subcheck blocks.
- [x] Add phase-level allowed write sets, forbidden files, and do-not rules.
- [x] Add max-6 parallel execution wave plan with sequenced shared hubs.
- [x] Add progress/commit/check cadence: coherent checkpoint commits, focused
      packet checks, full build/lint/test only when AGENTS.md requires it.
- [ ] Convert all gate/subcheck blocks into exact test/static-check names.
- [x] Convert P0/P1 gates into exact static-check ids and command names.
- [ ] Add packet-level high-conflict write sets for all phases.
- [x] Add P0/P1 packet-level high-conflict ownership and forbidden sets.
- [x] Queue first source/tooling packets with write sets, checks, and stop
      conditions.
- [x] Add first implementation packets after skeptical review.

## Progress And Check Cadence

- [x] Preserve progress in coherent packets, not random file-edit commits.
- [x] Prefer focused gates, targeted tests, static scans, and smokes during
      implementation.
- [x] Do not run full `npm run build`, `npm run lint`, and `npm run test` after
      every small edit.
- [x] Run the full chain for normal commit, push, release, merge, or explicit
      final readiness as required by `AGENTS.md`.
- [x] Use `fast commit`/`fast push` rules only when the user explicitly requests
      that command mode.
- [x] Add packet-level checkpoint policy to the first implementation packet.

## Reviewable Gate Matrix

This matrix is the user-visible "what not to do yet" control surface. Source
implementation must not start for a phase until its relevant gate block is
complete enough for the packet.

### P0 - Baseline And Guard Rails

Allowed write set:

- `docs/ongoing/**`
- future architecture-registry preflight only after approval
- read-only scan outputs if the orchestrator creates them

Forbidden files:

- `src/components/**`
- `src/stores/**`
- `src/engine/**`
- `src/services/**` except read-only scans
- `src/timeline/architecture/**` unless explicitly reviewing the method

Gates and subchecks:

- [ ] `P0_BASELINE_CAPTURED`
  - [x] LOC/domain/file-size commands recorded
  - [x] fan-in/fan-out commands recorded
  - [x] `getState()` scan recorded
  - [x] runtime-handle scan recorded
  - [x] CSS/global selector scan recorded
  - [x] smoke inventory recorded
- [x] `P0_BASELINE_REFRESHED`
  - [x] all static scan numbers regenerated from current HEAD/worktree
  - [x] stale planning numbers are not enforced
- [x] `P0_COMPLETE_ARCHITECTURE_REGISTRY`
  - [x] lane ids listed
  - [x] gate ids listed
  - [x] P0/P1 write sets listed
  - [x] P0/P1 forbidden sets listed
  - [x] exit criteria listed
  - [x] retired-path and test-migration ledgers planned
  - [x] executable check command planned
- [ ] `P0_RENDER_PLAYBACK_BASELINE`
  - [x] 1, 4, and 16 visible clip scenarios defined
  - [x] FPS/frame-delta/render-timing thresholds defined
- [ ] `P0_EXPORT_BASELINE`
  - [x] `debugExport` fast/precise scenarios defined
  - [x] audio on/off and 640x360/1080p thresholds defined
- [ ] `P0_PROXY_CACHE_PRESSURE`
  - [x] VideoFrame, decoder, object URL, and runtime-release thresholds defined
- [ ] `P0_AUDIO_CONTEXT_BASELINE`
  - [x] live playback, scrub, record, and export owners listed
- [ ] `P0_PREVIEW_TARGET_LIFECYCLE`
  - [x] Preview/source/output mount-unmount checks defined
- [ ] `P0_CSS_GLOBAL_SELECTOR_GATE`
  - [x] global selector, z-index, fixed overlay, pointer-event, retired-class
        scans defined

Do not:

- [ ] Do not start source implementation before relevant gates have subchecks.
- [ ] Do not enforce stale LOC numbers.
- [ ] Do not edit the existing timeline architecture registry while defining
      the whole-codebase registry pattern.

### P1 - Foundation Contracts

Allowed write set:

- `src/types/**`
- domain contract entry points created for type tiers
- focused import-boundary tests

Forbidden files:

- `src/components/**`
- `src/engine/**`
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- domain UI and render implementation files

Gates and subchecks:

- [x] `P1_TYPE_TIER_DEFINED`
  - [x] pure schema tier defined
  - [x] durable store tier defined
  - [x] runtime store/lease tier defined
  - [x] render/runtime tier defined
- [ ] `P1_GLOBAL_TYPES_BARREL_THIN`
  - [x] `src/types/index.ts` compatibility plan defined
  - [x] retirement order defined
  - [x] current broad type-barrel fan-in frozen by
        `tests/unit/foundationTypeBoundary.test.ts`
  - [ ] broad barrel still needs shrink/retirement below the target budget
- [ ] `P1_TYPE_TIER_NO_RUNTIME_IMPORTS`
  - [x] scan forbids DOM/GPU/File/Blob/VideoFrame/runtime services in pure tiers
  - [x] current runtime-handle hits classified as compatibility or
        render-runtime debt
- [x] `P1_PROJECT_SCHEMA_NO_STORE_IMPORTS`
  - [x] previous project type imports from stores/components/engine were
        classified
  - [x] project type imports from stores/components/engine/runtime services are
        now zero
- [ ] `P1_STORE_PUBLIC_FACADES_DEFINED`
  - [ ] durable state, actions, selectors, command/planner API separated
- [x] `P1_PROJECT_SCHEMA_OWNS_PERSISTED_TYPES`
  - [x] schema DTOs do not reuse live store internals
  - [x] store/engine-shaped FlashBoard, export, generated media item, sequence,
        and gaussian settings DTOs are schema-owned under
        `src/services/project/types/**`
- [ ] `P1_RUNTIME_HANDLES_FORBIDDEN_IN_SHARED_SCHEMA`
  - [x] runtime-handle scan covers shared schema and broad type barrels
  - [x] new unclassified runtime-handle hits fail
        `tests/unit/foundationTypeBoundary.test.ts`
  - [x] project schema runtime-handle hits are rejected by
        `tests/unit/projectSchemaBoundary.test.ts`
  - [ ] existing `src/types/index.ts` runtime-handle debt removed by later P1
        barrel retirement
  - [x] project sequence-frame `File` hydration debt removed by
        `P3-HYDRATION-ADAPTER-001`

Do not:

- [ ] Do not move UI/render/export/project behavior in this phase.
- [ ] Do not create another broad type dump.
- [ ] Do not let schema import live store, engine, component, or service types.

### P1A - Clip And Media Source Runtime Split

Allowed write set:

- `src/types/**`
- `src/services/mediaRuntime/**`
- targeted runtime-boundary tests

Forbidden files:

- `src/components/panels/MediaPanel.tsx`
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/components/export/ExportPanel.tsx`

Gates and subchecks:

- [x] `P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT`
  - [x] durable clip/source refs contain ids/metadata only
  - [x] runtime lookup uses `RuntimeSourceId`
- [x] `P1A_MEDIA_FILE_RUNTIME_SIDETABLE`
  - [x] `File`, object URL, DOM, frame, decoder, and GPU handles have owners
- [x] `P1A_SINGLE_RUNTIME_LEASE_DOMAIN`
  - [x] existing `services/mediaRuntime` registry is canonical
  - [x] no second lease manager introduced
- [x] `P1A_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
  - [x] `structuredClone` guard defined
  - [x] JSON roundtrip guard defined
  - [x] `file`, `url`, `handle`, and runtime object leak cases covered
- [x] `P1A_HMR_SAFE_RUNTIME_OWNER`
  - [x] singleton/HMR survival pattern defined for new runtime owners

Execution state:

- [x] `src/services/mediaRuntime/types.ts` defines `MediaAssetRef`,
      `TimelineSourceRef`, `MediaRuntimeLease`, `RuntimeSourceId`, and
      `RenderFrameSource`.
- [x] `src/services/mediaRuntime/leaseOwnership.ts` maps every runtime handle
      kind to canonical `services/mediaRuntime` ownership and records legacy
      migration sources.
- [x] `src/services/mediaRuntime/persistedStateGuard.ts` rejects live handles
      through `structuredClone`, JSON roundtrip, runtime-field, object URL, and
      runtime-object checks.
- [x] Focused check passed:
      `npm run test -- tests/unit/persistedStateRuntimeHandles.test.ts tests/unit/mediaRuntimeLeaseContracts.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`.
- [ ] Legacy `MediaFile.file` and existing clip runtime fields remain
      compatibility debt for the P2/P3 store-project freeze; they were not
      removed in P1A.

Do not:

- [ ] Do not remove `MediaFile.file` before side-table migration exists.
- [ ] Do not add lease logic outside `services/mediaRuntime`.
- [ ] Do not touch MediaPanel/project/render/export to close this phase.

### P1B - Universal Signal Foundation

Allowed write set:

- `src/signals/**`
- `src/importers/**`
- signal/project DTO tests
- format-matrix docs

Forbidden files:

- `src/components/panels/MediaPanel.tsx`
- `src/services/project/projectLoad.ts`
- `src/engine/render/RenderDispatcher.ts`
- `src/components/export/ExportPanel.tsx`

Gates and subchecks:

- [x] `P1B_SIGNAL_DTO_RUNTIME_FREE`
  - [x] `src/signals/**` has no File/Blob/DOM/GPU/decoder/runtime handles
  - [x] project signal DTOs remain JSON-safe
- [x] `P1B_UNIVERSAL_IMPORT_ROUTE_MATRIX`
  - [x] OBJ/FBX/glTF/GLB route listed
  - [x] PDF/SVG route listed
  - [x] DXF/STEP route listed
  - [x] JSON/CSV route listed
  - [x] binary/unknown route listed
  - [x] point-cloud route listed
- [x] `P1B_NO_UNSUPPORTED_FILE_FALLBACK`
  - [x] unknown files become `SignalAsset` fallback
  - [x] fallback is not treated as final renderer support
- [x] `P1B_SIGNAL_PROJECT_ROUNDTRIP`
  - [x] CSV fixture roundtrips
  - [x] binary/unknown fixture roundtrips
- [x] `P1B_SIGNAL_TIMELINE_MATERIALIZATION_CONTRACT`
  - [x] timeline placement behavior defined for signal refs
- [x] `P1B_SIGNAL_PREVIEW_EXPORT_FALLBACK`
  - [x] preview/export fallback surface defined per format family

Execution state:

- [x] `src/signals/formatMatrix.ts` defines the June-2026 format matrix for
      3D, PDF/SVG, CAD, JSON/CSV, binary/unknown, and point-cloud families.
- [x] `tests/unit/signals/signalFormatMatrix.test.ts` verifies runtime-free
      signal files, format coverage, fallback policy, and project-shaped signal
      DTO roundtrip.
- [x] Existing importer and renderer adapter fixtures stayed green:
      `tests/unit/importers/universalImportOrchestrator.test.ts`,
      `tests/unit/signals/signalTimelineRendererAdapter.test.ts`, and
      `tests/unit/signals/signalTextRendererAdapter.test.ts`.
- [x] Focused check passed:
      `npm run test -- tests/unit/signals/signalContracts.test.ts tests/unit/signals/signalFormatMatrix.test.ts tests/unit/importers/universalImportOrchestrator.test.ts tests/unit/signals/signalTimelineRendererAdapter.test.ts tests/unit/signals/signalTextRendererAdapter.test.ts tests/unit/completeArchitectureRegistry.test.ts`.
- [ ] Project load/save integration remains deferred to
      `P1-P3-SCHEMA-FREEZE-001`; P1B only proved the signal DTO contract and
      project-shaped JSON roundtrip.

Do not:

- [ ] Do not solve signals with one-off Media Panel UI branches.
- [ ] Do not put runtime handles in signal DTOs.
- [ ] Do not claim CAD/PDF/SVG/3D support complete with binary summary only.

### P2 - Store And Runtime Ownership

Allowed write set:

- `src/stores/**`
- store selectors/action planners
- store boundary tests
- approved hydration adapters only after P2/P3 contract freeze

Forbidden files:

- `src/services/project/types/**` except approved adapter contract work
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/components/**`
- `src/engine/**`

Gates and subchecks:

- [ ] `P2_DURABLE_STORE_BOUNDARY`
  - [ ] durable state is serializable
  - [ ] runtime leases are referenced by ids only
- [ ] `P2_RUNTIME_LEASE_OWNERS_DEFINED`
  - [ ] lease owner map covers media, audio, render, decoder, worker, GPU
- [ ] `P2_GETSTATE_USAGE_CLASSIFIED`
  - [ ] async fresh reads classified
  - [ ] bridge/adapter reads allowlisted
  - [ ] module-scope/render-path reads flagged
- [ ] `P2_GETSTATE_MODULE_SCOPE_FORBIDDEN`
  - [ ] hard gate forbids new module-scope live reads
- [ ] `P2_HISTORY_AND_DOCK_SPLIT`
  - [ ] history serializers separated
  - [ ] dock migration/layout ownership separated
- [ ] `P2_PROJECT_HYDRATION_NOT_STORE_INTERNALS`
  - [ ] project hydration uses adapters, not store internals
- [ ] `P2_STORE_PROJECT_CONTRACT_FREEZE`
  - [ ] P2 and P3 DTO/hydration contracts accepted together

Do not:

- [ ] Do not reduce `getState()` by count alone.
- [ ] Do not persist runtime leases or live handles in stores.
- [ ] Do not edit project load/save internals from a store packet unless the
      adapter write set is approved.

### P3 - Project Persistence And Current Schema Boundary

Allowed write set:

- `src/services/project/types/**`
- current project schema builders/hydration adapters
- current project persistence tests

Forbidden files:

- `src/stores/**` except approved hydration adapter call sites
- `src/components/**`
- `src/engine/**`
- `src/services/mediaRuntime/**` except approved runtime-restore adapter

Gates and subchecks:

- [x] `P3_PROJECT_SCHEMA_BOUNDARY`
  - [x] schema owns persisted DTOs
  - [x] current-schema project DTO sample roundtrips via
        `tests/unit/projectSchemaBoundary.test.ts`
  - [x] schema is runtime-free after sequence-frame hydration moved behind
        the project load adapter
- [x] `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS`
  - [x] no imports from stores/components/engine/runtime services in schema
        types
  - [x] no broad `src/types` barrel imports in schema types
- [ ] `P3_CURRENT_PROJECT_SCHEMA_ONLY`
  - [ ] current schema is the only required saved-project target
  - [ ] obsolete project versions are not compatibility blockers
- [ ] `P3_LEGACY_PROJECT_COMPAT_RETIRED`
  - [ ] old saved-project payloads are deleted or ignored, not migrated
- [ ] `P3_FLASHBOARD_PERSISTENCE_SPLIT`
  - [ ] active generation metadata separated from retired board/canvas data
- [ ] `P3_DEPRECATED_PAYLOADS_DELETED_OR_IGNORED`
  - [x] obsolete `ProjectFile.youtube` payload is removed from current schema
  - [x] project save deletes stale `youtube` payloads
  - [x] project load resets transient YouTube state instead of hydrating old
        payloads
  - [x] dock `youtube`, `download`, and `ai-video` panel type cleanup is owned
        by a P4/P3 UI-layout packet
  - [x] dock deprecated-panel cleanup gates and retired-path ledger entries are
        executable
  - [ ] retired FlashBoard board/canvas payloads do not shape current schema
- [x] `P3_DOCK_DEPRECATED_PANEL_PAYLOADS_RETIRED`
  - [x] active `PanelType` and `PANEL_CONFIGS` exclude dock `youtube`,
        `download`, and `ai-video`
  - [x] restored dock layouts drop old dock payload ids instead of migrating
        them to active panel types
  - [x] Toolbar and dock add/change menus expose only active panel ids
- [ ] `P3_PROJECT_LOAD_SAVE_NO_DIRECT_LOCALSTORAGE`
  - [ ] UI preferences go through explicit adapter
- [ ] `P3_DOCK_LAYOUT_SINGLE_PERSISTENCE_OWNER`
  - [ ] project and local layout ownership resolved
- [ ] `P3_RUNTIME_HANDLE_ROUNDTRIP_GUARD`
  - [ ] structured clone and JSON roundtrip fail on live handles
  - [x] current project DTO sample passes runtime-handle guard
  - [x] sequence-frame `File` fields are removed from persisted DTOs
- [ ] `P3_PROJECT_LOAD_SAVE_SMOKE`
  - [ ] save/load/autosave/nested restore scenarios defined

Do not:

- [ ] Do not reuse live store internals as schema DTOs.
- [ ] Do not add old-project migration machinery unless the user reintroduces
      that compatibility requirement.
- [x] Do not let the obsolete YouTube project payload shape current schema.
- [ ] Do not let remaining deprecated dock/FlashBoard payload support shape
      current architecture.

### P4 - Media Panel And FlashBoard

Allowed write set:

- `src/components/panels/MediaPanel*`
- `src/components/panels/flashboard/**`
- `src/stores/flashboardStore/**`
- `src/services/flashboard/**`
- Media/FlashBoard smoke tests

Forbidden files:

- `src/services/project/types/**` except approved DTO adapter work
- `src/services/project/projectLoad.ts`
- `src/services/project/projectSave.ts`
- `src/engine/**`
- `src/services/mediaRuntime/**`

Gates and subchecks:

- [ ] `P4_MEDIA_PANEL_SHELL_SPLIT`
  - [x] shell/grid/import/context module tree and source packet are defined
  - [x] search UI, view-mode controls, shared Add item menu, context menu
        shape, and duration formatter are split into role modules
  - [x] grid item, grid breadcrumb, and context menu frame presentation are
        split into role modules
  - [x] classic list row shell, folder indentation chrome, rename input,
        status badges, and metadata cell presentation are split into role
        modules
  - [x] non-board context action sections, move-folder submenu,
        regenerate-artifact submenu, explorer submenu, and selected-item
        action presentation are split into role modules
  - [x] board annotation color context presentation is split into a role module
  - [x] external drop overlay, no-media empty state, and search-empty
        presentation are split into role modules
  - [x] header count, relink prompt, import button, view controls, and Add
        dropdown shell are split into a role module
  - [x] classic list wrapper, column headers, virtual spacers, and marquee
        overlay presentation are split into role modules
  - [x] grid wrapper, breadcrumb placement, grid container, and grid marquee
        overlay presentation are split into a role module
  - [x] floating feedback portal and generation-tray mount shell are split into
        role modules
  - [x] board/selector preflight defines the next Media Board host source
        packet with explicit write set and stop conditions
  - [x] Media Board host prop boundary is split into a role module
  - [x] no-value Media Board host pass-through is deleted after host-boundary
        preflight
  - [x] Media Board annotation data, constants, storage key, load/save, and
        normalization helpers are split into a role module
  - [x] Media Board annotation layer presentation is split into a role module
  - [x] Media Board annotation state/save/reload/update ownership is split
        into a role hook
  - [x] Media Board annotation creation/append/select ownership is split into
        the annotation state hook
  - [x] Media Board annotation visible-rect filtering is split into a pure
        board helper
  - [x] Media Board annotation resize geometry is split into a pure board
        helper
  - [x] Media Board annotation text-focus DOM lookup is split into a board
        helper
  - [x] Media Board annotation drag-position calculation is split into a pure
        board helper
  - [x] Media Board annotation drag/resize controller callbacks are split into
        a role hook
  - [x] Media Board annotation context-menu/focus/edit command callbacks are
        split into a role hook
  - [x] Media Board annotation context-menu mount is split into a context role
        module
  - [ ] shell below budget
  - [ ] folders/board/downloads/generation/import status split
- [ ] `P4_MEDIA_STORE_SELECTOR_CONTRACT`
  - [ ] Media Panel reads through selectors/adapters
- [ ] `P4_FLASHBOARD_ACTIVE_CONTRACT`
  - [ ] request -> queue/job -> provider task -> media import contract defined
- [ ] `P4_FLASHBOARD_PROVIDER_TASK_CONTRACT`
  - [ ] provider runner isolated from UI and direct store internals
- [x] `P4_FLASHBOARD_RETIRED_BOARD_LEDGER`
  - [x] retired FlashBoard board/canvas gate and ledger entry are executable
  - [x] top-level FlashBoard store fields classify active composer/reference
        hover state separately from retired board workspace state
  - [x] old board/canvas/node usages scanned before deletion
- [x] `P4_MEDIA_BOARD_VS_FLASHBOARD_BOARD_CLASSIFIED`
  - [x] active Media Board versus retired FlashBoard Board gate is executable
  - [x] active Media Board and retired FlashBoard Board separated in source
- [ ] `P4_MEDIA_BOARD_RENDER_STRATEGY`
  - [ ] DOM/React owns controls, forms, menus, accessibility, and low-frequency UI
  - [ ] canvas renderer owns dense board visuals, minimap, selection/marquee,
        thumbnails, connections, and zoom/pan feedback
  - [ ] `OffscreenCanvas`/worker path is used only if board performance
        baseline proves main-thread rendering is the bottleneck
  - [ ] main-thread canvas or DOM fallback remains defined
- [ ] `P4_MEDIA_BOARD_PROJECT_ROUNDTRIP`
  - [ ] board layout/prefs roundtrip defined
- [ ] `P4_MEDIA_GENERATION_PROJECT_ROUNDTRIP`
  - [ ] generation metadata save/load test defined
- [x] `P4_DOWNLOADS_ACTIVE_IN_MEDIA_PANEL`
  - [x] cleanup packet requires active Media download/search workflow coverage
  - [x] deprecated download panel behavior mapped to Media Panel source

Do not:

- [ ] Do not merge active Media Board with retired FlashBoard board/canvas.
- [ ] Do not move Composer/forms/provider settings/chat controls to canvas.
- [ ] Do not require `OffscreenCanvas` as the only board render path.
- [ ] Do not delete FlashBoard CSS/classes without usage scan and ledger.
- [ ] Do not let FlashBoard services reach directly into stores.
- [ ] Do not change project schema from this phase without the P3 adapter packet.

### P5 - Preview, Export, And Common UI

Allowed write set:

- `src/components/preview/**`
- `src/components/export/**`
- overlay modules and common UI/CSS split targets
- preview/export smoke and unit tests

Forbidden files:

- `src/engine/render/RenderDispatcher.ts` unless Phase 5/6 joint packet owns it
- `src/engine/WebGPUEngine.ts` unless Phase 5/6 joint packet owns it
- render-target store files unless Phase 5/6 joint packet owns them
- `src/services/project/**`

Gates and subchecks:

- [ ] `P5_PREVIEW_RUNTIME_BOUNDARY`
  - [ ] Preview shell separated from render target lifecycle owner
- [ ] `P5_RENDER_TARGET_SNAPSHOT_CONTRACT`
  - [ ] render target snapshot input defined before implementation
- [ ] `P5_PREVIEW_OVERLAY_REGISTRY`
  - [ ] overlays registered through focused contracts
- [ ] `P5_EXPORT_PANEL_RUNNER_BOUNDARY`
  - [ ] UI settings separated from runner adapters
- [ ] `P5_EXPORT_RENDER_SESSION_CONTRACT`
  - [ ] export session transaction and cancellation contract defined
- [ ] `P5_BOUNDED_MEMORY_EXPORT`
  - [ ] bounded or streaming frame delivery requirement covered
- [ ] `P5_EXPORT_SMOKE_PRESERVED`
  - [ ] debugExport scenarios remain available
- [ ] `P5_COMMON_CSS_BUDGET`
  - [ ] CSS split targets under role budgets
- [ ] `P5_CSS_GLOBAL_SELECTOR_AND_ZINDEX_GATE`
  - [ ] z-index/global/fixed/pointer-event scans defined

Do not:

- [ ] Do not touch engine export state/render-target store without P5/P6 joint
      ownership.
- [ ] Do not delete CSS without usage scan and retired-class entry.
- [ ] Do not split overlays by visual order only.

### P6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

Allowed write set:

- `src/engine/**`
- `src/services/proxyFrameCache.ts` and proxy/cache modules
- `src/services/audio/**`
- `src/services/mediaRuntime/**` only for approved lease integration
- hot-path tests and smokes

Forbidden files:

- `src/components/**` except approved smoke harnesses
- `src/services/project/**`
- `src/stores/**` except approved snapshot adapter files

Gates and subchecks:

- [ ] `P6_RENDER_FRAME_SNAPSHOT`
  - [ ] per-frame snapshot contract avoids live store reads
- [ ] `P6_RENDER_OUTPUT_ROUTER`
  - [ ] output target routing owner defined
- [ ] `P6_RENDER_DISPATCHER_OWNERSHIP_SPLIT`
  - [ ] collection/composition/output/diagnostics split plan defined
- [ ] `P6_WEBCODECS_LIFECYCLE_SPLIT`
  - [ ] source open/close/seek/decode scheduling owners defined
- [ ] `P6_VIDEOFRAME_LEASE_CONTRACT`
  - [ ] borrow/clone/close accounting defined
- [ ] `P6_PROXY_CACHE_OWNER_DEFINED`
  - [ ] cache key, storage, extraction, eviction owners defined
- [ ] `P6_PROXY_CACHE_CLOSE_REVOKE_ACCOUNTING`
  - [ ] VideoFrame close and object URL revoke counters defined
- [ ] `P6_PROXY_DECODER_COALESCING`
  - [ ] per-frame decoder churn reduction target defined
- [ ] `P6_THUMBNAIL_PROXY_BOUNDARY`
  - [ ] thumbnail rendering separated from proxy cache ownership
- [ ] `P6_AUDIO_CONTEXT_OWNERSHIP_MAP`
  - [ ] playback, scrub, recording, export, diagnostics owners listed
- [ ] `P6_AUDIO_RECORDING_AND_ROUTE_BOUNDARY`
  - [ ] recording/worklet/routing boundaries defined
- [ ] `P6_SCRUB_AUDIOCONTEXT_DISPOSED`
  - [ ] scrub context disposal check defined
- [ ] `P6_EXPORT_AUDIO_SYNC_GUARD`
  - [ ] frame/audio sync smoke defined

Do not:

- [ ] Do not start hot-path splits before Phase 0 smokes have thresholds.
- [ ] Do not close/transfer frames, URLs, GPU, or audio resources without
      accounting.
- [ ] Do not keep live store reads in render work after snapshot contracts.

### P7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

Allowed write set:

- `src/services/aiTools/**`
- smoke handler modules
- bridge policy/transport tests

Forbidden files:

- product UI/components except explicit smoke fixtures
- project schema/load/save except approved debug adapter
- engine/render hot paths except approved smoke read-only probes

Gates and subchecks:

- [ ] `P7_AI_TOOL_EXECUTION_FACADE`
  - [ ] execution facade separated from handler registry and policy
- [ ] `P7_DEV_BRIDGE_QUARANTINED`
  - [ ] dev bridge transport separated from product behavior
- [ ] `P7_SMOKE_HANDLERS_SPLIT`
  - [ ] fixture setup, user actions, canvas assertions, reporting split
- [ ] `P7_PHASE0_SMOKES_STABLE`
  - [ ] Phase 0 smoke commands survive bridge cleanup
- [ ] `P7_GUIDED_ACTION_BOUNDARY`
  - [ ] guided replay/compiler/runtime contracts separated
- [ ] `P7_POLICY_REGISTRY_STABLE`
  - [ ] caller policy/permissions tests defined

Do not:

- [ ] Do not delete verifier coverage before replacement gates exist.
- [ ] Do not let bridge transport define product contracts.
- [ ] Do not broaden product internals for a bridge handler.

### P8 - Test Suite Refactor And Architecture Gates

Allowed write set:

- `tests/**`
- architecture gate tests
- test fixtures
- package scripts for focused gates

Forbidden files:

- product source files unless a test packet has an approved paired fix
- generated/vendor files

Gates and subchecks:

- [ ] `P8_ARCHITECTURE_GATE_SUITE`
  - [ ] LOC budget gate executable
  - [ ] import boundary gate executable
  - [ ] runtime-free schema gate executable
  - [ ] retired-path gate executable
  - [ ] smoke coverage gate executable
- [ ] `P8_TEST_MIGRATION_LEDGER`
  - [ ] large tests classified as port/split/replace/keep/delete
- [ ] `P8_NO_OBSOLETE_GODOBJECT_TESTS`
  - [ ] tests assert public contracts, not old internal file shape
- [ ] `P8_FULL_CHAIN_READY_FOR_NORMAL_COMMIT`
  - [ ] build/lint/test required only for normal commit/merge/readiness

Do not:

- [ ] Do not delete tests only to satisfy LOC budgets.
- [ ] Do not mark gates closed without executable checks or accepted exception.
- [ ] Do not keep tests that force obsolete god-object internals.

## Baseline Captured

- [x] Capture top-level domain LOC totals.
- [x] Capture major subdomain LOC totals.
- [x] Capture largest product files over 2,000 LOC.
- [x] Capture import fan-in/fan-out hubs.
- [x] Capture broad `index.ts` barrel candidates.
- [x] Capture `getState()` hotspots.
- [x] Capture runtime-handle hotspots.
- [x] Capture largest CSS files.
- [x] Capture deprecated panel and retired-path signals.
- [x] Capture largest tests.
- [x] Keep baseline data inside the plan/phase files unless it becomes too
      large.
- [x] Add reproducible baseline commands to the plan/phase files.
- [x] Define performance-smoke baseline matrix.
- [x] Refresh all static baseline counts before turning any number into a gate.
      Runtime performance gates remain open until their browser/AI-bridge
      smokes run.

## Phase 0 - Baseline And Guard Rails

- [x] Define Phase 0 goal.
- [x] Define baseline categories.
- [x] Define `P0_BASELINE_CAPTURED` gate.
- [x] Add Phase 0 smoke gate names for render/playback/export/proxy/audio/
      preview/CSS.
- [x] Define 6 read-only worker packets for first baseline wave.
- [x] Add `P0_COMPLETE_ARCHITECTURE_REGISTRY` preflight gate.
- [x] Complete baseline section inside the P0 phase file.
- [x] Create first architecture/static gate list.
- [x] Add whole-codebase registry files under `src/architecture/**`.
- [x] Add `tests/unit/completeArchitectureRegistry.test.ts`.
- [x] Run focused registry checks:
      `npm run test -- tests/unit/completeArchitectureRegistry.test.ts tests/unit/timelineArchitectureRegistry.test.ts`.
- [x] Define thresholds for `P0_RENDER_PLAYBACK_BASELINE`.
- [x] Define thresholds for `P0_EXPORT_BASELINE`.
- [x] Define thresholds for `P0_PROXY_CACHE_PRESSURE`.
- [x] Define thresholds for `P0_AUDIO_CONTEXT_BASELINE`.
- [x] Define thresholds for `P0_PREVIEW_TARGET_LIFECYCLE`.
- [x] Define exact scan for `P0_CSS_GLOBAL_SELECTOR_GATE`.
- [x] Run `P0-BASELINE-REFRESH-001` static scans and update the P0 phase file
      with current LOC, large-file, fan-in/barrel, `getState()`,
      runtime-handle, CSS/global-selector, retired payload, project
      persistence, and smoke-inventory summaries.
- [x] Keep render/playback/export/proxy/audio/preview runtime smoke gates open
      until those smokes run against the browser/dev bridge.

## Phase 1 - Foundation Contracts

- [x] Identify `src/types/index.ts` as highest fan-in hub.
- [x] Identify timeline/media store public facades as shared hubs.
- [x] Identify project schema importing live store types as a boundary risk.
- [x] Define target type tiers.
- [x] Define foundation gates.
- [x] Add project schema no-store-imports gate.
- [x] Add type-tier no-runtime-imports gate.
- [x] Define exact module targets for type-tier split.
- [x] Define compatibility-retirement order for `src/types/index.ts`.
- [x] Define import-boundary tests.
- [x] Define pure schema, durable store, runtime store, and render runtime type
      tiers.
- [x] Add `src/architecture/foundationTypeTiers.ts` with focused type tiers,
      baseline fan-in limits, runtime-handle classifications, and
      project-schema import handoff classifications.
- [x] Add `tests/unit/foundationTypeBoundary.test.ts` to freeze broad type
      barrel fan-in and classify current runtime/schema debt.

## Phase 1A - Clip And Media Source Runtime Split

- [x] Add Phase 1A to the plan.
- [x] Define `services/mediaRuntime` as canonical runtime lease domain.
- [x] Define runtime-handle roundtrip guard requirement.
- [x] Define HMR-safe runtime owner requirement.
- [ ] Define `MediaAssetRef`, `TimelineSourceRef`, `MediaRuntimeLease`, and
      `RuntimeSourceId` target contracts.
- [ ] Map migration sources: `blobUrlManager`, `sourceRuntimeSanitizer`,
      `webCodecsHelpers`, proxy/cache handles, project hydration handles, and
      media object URL managers.
- [x] Define static runtime-handle scan for shared durable types.
- [x] Define `structuredClone` and JSON roundtrip persisted-state test.

## Phase 1B - Universal Signal Foundation

- [x] Add Phase 1B to the plan.
- [x] Identify `src/signals/**` and `src/importers/**` as June-2026 foundation
      lanes.
- [x] Define Universal Signal gate names.
- [x] Add format matrix requirement for 3D, documents, CAD, data, binary, and
      point-cloud families.
- [x] Define exact DTO/runtime-free scan for `src/signals/**`.
- [ ] Define format matrix owners and checks.
- [ ] Define timeline materialization contract for signal refs.
- [ ] Define preview/export fallback contract for signal refs.
- [ ] Define CSV, binary, unknown-file, and at least one non-media fixture.

## Phase 2 - Store And Runtime Ownership

- [x] Identify `getState()` hotspots.
- [x] Define durable store versus runtime lease target.
- [x] Define dock/history/mediaStore/timeline targets.
- [x] Define store/runtime gates.
- [x] Replace blind `getState()` reduction with usage classification.
- [x] Add combined store/project contract-freeze requirement.
- [ ] Define allowed `getState()` adapter list.
- [ ] Define runtime lease owner map.
- [ ] Define store selector/action planner file targets.
- [ ] Define history serializer guard for runtime-handle leaks.
- [ ] Define dock layout localStorage versus project persistence ownership.

## Phase 3 - Project Persistence And Current Schema Boundary

- [x] Identify `projectLoad`, `projectSave`, and `ProjectFileService` as
      persistence god objects.
- [x] Identify deprecated `youtube`, `download`, and `ai-video` retired payload
      surfaces.
- [x] Define project schema/importer/hydration target.
- [x] Define project persistence gates.
- [x] Replace versioned migration-registry requirement with current-schema-only
      project compatibility policy.
- [x] Add project UI preferences/localStorage adapter gate.
- [x] Add persisted-state runtime roundtrip guard.
- [x] Define exact saved-project compatibility policy: old saved projects may
      break.
- [ ] Define FlashBoard project-schema split.
- [x] Define and execute YouTube project payload deletion-or-ignore checks.
- [x] Define deprecated dock download/youtube panel type cleanup checks.
- [ ] Define `P3_PROJECT_SCHEMA_NO_STORE_IMPORTS` import-boundary check.
- [ ] Delete or retire old-project fixture tests that only preserve obsolete
      compatibility.

## Phase 4 - Media Panel And FlashBoard

- [x] Identify `MediaPanel`, `MediaPanel.css`, `FlashBoardComposer`, and
      `FlashBoard.css` as major targets.
- [x] Define active FlashBoard contract.
- [x] Define retired board/canvas candidates.
- [x] Define Media Panel and FlashBoard gates.
- [x] Add Media Board versus FlashBoard Board classification requirement.
- [x] Add Media Board hybrid canvas/OffscreenCanvas render strategy gate.
- [x] Add FlashBoard provider task contract gate.
- [x] Add Media Board project roundtrip gate.
- [x] Define Media Panel component/module tree.
- [x] Define FlashBoard composer module tree.
- [ ] Define Media Board renderer packet and board performance thresholds.
- [x] Define FlashBoard retired-path ledger entries.
- [x] Define Media Panel and FlashBoard smoke tests.
- [x] Define request planner/reference resolver/provider runner/media import
      adapter split for FlashBoard services.

## Phase 5 - Preview, Export, And Common UI

- [x] Identify Preview, overlays, ExportPanel, and large common CSS targets.
- [x] Define target split for Preview.
- [x] Define target split for Export.
- [x] Define target split for common CSS.
- [x] Add RenderTargetSnapshot dependency for Preview.
- [x] Add ExportRenderSession and bounded-memory export requirements.
- [x] Add CSS global selector/z-index/retired-class gate.
- [ ] Define overlay registry contract.
- [ ] Define export runner contract.
- [ ] Define CSS deletion/usage scan gate.
- [ ] Define `AbortSignal` cancellation contract for export runners.
- [ ] Define Phase 5/Phase 6 sequencing rules for render/export shared state.

## Phase 6 - Render, Audio, WebCodecs, Proxy, And Cache Hot Paths

- [x] Identify RenderDispatcher, WebCodecsPlayer, WebGPUEngine, proxy/cache,
      thumbnail, and audio god objects.
- [x] Define hot-path invariants.
- [x] Define render/audio/proxy gates.
- [x] Add RenderFrameSnapshot and RenderOutputRouter gates.
- [x] Add VideoFrame lease/borrow/close contract gate.
- [x] Add proxy close/revoke accounting and decoder coalescing gates.
- [x] Add audio context ownership map gate.
- [ ] Define playback/scrub/export performance baseline.
- [ ] Define GPU/resource lifetime checks.
- [ ] Define cache eviction/object URL lifetime checks.
- [ ] Define `audioRoutingManager` versus `audioManager` ownership decision.
- [ ] Define scrub `AudioContext` disposal check.

## Phase 7 - AI Tools, Dev Bridge, Guided Actions, And Smokes

- [x] Identify `aiTools/bridge`, `aiTools/index`, handlers, and
      `timelineCanvasSmoke` as targets.
- [x] Define product AI versus dev bridge boundary.
- [x] Define smoke handler split.
- [x] Define AI/dev bridge gates.
- [x] Promote existing AI bridge smokes to Phase 0 gate inputs.
- [ ] Define bridge transport split.
- [ ] Define tool execution facade target.
- [ ] Define smoke replacement order.
- [ ] Define thresholds for `getStats`, `getPlaybackTrace`, `debugExport`, and
      timeline canvas smokes.

## Phase 8 - Test Suite Refactor And Architecture Gates

- [x] Identify largest tests.
- [x] Define test migration rule.
- [x] Define architecture gate categories.
- [ ] Define exact test migration ledger.
- [ ] Define LOC budget gate.
- [ ] Define runtime-free schema gate.
- [ ] Define retired-path gate.
- [ ] Define smoke coverage gate.

## Review And Approval

- [x] Run initial skeptical/codebase review with 2 Codex and 2 Claude agents.
- [x] Incorporate first review findings into the plan.
- [x] Run final skeptical review after exact gates/write sets are added.
- [x] Incorporate or reject final skeptical review findings.
- [x] Produce first orchestrator-ready source implementation packets inside
      `docs/ongoing/complete-refactor/execution-queue-and-lanes.md`.
- [x] Start first source/tooling packet after its write set, forbidden
      files, and gate/check are explicit.
