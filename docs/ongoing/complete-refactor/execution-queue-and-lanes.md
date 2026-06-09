# Complete Refactor - Execution Queue And Lanes

Source: split from `docs/ongoing/Complete-refactor.md` on 2026-06-09.

Back to index: [Complete-refactor.md](../Complete-refactor.md).

Archived completed packet specs: [execution-history-2026-06-09.md](execution-history-2026-06-09.md).

## Active Queue Rule

This file is the live queue, not the packet-history archive.

- Keep only the active packet plus the next few queued packets in full detail.
- When a packet completes, collapse it to one or two lines in
  `docs/ongoing/Complete-refactor-checklist.md`.
- Remove or summarize long completed packet specs unless they are still needed
  as reusable templates for the next wave.
- Prefer reusable check profiles over repeating the same `npm run test`, `tsc`,
  and `rg` blocks in every small extraction packet.
- Update this file only for active packet, next packet, gate/write-set,
  blocker, conflict, or verification-result changes.

## Dependency Order

The master orchestrator should execute in this order:

1. Phase 0 baseline and gates.
2. Phase 1 foundation contracts.
3. Phase 1A clip/media-source data versus runtime split.
4. Phase 1B Universal Signal foundation and format matrix.
5. Combined Phase 2/3 contract freeze for stores, project schema, project
   persistence, importers, history, FlashBoard persistence, and runtime leases.
6. Phase 2 store/runtime ownership implementation packets.
7. Phase 3 project persistence/importer implementation packets.
8. Phase 4 Media Panel and FlashBoard.
9. Phase 5 Preview, Export, and Common UI.
10. Phase 6 Render, Audio, WebCodecs, Proxy, Cache.
11. Phase 7 AI tools/dev bridge/smokes.
12. Phase 8 test suite and architecture gates.

Phase 4 and Phase 5 can overlap only after Phase 1A and the combined P2/P3
contract freeze are accepted. Phase 5 and Phase 6 must be sequenced whenever
they touch engine export state, render target store, Preview registration,
render snapshots, output routing, or export runners. Phase 7 can start earlier
for read-only smoke inventory, but bridge source edits should wait until the
product contracts it calls are stable.

## Reusable Check Profiles

Use these profiles instead of repeating full command blocks in every small
adjacent extraction packet. Add packet-specific scans only when the packet owns a
new contract or write set.

### P4_MEDIAPANEL_PRESENTATION_CHECKS

- `npm run test -- tests/unit/mediaPanelDropImport.test.ts tests/unit/mediaPanelItemTypeGuards.test.ts tests/unit/mediaPanelSourceMonitor.test.tsx`
- `npx tsc -b --pretty false`
- `rg -n "flashboard-|useFlashBoardStore|FlashBoardComposer|MediaDownloadComposer" src/components/panels/MediaPanel.tsx <affected-media-subpaths>`

### P4_MEDIA_BOARD_BOUNDARY_CHECKS

- `P4_MEDIAPANEL_PRESENTATION_CHECKS`
- Add one packet-specific `rg` scan for the extracted board contract, e.g.
  annotation helpers, board host boundary, storage keys, or selector names.
- Do not broaden into Media Board renderer, layout, storage, overview canvas,
  media store, project schema, Timeline, render, export, preview, or media
  runtime unless a later joint packet owns that write set.

### P3_PROJECT_SCHEMA_BOUNDARY_CHECKS

- `npm run test -- tests/unit/projectSchemaBoundary.test.ts tests/unit/foundationTypeBoundary.test.ts tests/unit/completeArchitectureRegistry.test.ts tests/unit/persistedStateRuntimeHandles.test.ts`
- `npx tsc -b --pretty false`
- Use only for project-schema or hydration packets, not ordinary MediaPanel
  presentation extraction.

## Completed Packet Summary

Full historical packet specs and completion reports are archived in
[execution-history-2026-06-09.md](execution-history-2026-06-09.md). The running
user-visible status remains in `docs/ongoing/Complete-refactor-checklist.md`.

- Foundation and schema packets completed or advanced: `P0-P1-PREFLIGHT-001`,
  `P0-REG-001`, `P0-BASELINE-REFRESH-001`, `P1-CONTRACT-001`,
  `P1A-RUNTIME-LEASE-001`, `P1B-SIGNAL-DTO-001`,
  `P1-P3-SCHEMA-FREEZE-001`, `P3-HYDRATION-ADAPTER-001`, and
  `P3-DEPRECATED-PAYLOADS-001`.
- P4 setup packets completed: `P4-P3-UI-LAYOUT-PREFLIGHT-001`,
  `P4-P3-UI-LAYOUT-CLEANUP-001`, and
  `P4-MEDIA-PANEL-SHELL-PREFLIGHT-001`.
- MediaPanel source slices completed: `P4-MEDIA-PANEL-SHELL-SPLIT-001` through
  `P4-MEDIA-PANEL-BOARD-ANNOTATION-CONTEXT-MENU-SPLIT-026`.
- MediaPanel read-only classification completed:
  `P4-MEDIA-PANEL-CONTEXT-ACTIONS-MOUNT-PREFLIGHT-027`.
