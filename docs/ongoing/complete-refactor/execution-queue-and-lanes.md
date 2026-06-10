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

- FlashBoard Composer controller-hook wave completed through
  `P4-FLASHBOARD-ACTIVE-REFERENCE-CONTROLLER-HOOK-SPLIT-144` (prompt-refine,
  chat, ElevenLabs, generation-flow, prompt/Suno, and reference/Seedance
  controller hooks; preflights 139/141/143). Per-packet detail lives in the
  checklist. `FlashBoardComposer.tsx` is 951 LOC.
- Wave 1 foundation/type slice completed:
  `P1-TYPES-BARREL-ROLE-SPLIT-145`; `src/types/index.ts` is now a 550-line
  compatibility facade over 11 role modules.
- Wave 1 signal scout completed:
  `P1B-SIGNAL-INTEGRATION-SCOUT-146`; follow-up gaps are timeline drop,
  media-biased pickers, JSON provider, and mobile signal handling.
- Wave 1 MediaPanel slice completed:
  `P4-MEDIA-PANEL-RESUME-SPLIT-147`; classic-list planning moved to
  `classicListPlanning.ts`, reducing `MediaPanel.tsx` to 4396 raw lines.
- Wave 1 JSON signal provider completed:
  `P1B-SIGNAL-JSON-PROVIDER-148`; JSON/JSONL import is concrete signal support,
  invalid JSON falls through to enriched binary diagnostics.
- Wave 1 import surface completed:
  `P1B-SIGNAL-IMPORT-SURFACE-149`; desktop pickers and Media Panel import
  surfaces accept any file while preserving the universal import route.
- Wave 2 timeline file-drop integration completed:
  `P1B-SIGNAL-TIMELINE-FILE-DROP-151`; CSV/JSON/unknown-binary direct timeline
  drops now route through universal signal import and place via
  `addSignalAssetClip`, while known-media placement stays unchanged.
- Wave 2 MediaPanel continuation completed:
  `P4-MEDIA-PANEL-SPLIT-152`; search/filter project-item derived state moved to
  `useMediaPanelProjectItems.ts`, reducing `MediaPanel.tsx` and adding no store
  or FlashBoard coupling.
- Wave 2 mobile signal surface completed:
  `P1B-SIGNAL-MOBILE-SURFACE-153`; mobile import/list/tap placement now handles
  signal assets through `MobileMediaPanel.tsx` only, with existing-video-track
  placement as the known limitation.
- Wave 3 stress-test rename completed:
  `RENAME-STRESS-TEST-155`; the old legacy feature name is gone repo-wide
  across 96 occurrences / 20 files, including filenames, scripts, fixtures,
  npm scripts, tool ids, flags, and docs/changelog prose.
- Wave 3 P1A media-runtime contracts completed:
  `P1A-MEDIA-RUNTIME-CONTRACTS-156`; `RuntimeSourceId`, `MediaAssetRef`,
  runtime-free `TimelineSourceRef`, and `MediaRuntimeLease<RuntimeHandles>` are
  defined, re-exported, tested, and mapped to first migration packets.
- Wave 3 MediaPanel continuation completed:
  `P4-MEDIA-PANEL-SPLIT-157`; drag/drop/marquee control moved to
  `useMediaPanelDragDropMarquee.ts`, reducing `MediaPanel.tsx` to about 3950
  raw lines / 3572 non-blank lines.
- Wave 3 runtime gates closed:
  Universal Signal end-to-end AI-bridge smoke passed in the real browser, and
  the P4 FlashBoard lane exit gate closed with zero console errors/log
  anomalies plus previously verified active-generation integration suites.
- Wave 4 type-barrel closure completed:
  `P1-TYPES-BARREL-THIN-159`; `src/types/index.ts` is now a 133-raw-line
  re-export facade under the 150-line target, with role clusters in
  `mediaSequences.ts`, `layers.ts`, `project.ts`, and `timeline.ts`.
- Wave 4 orchestrator ratchet completed:
  `foundationTypeBoundaryBaselines.globalTypesIndexRawLines` ratcheted 1194 ->
  150; the type-barrel goal criterion is met.
- Wave 4 P1A object-url lease migration completed:
  `P1A-OBJECTURL-LEASE-MIGRATION-160`; HMR-safe
  `mediaRuntimeObjectUrlLeaseOwner` owns `RuntimeSourceId` object-URL leases,
  and `blobUrlManager.ts` is a delegating compatibility facade with the same
  exported API.
- Wave 4 MediaPanel continuation completed:
  `P4-MEDIA-PANEL-SPLIT-161`; view-mode transition/reveal control moved to
  `useMediaPanelViewTransition.ts`, reducing `MediaPanel.tsx` from 3974 to
  3644 raw lines.
- Wave 4 P2 freeze blueprint completed:
  `P2-GETSTATE-CLASSIFICATION-SCOUT-162`; accepted the render-path/module-scope
  hard-target list, allowed-adapter proposal, runtime lease owner-map
  extension, store split candidates, and five proposed P2 packets. Formal
  hardening remains `P2-GETSTATE-ADAPTER-FREEZE`.
- Wave 4 FlashBoard CSS budget split completed:
  `P4-FLASHBOARD-CONTROLS-CSS-SPLIT-163`; split chat controls into
  `FlashBoardChatControls.css`, preserving all 76 unique class selectors and
  cascade order.