- MediaPanel source slice completed:
  `P4-MEDIA-PANEL-CONTEXT-ACTIONS-DERIVED-PROPS-SPLIT-028`.
- MediaPanel source slice completed:
  `P4-MEDIA-PANEL-CONTEXT-SELECTED-ITEM-STATE-SPLIT-029`.
- MediaPanel read-only classification completed:
  `P4-MEDIA-PANEL-CONTEXT-HANDLER-OWNERSHIP-PREFLIGHT-030`.
- MediaPanel source slice completed:
  `P4-MEDIA-PANEL-CONTEXT-EXPLORER-HANDLERS-SPLIT-031`.
- MediaPanel source slice completed:
  `P4-MEDIA-PANEL-CONTEXT-LOCAL-HANDLERS-SPLIT-032`.
- Accepted interim warning: Media Board source boundaries are still uneven in
  the current worktree (`MediaBoardView.tsx` 734 LOC, `layout.ts` 817 LOC,
  `MediaBoardHost.tsx` 7 LOC). This is not a blocker for completed context-menu
  slices; handle it through a later Board/View/Layout boundary packet.
- MediaBoard read-only classification completed:
  `P4-MEDIA-BOARD-VIEW-LAYOUT-BOUNDARY-PREFLIGHT-033`.
- MediaBoard source slice completed:
  `P4-MEDIA-BOARD-LAYOUT-RECONCILE-SPLIT-034`.
- Remaining accepted interim warning: `MediaBoardView.tsx` is still 734 LOC and
  `MediaBoardHost.tsx` is still a 7 LOC pass-through. `layout.ts` is now under
  the product source ceiling after the reconcile split.
- MediaBoard read-only classification completed:
  `P4-MEDIA-BOARD-VIEW-NODE-BOUNDARY-PREFLIGHT-035`.
- MediaBoard source slice completed:
  `P4-MEDIA-BOARD-NODE-RENDERER-SPLIT-036`.
- Remaining accepted interim warning: `MediaBoardHost.tsx` is still a 7 LOC
  pass-through. Classify it before deleting or replacing it.
- MediaBoard read-only classification completed:
  `P4-MEDIA-BOARD-HOST-BOUNDARY-PREFLIGHT-037`; host classified as delete-now.
- MediaBoard source deletion completed:
  `P4-MEDIA-BOARD-HOST-PASSTHROUGH-DELETE-038`.
- Resolved Media Board source warning: `MediaBoardView.tsx`,
  `MediaBoardNode.tsx`, `layout.ts`, and `layoutReconcile.ts` are all below the
  product-source ceiling, and the no-value host pass-through is deleted.
- FlashBoard read-only classification completed:
  `P4-FLASHBOARD-RETIRED-BOARD-USAGE-PREFLIGHT-039`; direct retired board
  deletion is not safe yet because active Composer/runtime/job/import behavior
  still depends on board/node state.
- FlashBoard active/retired store-boundary preflight completed:
  `P4-FLASHBOARD-ACTIVE-RETIRED-STORE-BOUNDARY-PREFLIGHT-040`; active
  generation still uses board nodes as draft, job, import, and metadata records.
  The next split must introduce an active generation record adapter before
  retired node deletion.
- FlashBoard active generation record adapter split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-RECORD-ADAPTER-SPLIT-041`;
  `FlashBoardMediaBridge` now talks to a store-owned active generation record
  adapter instead of directly importing `useFlashBoardStore` or `FlashBoardNode`.
- Media AI generation queue record adapter split completed:
  `P4-MEDIA-AI-GENERATION-QUEUE-RECORD-ADAPTER-SPLIT-042`;
  `MediaAIGenerationQueue.tsx` now reads active generation records through the
  adapter instead of directly flattening `boards` or importing `FlashBoardNode`.
- FlashBoard Composer submit adapter split completed:
  `P4-FLASHBOARD-COMPOSER-SUBMIT-ADAPTER-SPLIT-043`;
  `FlashBoardComposer.tsx` now submits complete generation requests through the
  active generation record adapter instead of using active board selectors or
  draft/request/queue node actions directly.
- FlashBoard runtime update adapter split completed:
  `P4-FLASHBOARD-RUNTIME-UPDATE-ADAPTER-SPLIT-044`;
  `useFlashBoardRuntime.ts` now uses active generation record adapter
  hooks/actions for board bootstrap, job updates, failures, and optional
  keyboard delete instead of direct store internals.
- FlashBoard active generation persistence preflight completed:
  `P3-P4-FLASHBOARD-ACTIVE-GENERATION-PERSISTENCE-PREFLIGHT-045`; project
  save/load/lifecycle still serialize, hydrate, reset, and autosync retired
  FlashBoard board/node payloads. Active UI/service paths are already behind
  the active generation record adapter.
- FlashBoard active generation persistence schema split completed:
  `P3-P4-FLASHBOARD-ACTIVE-GENERATION-PERSISTENCE-SCHEMA-SPLIT-046`;
  current project persistence now saves/loads `generationRecords` and metadata
  instead of retired FlashBoard boards/nodes, and lifecycle/autosave use the
  active generation record boundary.
- FlashBoard retired board CSS deletion completed:
  `P4-FLASHBOARD-RETIRED-BOARD-CSS-DELETE-047`; unused retired
  `.flashboard-*` workspace/toolbar/canvas/node/context CSS is gone while active
  `.fb-*` Composer and Media AI queue/tray styles remain covered.
- FlashBoard active generation store internals preflight completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-STORE-INTERNALS-PREFLIGHT-048`; remaining
  `activeBoardId`/`boards`/`selectedNodeIds`, board/node selectors, and
  board/node slice actions are local store/test backing-model debt. The next
  source packet can stay inside `flashboardStore` plus FlashBoard unit tests.
- FlashBoard active generation store model split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-STORE-MODEL-SPLIT-049`; `flashboardStore`
  now owns `activeGenerationRecords` directly, retired board/node slices are
  deleted, history snapshots/restores active generation records, and focused
  FlashBoard plus HistoryStore checks passed.
- FlashBoard active generation naming preflight completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-NAMING-PREFLIGHT-050`; remaining `nodeId`
  usage is local FlashBoard job-service/runtime/media-bridge naming for active
  generation records, and `draftNodeId` is a local unused Composer-state naming
  remnant. The next rename packet can stay inside FlashBoard files and tests.
- FlashBoard active generation record-id rename completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-RECORD-ID-RENAME-051`; FlashBoard local job
  identifiers now use `recordId`, Composer draft-node state is removed, and
  focused FlashBoard plus TypeScript checks passed.
- FlashBoard active composer/service size preflight completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SERVICE-SIZE-PREFLIGHT-052`; remaining active
  P4 pressure is `FlashBoardComposer.tsx` 3895 LOC, `FlashBoard.css` 2469 LOC,
  and `FlashBoardJobService.ts` 715 LOC. The smallest safe next source packet
  is an active CSS section split because selector blocks are contiguous and can
  preserve class names and cascade order without TS behavior changes.
- FlashBoard active CSS section split completed:
  `P4-FLASHBOARD-ACTIVE-CSS-SECTION-SPLIT-053`; `FlashBoard.css` is now an
  ordered import manifest for active role files:
  `FlashBoardBubble.css`, `FlashBoardReferences.css`,
  `FlashBoardMultishot.css`, `FlashBoardControls.css`, and
  `FlashBoardPopovers.css`. Active selector order is preserved, the retired
  board-class scan stayed clean, and focused FlashBoard tests passed.
- FlashBoard active Composer/job source preflight completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-JOB-SOURCE-PREFLIGHT-054`; Composer remains a
  large UI/controller hub, while `FlashBoardJobService.ts` is a narrower
  provider-dispatch hub with direct unit coverage. The next source packet should
  split provider runner execution out of JobService before reopening Composer UI
  extraction.
- FlashBoard active job provider runner split completed:
  `P4-FLASHBOARD-ACTIVE-JOB-PROVIDER-RUNNER-SPLIT-055`;
  `FlashBoardJobService.ts` now keeps queue/cancel/retry/concurrency/running
  ownership and calls `FlashBoardProviderRunners.ts` for provider task
  execution. Focused FlashBoard tests and TypeScript passed.
- FlashBoard active Composer boundary preflight completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-BOUNDARY-PREFLIGHT-056`; Composer remains a
  3895 LOC UI/controller hub. The next source split should extract the
  contiguous Multishot panel presentation first because it has isolated CSS and
  can keep state, validation, helpers, and request assembly in Composer.
- FlashBoard active Multishot panel split completed:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PANEL-SPLIT-057`; Multishot panel JSX moved
  to `FlashBoardMultishotPanel.tsx`, while Composer retains state, helper
  functions, validation, request assembly, and callbacks. Focused FlashBoard
  tests and TypeScript passed.
- FlashBoard active reference strip preflight completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PREFLIGHT-058`; reference interaction
  is coupled to Composer refs, hover, role mutation, drag/drop, and store
  updates. The next source packet should extract presentation only and keep
  interaction handlers in Composer.
- FlashBoard active reference strip presentation split completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-STRIP-PRESENTATION-SPLIT-059`; reference
  strip presentation and `ComposerReferenceBadge` moved to
  `FlashBoardReferenceStrip.tsx`, while Composer retains badge derivation,
  refs, focus/auto-scroll callbacks, hover updates, role mutation, drag/drop,
  and store updates. Focused FlashBoard tests and TypeScript passed.
- FlashBoard active reference interaction preflight completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-INTERACTION-PREFLIGHT-060`; focus and
  auto-scroll are a local DOM/ref cluster, while drag/drop and role mutation
  touch Composer/store state. The next source packet should split focus and
  auto-scroll into a hook first.