- P2 getState adapter freeze completed:
  `P2-GETSTATE-ADAPTER-FREEZE-167`; executable policy now has 20 allowed
  adapter paths and 177 hard-target files frozen at 669 current hits. The guard
  fails unknown non-adapter access and hard-target ceiling increases.
- Wave 6 closure completed:
  `P5P6-RENDER-CONTRACTS-170` created runtime-handle-free render snapshot,
  target snapshot, output-router, and export-session contracts with tests;
  `P2-DOCKSTORE-SPLIT-171` converted `dockStore.ts` into
  `src/stores/dockStore/` while preserving the byte-identical persist partialize
  block; `P4-MEDIA-PANEL-SPLIT-172` extracted context/relink/badge/item wiring
  and reduced `MediaPanel.tsx` to 2829 raw lines.
- Wave 6 orchestrator fixes completed:
  migrated the getState adapter grant from `dockStore.ts` to `dockStore/**`,
  updated class-(c) hard-target file count 177 -> 178, moved the
  `TimelineClipDataSource` registry evidence pointer from `src/types/index.ts`
  to `src/types/timeline.ts` after the sanctioned barrel move, and recorded the
  guard's first catch: two `getState()` hits redistributed from `MediaPanel` to
  the new badge hook with total count unchanged.
- Wave 6 verification:
  Orchestrator-verified: tsc clean; full suite 4144/4145 with one stale evidence pointer, fixed; registry + guards + render-contracts suites green (68 tests).
- Foreign-work note:
  audio-mixer SVG/CSS plus Audio-Workstation doc changes were already present
  outside packet ownership and were included in commit `2ba29a04` to avoid
  loss; orchestrator rules now include a pre-commit foreign-file scan.
- Wave 7 closure completed:
  `P5P6-SNAPSHOT-FACTORIES-174` added render frame/target snapshot factories in
  `src/services/render` with an adapter-sanctioned policy grant
  (`src/services/render/**`, count 20 -> 21), handle-free descriptor mapping,
  and an orchestrator defensive slot-settings mapper; the live-store `setState`
  harness issue was fix-forwarded to `vi.mock` via codex session resume.
  `P2-HISTORYSTORE-SPLIT-175` converted `historyStore.ts` (1739) into a folder
  with `index.ts` (1042), `snapshotCloning` (294), `historyStoreTypes` (171),
  `historyNavigation` (155), and `projectHistoryPersistence` (156), with the
  71-test suite green and adapter/ownership registry entries following the
  folder. `P4-MEDIA-PANEL-SPLIT-176` extracted classic-list UI state (332),
  reduced `MediaPanel.tsx` to about 2954 raw lines, and avoided the
  store-binding wall to respect the `getState` guard.
- Wave 7 verification:
  Orchestrator-verified: tsc clean; factories + contracts + policy + registry + historyStore suites green.
- Wave 8 closure completed:
  `P5P6-OUTPUT-ROUTER-ADAPTER-177` added `RenderOutputRouterAdapter` (200) for
  all three dispatcher output paths with reviewed argument parity
  (om-preview slice remap, no-pipeline fallback clear, export canvas clear,
  cached-frame semantics); `RenderDispatcher` `getState` hits fell 16 -> 11,
  telemetry moved after routing frame-identically, and the accepted
  `RenderDispatcher` diff was 177 lines because the three blocks moved
  coherently. `P2-DOCKSTORE-ACTIONS-SPLIT-179` made `dockStore/index.ts`
  facade-only with action/layout modules and byte-identical persist shape.
  `P4-MEDIA-PANEL-SPLIT-178` extracted shell state (63) and source reveal (240)
  hooks, reducing `MediaPanel.tsx` to 2665 raw lines.
- Ratchet enforcement note:
  the full-suite boundary run caught type-barrel fan-in at 758 > 755; seven new
  barrel imports across wave files were redirected by the orchestrator to role
  modules (`colorCorrection`, `keyframes`, `timeline`, `audio`, `layers`,
  `timelineCore`), and the ratchet is green again. Timeline registry evidence
  pointer and getState policy redistribution events from wave 6 remain recorded
  there.
- Wave 8 verification:
  Orchestrator-verified: tsc clean; full-suite ratchet catch resolved; ratchet + historyStore + factory + router suites green.

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
| `src/stores/mediaStore/**`, `src/stores/historyStore/**`, `src/stores/dockStore/**`, `src/stores/renderTargetStore.ts` | `P2-STORE-RUNTIME-FREEZE-001` | read, scan | P2/P3 contract freeze accepted |
| `src/engine/**`, `src/components/preview/**`, `src/components/export/**` | later P5/P6 joint packets | read, smoke only | render snapshot/output-router contracts frozen |
| `src/services/aiTools/**` | later P7 smoke quarantine packets | read, smoke inventory only | Phase 0 smoke thresholds accepted |

## Active Packet

None. Waves 7-8 are complete; render freeze 3 of 5 is done.

## Queued Packets

- `ExportRenderSession` adoption (P5/P6 freeze packet 4).
- mediaStore `fileManageSlice` split.
- MediaPanel continuation.

## Immediate Next Step

Run the next eligible packet from the queued list: `ExportRenderSession`
adoption, mediaStore `fileManageSlice` split, or MediaPanel continuation.