- FlashBoard active reference focus hook split completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-FOCUS-HOOK-SPLIT-061`; reference focus,
  auto-scroll refs, RAF state, pointer callbacks, reset/leave behavior, and
  cleanup moved to `useFlashBoardReferenceFocus.ts`. Drag/drop, hover, role
  mutation, store updates, and request assembly remain in Composer. Focused
  FlashBoard tests and TypeScript passed.
- FlashBoard active reference drop hook split completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-DROP-HOOK-SPLIT-063`; reference drag/drop
  state, MIME/payload parsing, duplicate filtering, and reference append/clamp
  moved to `useFlashBoardReferenceDrop.ts`.
- FlashBoard active prompt/chat presentation splits completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-EDITOR-SHELL-SPLIT-065`,
  `P4-FLASHBOARD-ACTIVE-CHAT-OUTPUT-SHELL-SPLIT-067`, and
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLS-SHELL-SPLIT-069`; Composer still owns
  prompt/chat state, provider state, service calls, request assembly, and
  submit behavior.
- FlashBoard active action stack preflight completed:
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-PREFLIGHT-070`; the next safe source
  packet is a presentation-only action-stack component. Focused FlashBoard
  tests passed.
- FlashBoard active action stack shell split completed:
  `P4-FLASHBOARD-ACTIVE-ACTION-STACK-SHELL-SPLIT-071`;
  `FlashBoardActionStack.tsx` owns only generate/chat send-stop presentation,
  while Composer keeps handler implementation, price/title computation, request
  assembly, services, stores, and CSS.
- FlashBoard active generation controls preflight completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROLS-PREFLIGHT-072`; popover contents
  remain coupled to provider selection, price estimates, ElevenLabs/Suno state,
  and prompt-refine service triggers. The next source packet should split only
  the control shell and pill-row presentation with existing popovers passed as
  children.
- FlashBoard active generation control shell split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-CONTROL-SHELL-SPLIT-073`;
  `FlashBoardGenerationControls.tsx` owns the non-chat control shell, pill row,
  selected model label, and popover host wrapper. Composer still owns all
  model/audio/Suno/parameter popover contents and behavior.
- FlashBoard active generation popovers preflight completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-POPOVERS-PREFLIGHT-074`; model picker and
  generic parameter popovers still depend on provider selection and price
  estimates, and ElevenLabs popovers still depend on model/voice loading and
  preview. The next safe source packet is the Suno popover presentation group.
- FlashBoard active Suno popovers shell split completed:
  `P4-FLASHBOARD-ACTIVE-SUNO-POPOVERS-SHELL-SPLIT-075`;
  `FlashBoardSunoPopovers.tsx` owns only Suno model/mode/tuning popover
  presentation. Composer keeps Suno state, reset logic, prompt-refine behavior,
  request assembly, services, stores, and CSS.
- FlashBoard active ElevenLabs popovers preflight completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-POPOVERS-PREFLIGHT-076`; the Voice popover
  still owns voice-list loading/search/preview/manual-field coupling. The next
  safe source packet is the ElevenLabs model/output/voice-settings presentation
  group, while Voice remains in Composer.
- FlashBoard active ElevenLabs settings popovers split completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-SETTINGS-POPOVERS-SPLIT-077`;
  `FlashBoardElevenLabsSettingsPopovers.tsx` owns ElevenLabs model, output, and
  voice-settings popover presentation. Composer still owns the Voice picker,
  voice-list loading/search/preview/manual fields, normalization, mutation,
  request assembly, services, stores, and CSS.
- FlashBoard active ElevenLabs Voice popover preflight completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-PREFLIGHT-078`; Voice picker
  presentation can move with primitive voice-option DTOs, empty copy, loading
  state, manual-field values, and callbacks. Composer keeps voice-loading
  effects, preview playback, state ownership, services, stores, and CSS.
- FlashBoard active ElevenLabs Voice popover split completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-VOICE-POPOVER-SPLIT-079`;
  `FlashBoardElevenLabsVoicePopover.tsx` owns only Voice picker presentation.
  Composer keeps voice-loading effects, preview playback, state ownership,
  services, stores, request assembly, and CSS.
- FlashBoard active generation parameter popovers preflight completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-PREFLIGHT-080`; model
  picker remains coupled to provider categories, provider switching, selected
  entries, and per-entry prices. Generic aspect, duration, image-size, and mode
  popovers can split next if Composer keeps option planning and price
  estimation.
- FlashBoard active generation parameter popovers split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-PARAMETER-POPOVERS-SPLIT-081`;
  `FlashBoardParameterPopovers.tsx` owns only generic aspect, duration,
  image-size, and mode popover presentation. Composer keeps the model picker,
  provider switching, price estimation, option planning, services, stores,
  request assembly, and CSS.
- FlashBoard active model popover preflight completed:
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-PREFLIGHT-082`; model picker can split as
  presentation if Composer keeps category/entry option planning, source/price
  labels, active-category state, selected-entry state, and provider switching.
- FlashBoard active model popover split completed:
  `P4-FLASHBOARD-ACTIVE-MODEL-POPOVER-SPLIT-083`;
  `FlashBoardModelPopover.tsx` owns only model picker presentation. Composer
  keeps category/entry option planning, price/source labels, active-category
  state, selected-entry state, provider switching, services, stores, request
  assembly, and CSS.
- FlashBoard active submit pipeline preflight completed:
  `P4-FLASHBOARD-ACTIVE-SUBMIT-PIPELINE-PREFLIGHT-084`; validation and action
  labels should stay in Composer for now, while the request payload assembly in
  `handleGenerate` can move as a pure planner that returns
  `FlashBoardGenerationRequest`.
- FlashBoard active generation request builder split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-REQUEST-BUILDER-SPLIT-085`;
  `FlashBoardGenerationRequestPlanner.ts` owns only pure generation request
  payload assembly. Composer keeps validation, action labels, submit guard,
  queue submission, stores, services, and CSS.
- FlashBoard active validation/action-state preflight completed:
  `P4-FLASHBOARD-ACTIVE-VALIDATION-ACTION-STATE-PREFLIGHT-086`; validation
  errors, current price, button labels/titles, and `canGenerate` form a
  coherent pure derived-state boundary. Composer should keep prompt-refine,
  provider switching, request builder calls, submit guard, queue submission,
  stores, services with side effects, and CSS.
- FlashBoard active generation action-state split completed:
  `P4-FLASHBOARD-ACTIVE-GENERATION-ACTION-STATE-SPLIT-087`;
  `FlashBoardGenerationActionStatePlanner.ts` owns pure validation/action
  state, current-price labels, button labels/titles, and `canGenerate`.
  Composer keeps prompt-refine, provider switching, request builder calls,
  submit guard, queue submission, stores, services with side effects, and CSS.
- FlashBoard active provider-transition preflight completed:
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PREFLIGHT-088`; provider switching,
  parameter reset rules, audio/Suno/ElevenLabs carry-over, and composer patch
  assembly form a coherent pure planner boundary. Focused FlashBoard tests
  passed; source stayed unchanged.
- FlashBoard active provider-transition planner split completed:
  `P4-FLASHBOARD-ACTIVE-PROVIDER-TRANSITION-PLANNER-SPLIT-089`;
  `FlashBoardProviderTransitionPlanner.ts` owns only pure provider-transition
  planning. Composer keeps selected-entry lookup, React setters,
  `updateComposer`, popover closing, provider option planning, prompt-refine,
  submit orchestration, stores, services with side effects, and CSS.
- FlashBoard active composer-sync preflight completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PREFLIGHT-090`; the
  local-state-to-persisted-composer sync effect can move as a pure patch
  planner. Focused FlashBoard tests passed; source stayed unchanged.
- FlashBoard active composer-sync planner split completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-SYNC-PLANNER-SPLIT-091`;
  `FlashBoardComposerSyncPlanner.ts` owns only pure local-state-to-persisted
  composer patch derivation. Composer keeps the `useEffect` lifecycle,
  `updateComposer`, local setters, selected-entry lookup, prompt-refine, submit
  orchestration, stores, services with side effects, and CSS.
- FlashBoard active prompt-refine preflight completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-PREFLIGHT-092`; prompt-refine request
  input assembly can move as a pure planner, while gating, dialogs, abort
  lifetime, streaming callbacks, parse/apply behavior, and restore state stay
  in Composer.
- FlashBoard active prompt-refine input planner split completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-INPUT-PLANNER-SPLIT-093`;
  `FlashBoardPromptRefinePlanner.ts` owns only prompt-refine input availability
  and `RefineFlashBoardPromptInput` assembly. Composer keeps gating, dialogs,
  abort lifetime, streaming callbacks, parse/apply behavior, restore state,
  prompt-refine service calls, stores, services with side effects, and CSS.
- FlashBoard active prompt-refine response preflight completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-RESPONSE-PREFLIGHT-094`; field update
  decisions for streaming delta, final response, error fallback, and undo
  restore can move as pure planner functions. Composer should keep parsing,
  setter execution, abort lifetime, prompt-refine service calls, gating,
  dialogs, stores, services with side effects, and CSS.
- FlashBoard active prompt-refine field planner split completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-FIELD-PLANNER-SPLIT-095`;
  `FlashBoardPromptRefinePlanner.ts` owns prompt-refine input availability,
  input assembly, and pure field update planning for streaming, final, error
  restore, and undo restore cases. Composer keeps parsing, setter execution,
  abort lifetime, prompt-refine service calls, gating, dialogs, stores,
  services with side effects, and CSS.
- FlashBoard active prompt-refine controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-CONTROLLER-PREFLIGHT-096`; remaining
  prompt-refine controller work is side-effectful and should stay in Composer
  for now. A further split would mostly wrap dialogs, abort lifetime, service
  calls, streaming callback lifetime, and React setter execution.
- FlashBoard active chat-send preflight completed:
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PREFLIGHT-097`; chat send has a pure planning
  boundary for open/abort/error/send action selection, credential gating,
  request prompt assembly, optimistic message creation, chat request payload,
  and assistant message patching. Composer should keep dialogs,
  AbortController lifetime, refs, React setters, and chat service execution.
- FlashBoard active chat-send planner split completed:
  `P4-FLASHBOARD-ACTIVE-CHAT-SEND-PLANNER-SPLIT-098`;
  `FlashBoardChatSendPlanner.ts` owns chat send action selection, credential
  gating, request prompt assembly, optimistic messages, chat request payload,
  and assistant message response/error patching. Composer keeps dialogs,
  AbortController lifetime, refs, React setters, and chat service execution.
- FlashBoard active chat-options preflight completed:
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PREFLIGHT-099`; chat provider/model
  option derivation, active model lookup, support flags, hosted credit labels,
  provider/model fallback, and reasoning fallback can move as pure planning.
  Composer keeps Lemonade health effects and React setter execution.
- FlashBoard active chat-options planner split completed:
  `P4-FLASHBOARD-ACTIVE-CHAT-OPTIONS-PLANNER-SPLIT-100`;
  `FlashBoardChatOptionsPlanner.ts` owns chat model option derivation, active
  model lookup, support flags, hosted credit labels, provider/model fallback,
  and reasoning fallback. Composer keeps Lemonade health effects, chat panel
  state, and React setter execution.
- FlashBoard active chat-controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-CHAT-CONTROLLER-PREFLIGHT-101`; remaining chat
  controller work is side-effectful and should stay in Composer for now:
  provider/model setter sequencing, panel open/error resets, AbortController
  cleanup, copied-message timeout cleanup, clipboard writes, history scroll
  refs, Lemonade health effect execution, and small prompt input setters.
- FlashBoard active submit-controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-SUBMIT-CONTROLLER-PREFLIGHT-102`; submit
  orchestration should stay in Composer for now. `handleGenerate` is reduced to
  the guard, request-mode derivation, existing request builder call, and queue
  submission. Another submit split would wrap existing planners and the store
  submit side effect.
- FlashBoard active parameter-options preflight completed:
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PREFLIGHT-103`; aspect, duration,
  image-size, and mode option derivation can split as pure planning. Composer
  should keep selected-entry state, active popover state, React setters,
  popover close calls, stores, services with side effects, and CSS.
- FlashBoard active parameter-options planner split completed:
  `P4-FLASHBOARD-ACTIVE-PARAMETER-OPTIONS-PLANNER-SPLIT-104`;
  `FlashBoardParameterOptionsPlanner.ts` owns pure aspect, duration,
  image-size, and mode option derivation plus price metadata. Composer keeps
  selected-entry state, active popover state, React setters, popover close
  calls, stores, services with side effects, and CSS.
- FlashBoard active model-options preflight completed:
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PREFLIGHT-105`; model catalog
  visibility, category grouping, initial/selected entry lookup, active category
  fallback, model button labels, source labels, and popover entry price
  metadata can split as pure planning. Composer keeps provider switch
  execution, provider-transition setter/application, active category setter,
  React setters, stores, services with side effects, and CSS.
- FlashBoard active model-options planner split completed:
  `P4-FLASHBOARD-ACTIVE-MODEL-OPTIONS-PLANNER-SPLIT-106`;
  `FlashBoardModelOptionsPlanner.ts` owns model catalog visibility, category
  grouping, initial/selected entry lookup, active category fallback, model
  button label, and model popover entry DTO construction. Composer keeps
  provider switch execution, provider-transition setter/application,
  selected-entry consumers, active category setter, React setters, stores,
  services with side effects, and CSS.
- FlashBoard active ElevenLabs-options preflight completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PREFLIGHT-107`; ElevenLabs model
  fallback/options, selected model lookup, character limit, audio model/output
  labels, model meta text, output option DTOs, voice option DTOs, and
  selected-voice lookup can split as pure planning. Composer keeps API loading
  effects, refresh nonce, loading/error setters, selection execution, stores,
  services with side effects, and CSS.
- FlashBoard active ElevenLabs-options planner split completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-OPTIONS-PLANNER-SPLIT-108`;
  `FlashBoardElevenLabsOptionsPlanner.ts` owns ElevenLabs model
  fallback/options, selected model lookup, character-limit derivation, audio
  model/output labels, model meta text, output option DTOs, voice option DTOs,
  and selected-voice lookup. Composer keeps API loading effects, refresh nonce,
  loading/error setters, selection execution, stores, services with side
  effects, and CSS.
- FlashBoard active ElevenLabs-controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-ELEVENLABS-CONTROLLER-PREFLIGHT-109`; remaining
  ElevenLabs controller behavior should stay in Composer for now because it
  owns API loading effects, AbortController and timeout lifetime, refresh
  nonce, loading/error setters, voice preview, selection execution, and voice
  settings setters.
- FlashBoard active Suno-options preflight completed:
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PREFLIGHT-110`; current model
  normalization, model/mode button labels, tuning-changed flag, reset defaults,
  model option DTOs, and vocal gender option DTOs can split as pure planning.
  Focused FlashBoard tests passed.
- FlashBoard active Suno-options planner split completed:
  `P4-FLASHBOARD-ACTIVE-SUNO-OPTIONS-PLANNER-SPLIT-111`;
  `FlashBoardSunoOptionsPlanner.ts` owns pure Suno model normalization,
  model/mode button labels, tuning-changed flag, model option DTOs, vocal
  gender option DTOs, and reset-default state. Composer keeps React state and
  setter execution. Focused FlashBoard tests, TypeScript, and diff-check
  passed.
- FlashBoard active Suno-controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-SUNO-CONTROLLER-PREFLIGHT-112`; remaining Suno
  behavior stays in Composer for now because it owns React setter execution,
  version/mode/tuning application, prompt-refine service flow, sync-patch
  application, request-builder invocation, and restore state.
- FlashBoard active remaining-Composer boundary preflight completed:
  `P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-113`; remaining
  clusters are chat service controller, prompt-refine service controller,
  ElevenLabs API controller, provider/sync effects, multishot controller, and
  reference role/remove commands. The next safe source split is reference
  commands.
- FlashBoard active reference-command hook split completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-COMMAND-HOOK-SPLIT-114`;
  `useFlashBoardReferenceCommands.ts` owns reference remove and role-change
  callbacks. Composer still owns reference badge derivation, reference drop and
  focus wiring, store action injection, and non-reference controllers.
- FlashBoard active reference-badge preflight completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PREFLIGHT-115`; reference badge
  construction can split as pure planning from start/end ids, clamped
  reference ids, and `mediaFilesById`. Composer keeps MediaStore reads,
  `mediaFilesById`, type guarding, drop/focus/command hooks, and store update
  execution.
- FlashBoard active reference-badge planner split completed:
  `P4-FLASHBOARD-ACTIVE-REFERENCE-BADGE-PLANNER-SPLIT-116`;
  `FlashBoardReferenceBadgePlanner.ts` owns reference badge DTO construction.
  Composer keeps MediaStore reads, `mediaFilesById`, type guarding,
  drop/focus/command hooks, prompt-refine reference counts, and store update
  execution. Focused FlashBoard tests, TypeScript, and diff-check passed.
- FlashBoard active Multishot-controller preflight completed:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-PREFLIGHT-117`; pure Multishot
  helper math can split first. Composer should keep React state, panel
  open/close timeout lifetime, `setGenerateAudio` coupling, selected-provider
  support checks, UI callbacks, request/sync inputs, CSS, stores, project
  schema, Media Board, Timeline, render, export, preview, and media runtime.
- FlashBoard active Multishot-planner split completed:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-PLANNER-SPLIT-118`;
  `FlashBoardMultishotPlanner.ts` owns max-shot limiting, duration
  rebalancing, default shot creation, add/remove shot math, and fallback prompt
  construction. Composer keeps Multishot React state, panel timeout lifetime,
  `setGenerateAudio` coupling, selected-provider support checks, UI callbacks,
  request/sync inputs, CSS, stores, project schema, Media Board, Timeline,
  render, export, preview, and media runtime. Focused FlashBoard tests,
  TypeScript, and diff-check passed.
- FlashBoard active Multishot-controller hook preflight completed:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-PREFLIGHT-119`; remaining
  Multishot React state/effects/callbacks can split into a local hook if
  Composer injects `setGenerateAudio`, duration, selected output type, and
  provider support booleans while keeping request/sync inputs and unrelated
  controllers in Composer.
- FlashBoard active Multishot-controller hook split completed:
  `P4-FLASHBOARD-ACTIVE-MULTISHOT-CONTROLLER-HOOK-SPLIT-120`;
  `useFlashBoardMultishotController.ts` owns local Multishot React
  state/effects/callbacks. Composer injects duration, GenerateAudio state and
  setter, selected output type, and support booleans, while keeping
  provider/support derivation, request/sync inputs, generation control wiring,
  prompt-refine/chat/ElevenLabs controllers, CSS, stores, project schema, Media
  Board, Timeline, render, export, preview, and media runtime. Focused
  FlashBoard tests, TypeScript, and diff-check passed.

## High-Conflict Ownership Snapshot

| Path or hub | Owner packet | Other packets may | Forbidden until |
|---|---|---|---|
| `src/types/index.ts` | `P1-CONTRACT-001` | read, measure fan-in | `P0-REG-001` green and final skeptical review accepted |
| `src/types/audio.ts`, `src/types/dock.ts`, `src/types/history.ts`, `src/types/vectorAnimation.ts` | `P1-CONTRACT-001` | read | same P1 packet owns focused edits |
| `src/services/project/types/**` | `P1-P3-SCHEMA-FREEZE-001` | read, scan imports | combined P2/P3 contract freeze accepted |
| `src/services/mediaRuntime/**` | `P1A-RUNTIME-LEASE-001` | read, scan runtime handles | P2/P3 store-project freeze or explicit runtime adapter packet accepted |
| `src/signals/**` | `P1B-SIGNAL-DTO-001` | read, scan runtime handles | P1/P3 schema freeze or explicit signal implementation packet accepted |
| `src/importers/**` | `P1B-SIGNAL-DTO-001` | read, scan route matrix | P1/P3 schema freeze or explicit importer implementation packet accepted |
| `src/stores/timeline/**` | protected Timeline integration lane | read only | explicit integration packet for hydration/runtime/signal/render snapshot |
| `src/components/timeline/**` | protected Timeline integration lane | read only | explicit integration packet for hydration/runtime/signal/render snapshot |
| `src/timeline/architecture/**` | protected template/reference | read only | user-approved registry-template edit |
| `src/stores/mediaStore/**`, `src/stores/historyStore.ts`, `src/stores/dockStore.ts`, `src/stores/renderTargetStore.ts` | `P2-STORE-RUNTIME-FREEZE-001` | read, scan | P2/P3 contract freeze accepted |
| `src/engine/**`, `src/components/preview/**`, `src/components/export/**` | later P5/P6 joint packets | read, smoke only | render snapshot/output-router contracts frozen |
| `src/services/aiTools/**` | later P7 smoke quarantine packets | read, smoke inventory only | Phase 0 smoke thresholds accepted |

## Active Packet

```text
Lane: P4 Media Panel And FlashBoard
Packet: P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-139 FlashBoard Active Composer Remaining Boundary Preflight
Mode: read-only preflight
Goal: classify the remaining FlashBoard Composer responsibilities after the
prompt-refine controller hook split and select the next coherent bounded packet.
Read first:
- src/components/panels/flashboard/FlashBoardComposer.tsx
- src/components/panels/flashboard/useFlashBoardPromptRefineController.ts
- src/components/panels/flashboard/useFlashBoardChatController.ts
- src/components/panels/flashboard/useFlashBoardElevenLabsController.ts
- src/components/panels/flashboard/FlashBoardGenerationRequestPlanner.ts
- src/components/panels/flashboard/FlashBoardComposerSyncPlanner.ts
- src/components/panels/flashboard/FlashBoardProviderTransitionPlanner.ts
Allowed write set:
- docs/ongoing/Complete-refactor-checklist.md
- docs/ongoing/complete-refactor/execution-queue-and-lanes.md
Forbidden files:
- src/**
- tests/**
- package.json
- package-lock.json
- vite.config.*
- tsconfig*.json
- docs/Features/**
- docs/completed/**
Current contract: `P4-FLASHBOARD-ACTIVE-PROMPT-REFINE-CONTROLLER-HOOK-SPLIT-138`
completed the prompt-refine controller extraction. Composer remains over the
700 LOC product-source ceiling at 1298 LOC. Known remaining clusters include
provider transition, composer sync, generation request/submit, Suno tuning,
validation warnings, reference command/drop consumers, and JSX assembly.
Target contract: no source edits. Produce the smallest next packet definition
with explicit lane, write set, forbidden files, gates, and checks. Prefer the
next split only when the scan shows a coherent boundary that reduces coupling
without creating a generic helper/dumping-ground module. Timeline, Media Board,
stores, services, project schema, render, export, preview, and media runtime
remain protected unless the packet explicitly opens an integration write set.
Expected gates:
- P4_FLASHBOARD_ACTIVE_CONTRACT
- P4_FLASHBOARD_COMPOSER_MODULE_TREE
Expected checks:
- LOC/readability snapshot for `FlashBoardComposer.tsx` and
  adjacent FlashBoard role modules
- rg -n "submitFlashBoardActiveGenerationRequest|buildFlashBoardGenerationRequest|buildFlashBoardComposerSyncPatch|buildFlashBoardProviderTransition|handleProviderChange|handleGenerate|resetSunoTuning|audioValidationError|backendValidationError|seedanceReferenceValidationError" src/components/panels/flashboard/FlashBoardComposer.tsx
- rg -n "return \\(|<FlashBoard|renderedPopover|FlashBoardGenerationControls|FlashBoardChatControls|FlashBoardActionStack" src/components/panels/flashboard/FlashBoardComposer.tsx
- rg -n "FlashBoardPromptRefiner|FlashBoardPromptRefinePlanner|refineFlashBoardPromptHosted|streamRefineFlashBoardPrompt|promptRefineAbortRef|promptBeforeAiRewrite|sunoBeforeAiRewrite" src/components/panels/flashboard/FlashBoardComposer.tsx src/components/panels/flashboard/useFlashBoardPromptRefineController.ts
- git diff --check
- fc.exe /b AGENTS.md CLAUDE.md
Expected report:
- remaining Composer cluster classification and recommended next packet
- whether the next source packet should target submit/provider/sync, Suno
  local state, JSX/view assembly, or stop for a broader boundary
- current LOC snapshot and any over-budget adjacent modules
Stop conditions:
- the scan shows the next split needs store, service, project schema, Media
  Board, Timeline, render, export, preview, or media runtime ownership
```

## Queued Packets

No future source packet is currently queued. Define it only after
`P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-139` reports
its result.

## Immediate Next Step

Execute
`P4-FLASHBOARD-ACTIVE-COMPOSER-REMAINING-BOUNDARY-PREFLIGHT-139` as the next
bounded packet.

Constraints:

1. Do not edit source files.
2. Keep the queue lean: active packet plus only the minimal next packet if the
   scan proves one.
3. Do not open Timeline, Media Board, stores, services, project schema, render,
   export, preview, or media runtime write sets from this preflight.
