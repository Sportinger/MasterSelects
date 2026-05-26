# Guided Action Runtime Plan

[Back to Index](./README.md)

Long-term architecture plan for one shared runtime that can:

- visualize AI chat tool execution step by step
- drive interactive tutorials
- replay recent user or AI actions
- guide a user through workflows without making DOM clicks the source of truth
- provide deterministic, testable choreography for editing actions

This is not a throwaway overlay. It is the target interaction layer for explainable AI editing, guided learning, demo playback, and later action recording.

---

## 1. Core Principle

MasterSelects already has a strong semantic action layer through AI tools. The new runtime must preserve that:

- Tool calls and stores remain the source of truth.
- Visual mouse movement is presentation, not execution truth.
- Tutorials and AI replay use the same action model.
- UI targets are resolved through stable target identifiers, not fragile ad hoc selectors.
- Every guided step is interruptible, testable, and recoverable.
- The runtime should not require a full hand-authored script for every AI command. It should compose shared reveal, target, cursor, surface-interaction, execution, and validation primitives, with custom choreography only where a command family needs it.
- AI replay should normally lock real user input while the synthetic guided cursor is active. Only explicit controls such as cancel, skip, or emergency stop should remain available. Guided-user tutorials are the exception: they deliberately allow or require scoped real user input.

Example:

```ts
executeTool('setTransform', { clipId: 'clip-1', x: 240 })
```

is compiled into a guided sequence:

```ts
[
  { type: 'focusPanel', panel: 'timeline' },
  { type: 'moveCursorTo', target: { kind: 'timelineClip', clipId: 'clip-1' } },
  { type: 'clickVisual', target: { kind: 'timelineClip', clipId: 'clip-1' } },
  { type: 'selectClip', clipId: 'clip-1' },
  { type: 'focusPanel', panel: 'clip-properties' },
  { type: 'openPropertiesTab', tab: 'transform' },
  { type: 'moveCursorTo', target: { kind: 'propertyControl', property: 'position.x' } },
  { type: 'highlightTarget', target: { kind: 'propertyControl', property: 'position.x' } },
  { type: 'executeTool', tool: 'setTransform', args: { clipId: 'clip-1', x: 240 } },
  { type: 'confirmState', check: 'clipTransformUpdated' }
]
```

The real edit happens at `executeTool`. Everything around it explains and teaches the action.

---

## 2. Existing Code Anchors

Use these files as the integration points:

| Area | Current Files | Notes |
|---|---|---|
| AI chat loop | `src/components/panels/AIChatPanel.tsx` | Receives model tool calls and executes them. |
| Tool executor | `src/services/aiTools/index.ts` | Policy gate, history batching, `executeAITool`. |
| Batch tools | `src/services/aiTools/handlers/batch.ts` | Sequential action execution with shared undo batch. |
| Tool policies | `src/services/aiTools/policy/registry.ts` | Risk and caller permissions. |
| Existing AI feedback | `src/services/aiTools/aiFeedback.ts` | Panel/tab activation, preview flash, marker/keyframe events. |
| Timeline AI overlays | `src/components/timeline/components/AIActionOverlays.tsx` | Split glow, trim highlight, delete ghost. |
| Timeline feedback state | `src/stores/timeline/aiActionFeedbackSlice.ts` | Current transient overlay state. |
| Tutorial picker | `src/components/common/TutorialCampaignDialog.tsx` | Campaign selection UI. |
| Static tutorial overlay | `src/components/common/TutorialOverlay.tsx` | Spotlight, highlight ring, tooltip positioning. |
| Interactive tutorial stub | `src/components/common/tutorial/InteractiveTutorialOverlay.tsx` | Replacement target for guided runtime integration. |
| Tutorial definitions | `src/components/common/tutorialCampaigns.ts` | Current static campaigns. |

The new runtime should gradually absorb `aiFeedback.ts`, timeline AI overlays, and interactive tutorial stubs into one shared system.

---

## 3. Observed AI Tool-Call Patterns

The runtime should be designed around how the AI can actually call tools today.

### 3.1 Prompt And Tool Contract Signals

`AIChatPanel` sends the editor system prompt plus a current timeline summary. In OpenAI mode, the request includes the full `AI_TOOLS` list with `tool_choice: 'auto'`. In Lemonade mode, only a compact subset is exposed.

The editor prompt strongly shapes tool-call behavior:

- The model should assume the currently selected clip.
- The model should not ask clarification questions for normal editing tasks.
- The model should stay within the visible clip range.
- The model should use `executeBatch` for multiple editing operations.
- The model should prefer compound tools like `splitClipEvenly`, `splitClipAtTimes`, `reorderClips`, and `cutRangesFromClip` when they fit.
- The model should not call `getTimelineState` unless it needs refreshed IDs after edits because the timeline summary is already included.

This means the guided runtime should expect three main call shapes:

| Shape | Example | Guided Runtime Implication |
|---|---|---|
| Single atomic tool | `setTransform({ clipId, x })` | Compile through a family choreography. |
| Explicit batch | `executeBatch({ actions: [...] })` | Unroll visually, keep one undo group. |
| Compound semantic tool | `addMask({ vertices: [...] })`, `splitClipAtTimes({ times: [...] })` | Visually decompose substeps, execute atomically or through controlled internal substeps. |

### 3.2 OpenAI And Lemonade Differences

OpenAI currently receives the full exported tool list, including masks, keyframes, media, transitions, tracks, preview capture, stats/debug, local file import, and node workspace tools.

Lemonade currently receives a smaller editing subset:

```text
getTimelineState, getClipDetails, getClipsInTimeRange,
selectClips, clearSelection, setPlayhead, setInOutPoints,
splitClip, deleteClip, moveClip, trimClip, cutRangesFromClip,
getMediaItems, setTransform, listEffects, addEffect, updateEffect,
undo, redo, play, pause
```

So the first full guided-runtime coverage should prioritize the shared subset, then expand to masks/keyframes/media/transitions for OpenAI.

### 3.3 Command Families Instead Of One Script Per Tool

Do not build 79 separate long scripts. Group tools by choreography family:

| Family | Tools | Shared Choreography |
|---|---|---|
| Inspect | `getTimelineState`, `getClipDetails`, `getMediaItems`, `getMasks`, `listEffects` | Reveal relevant panel, spotlight result area, no edit. |
| Selection and navigation | `selectClips`, `clearSelection`, `setPlayhead`, `setInOutPoints`, `openComposition` | Timeline/media reveal, cursor move, visual click/drag, state validation. |
| Timeline edit | `splitClip`, `splitClipAtTimes`, `splitClipEvenly`, `trimClip`, `moveClip`, `deleteClip`, `cutRangesFromClip`, `reorderClips` | Clip reveal, time/edge/position gesture, timeline overlay, semantic execution. |
| Transform/property edit | `setTransform`, `setClipSpeed`, `updateEffect`, `updateMask` | Select clip, open Properties tab, highlight changed controls, execute, pulse values. |
| Creation | `createTrack`, `createComposition`, `createMediaFolder`, `addEffect`, `addTransition`, `addMarker` | Reveal creation surface, press relevant button/dropdown if useful, execute, highlight new item. |
| Mask/path edit | `addMask`, `addRectangleMask`, `addEllipseMask`, `addVertex`, `updateVertex`, `removeVertex`, `removeMask` | Select clip, open Masks tab, optionally resize panels, use mask toolbar, draw preview points/path, execute/validate. |
| Keyframes | `addKeyframe`, `removeKeyframe`, `getKeyframes` | Open Properties/curve/keyframe surface, pulse stopwatch/keyframe lane, execute/validate. |
| Media/import/download | `importLocalFiles`, `downloadAndImportVideo`, `moveMediaItems`, `renameMediaItem`, `deleteMediaItem` | Reveal Media/Download panel, show list/folder operation, execute, highlight result. |
| Playback/debug | `play`, `pause`, `captureFrame`, `getCutPreviewQuad`, `getStats`, `getPlaybackTrace` | Reveal Preview/Timeline/debug surface, run action, flash or show diagnostics. |

Custom choreography belongs at family level first. Individual tools only need overrides for truly unique behavior.

### 3.4 Compound Tool Visualization

Some AI tools are intentionally atomic because they are more reliable than many smaller calls. The guided runtime still needs to make them look understandable.

For example, the AI may call:

```ts
addMask({
  clipId,
  name: 'Face mask',
  vertices: [
    { x: 0.32, y: 0.18 },
    { x: 0.68, y: 0.22 },
    { x: 0.74, y: 0.72 },
    { x: 0.28, y: 0.70 }
  ],
  closed: true,
  feather: 20
})
```

The visual sequence should be:

```text
select clip
focus Preview and Properties
resize panel if Masks controls are cramped
open Masks tab
move cursor to Pen or mask tool
move cursor to preview point 1, click visual
move cursor to preview point 2, click visual
move cursor to preview point 3, click visual
move cursor to preview point 4, click visual
show close-path gesture
execute addMask once
highlight created mask in list and outline in preview
validate mask exists with expected vertex count
```

The edit can still be one semantic operation and one undo point. If a future tutorial needs every vertex insertion to be a real user step, it can use `addVertex` substeps or guided-user validation, but AI replay should not be forced to split a robust compound tool into fragile DOM clicks.

### 3.5 Detailed Mask Flow Requirements

Mask choreography must account for steps that are easy to forget:

- Ensure the clip is selected and primary selection is correct.
- Ensure the playhead is within the clip's visible range if preview context matters.
- Ensure Preview is visible enough to place normalized points.
- Ensure Properties is visible and Masks tab is mounted.
- Optionally resize the right panel or preview area if controls/canvas are too cramped.
- Choose the correct mask surface: rectangle, ellipse, pen/custom path, edit path.
- For custom vertices, map normalized 0-1 coordinates to the visible preview canvas.
- Show point placement, bezier handles if supplied, and close-path gesture if `closed !== false`.
- Execute the semantic tool at the correct point in the sequence.
- Activate the created mask, show outline, and validate vertex count/properties.

---

## 4. Target Architecture

### 4.1 New Source Layout

```text
src/services/guidedActions/
  index.ts
  types.ts
  runtime.ts
  scheduler.ts
  compiler.ts
  targetRegistry.ts
  surfaceInteractionDriver.ts
  targetResolvers/
    domTargets.ts
    dockTargets.ts
    surfaceTargets.ts
    timelineTargets.ts
    previewTargets.ts
    propertiesTargets.ts
    mediaTargets.ts
  choreography/
    aiToolChoreography.ts
    timelineChoreography.ts
    transformChoreography.ts
    maskChoreography.ts
    effectsChoreography.ts
    keyframeChoreography.ts
    mediaChoreography.ts
  scenarios/
    tutorialScenarioCompiler.ts
    validation.ts
    recording.ts

src/stores/guidedActionStore.ts

src/components/guidedActions/
  GuidedActionOverlay.tsx
  GuidedCursor.tsx
  GuidedSpotlight.tsx
  GuidedCallout.tsx
  GuidedTargetHighlight.tsx
  GuidedStepHud.tsx
  GuidedActionOverlay.css

src/components/common/tutorial/
  InteractiveTutorialOverlay.tsx
  interactiveCampaigns.ts
```

### 4.2 Main Concepts

| Concept | Purpose |
|---|---|
| `GuidedSession` | One active AI replay, tutorial, demo, or recorded replay. |
| `GuidedAction` | A low-level visual or semantic step. |
| `GuidedTargetRef` | Stable target identifier such as timeline clip, tab, property control, preview point. |
| `TargetResolver` | Converts a `GuidedTargetRef` into a viewport rect or point at runtime. |
| `ToolChoreography` | Converts an AI tool call into guided actions. |
| `GuidedScenario` | Tutorial/demo script made from the same guided action primitives. |
| `ValidationCheck` | Store-based confirmation that a guided step succeeded. |
| `SurfaceInteraction` | A user-visible UI operation such as resizing a panel, pressing a button, opening a dropdown, choosing a menu option, scrolling, dragging, or placing canvas points. |
| `AnimationBudget` | Persistent user setting that caps the total visual duration for a whole guided AI response or tutorial step group. |
| `GuidedExecutionContext` | Scoped execution state for one guided run: session id, caller, abort signal, visualization mode, legacy feedback policy, and input policy. |
| `SurfaceExecutionPolicy` | Declares whether a surface action is visual-only, transient UI, persisted UI, or semantic tool execution. |
| `InputLockPolicy` | Controls whether real user pointer/keyboard input is blocked, passed through, or allowed only for specific targets. |
| `SemanticExecutionAdapter` | Runtime bridge that preserves policy, history, batch semantics, and tool result contracts while guided visualization observes or wraps execution. |
| `PlaybackMode` | `aiReplay`, `tutorialDemo`, `guidedUser`, `assist`, `recordingReplay`, `debug`. |

### 4.3 Contract Sketch

The shared contract should be additive and stable early, so parallel agents can work independently.

```ts
export type GuidedPlaybackMode =
  | 'aiReplay'
  | 'tutorialDemo'
  | 'guidedUser'
  | 'assist'
  | 'recordingReplay'
  | 'debug';

export interface GuidedAnimationBudget {
  totalMs: number;          // Persistent user setting, 0-10000ms.
  disabled: boolean;        // true when totalMs === 0.
  compression: 'none' | 'family' | 'aggressive';
}

export type GuidedLegacyFeedbackMode = 'off' | 'bridge' | 'native';

export type GuidedInputLockPolicy =
  | { mode: 'locked'; allowCancel: true }
  | { mode: 'passthrough' }
  | { mode: 'targetOnly'; targets: GuidedTargetRef[] };

export type SurfaceExecutionPolicy =
  | 'visualOnly'    // show cursor/gesture only
  | 'transientUi'   // change temporary UI state, restore if needed
  | 'persistUi'     // intentionally persist UI state, e.g. layout tutorial
  | 'semanticTool'; // real edit happens through tool/store execution

export interface GuidedExecutionContext {
  sessionId: string;
  callerContext: CallerContext;
  playbackMode: GuidedPlaybackMode;
  visualizationMode: 'off' | 'concise' | 'full';
  animationBudget: GuidedAnimationBudget;
  inputLock: GuidedInputLockPolicy;
  legacyFeedback: GuidedLegacyFeedbackMode;
  abortSignal: AbortSignal;
}

export type GuidedTargetRef =
  | { kind: 'dom'; id: string }
  | { kind: 'panel'; panel: PanelType }
  | { kind: 'panelEdge'; groupId: string; edge: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'button'; id: string }
  | { kind: 'dropdown'; id: string }
  | { kind: 'dropdownOption'; dropdownId: string; value: string }
  | { kind: 'menuItem'; menuId: string; itemId: string }
  | { kind: 'propertiesTab'; tab: string }
  | { kind: 'propertyControl'; property: string; clipId?: string }
  | { kind: 'timelineClip'; clipId: string }
  | { kind: 'timelineTime'; trackId?: string; time: number }
  | { kind: 'previewPoint'; x: number; y: number }
  | { kind: 'previewPathVertex'; x: number; y: number; index: number }
  | { kind: 'maskToolbarButton'; button: 'pen' | 'rectangle' | 'ellipse' | 'edit' }
  | { kind: 'mediaItem'; itemId: string };

export type GuidedAction =
  | { type: 'delay'; ms: number }
  | { type: 'resolveTarget'; target: GuidedTargetRef; required?: boolean }
  | { type: 'moveCursorTo'; target: GuidedTargetRef; durationMs?: number }
  | { type: 'dragCursor'; from: GuidedTargetRef; to: GuidedTargetRef; durationMs?: number }
  | { type: 'clickVisual'; target?: GuidedTargetRef }
  | { type: 'doubleClickVisual'; target?: GuidedTargetRef }
  | { type: 'highlightTarget'; target: GuidedTargetRef; tone?: GuidedTone; durationMs?: number }
  | { type: 'spotlight'; target: GuidedTargetRef | null }
  | { type: 'callout'; title: string; body?: string; target?: GuidedTargetRef }
  | { type: 'scrollIntoView'; target: GuidedTargetRef; block?: 'start' | 'center' | 'end' | 'nearest' }
  | { type: 'focusPanel'; panel: PanelType }
  | { type: 'resizePanel'; groupId: string; ratio: number; visualTarget?: GuidedTargetRef; policy?: SurfaceExecutionPolicy }
  | { type: 'openPropertiesTab'; tab: string }
  | { type: 'pressButton'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy }
  | { type: 'openDropdown'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy }
  | { type: 'chooseDropdownOption'; target: GuidedTargetRef; policy?: SurfaceExecutionPolicy }
  | { type: 'typeInto'; target: GuidedTargetRef; text: string; policy?: SurfaceExecutionPolicy }
  | { type: 'drawPreviewPath'; points: Array<{ x: number; y: number }>; close?: boolean; policy?: SurfaceExecutionPolicy }
  | { type: 'selectClip'; clipId: string }
  | { type: 'setPlayheadVisual'; time: number }
  | { type: 'executeTool'; tool: string; args: Record<string, unknown> }
  | { type: 'confirmState'; check: ValidationCheck }
  | { type: 'waitForUserAction'; check: ValidationCheck; timeoutMs?: number };
```

### 4.4 Choreography Composition Model

Do not write one huge bespoke script per AI tool. Build choreography in layers:

| Layer | Examples | Reuse |
|---|---|---|
| Context reveal | activate Timeline, open Properties, open Media, ensure Preview visible | reused by almost every flow |
| Entity reveal | select clip, scroll to media item, move playhead to time, reveal active mask | reused by command families |
| Surface operation | click button, open dropdown, drag panel edge, type value, draw canvas points | reused by AI replay and tutorials |
| Semantic execution | `executeTool('setTransform', args)` | one real source of truth for AI edits |
| Result feedback | pulse value, split glow, preview flash, mask outline, keyframe flash | reused by tool family |
| Validation | store-state checks, target-mounted checks, user-action checks | reused by tutorials and AI result confirmation |

Every AI tool should have at least a generic family mapping, but only important command families need detailed custom choreography. For example, most property updates can share the "reveal clip -> open tab -> highlight control -> execute -> pulse changed values" pattern.

### 4.5 Animation Budget And Repeated Action Compression

Guided AI replay must use a total animation budget, not fixed delays per tool. The user setting should be persistent and exposed as a slider from `0s` to `10s`.

Rules:

- `0s` means instant execution: no cursor, no spotlight, no callout, no visual delay. Semantic tools run normally.
- Values above `0s` cap the total visual runtime for all tool calls produced by one AI response.
- `executeBatch` and compound tools consume the same total budget as ordinary tool-call sequences.
- The scheduler must scale durations to fit the selected total budget.
- The scheduler must compress repeated equivalent actions instead of giving each one the same full spacing.

Compression examples:

| Tool Pattern | Visual Behavior |
|---|---|
| One `setTransform` | Full reveal, cursor movement, control highlight, value pulse. |
| Ten `splitClip` calls | First cut gets full context reveal; remaining cuts use faster cursor hops and split glows. |
| `splitClipAtTimes({ times: [...] })` | One clip reveal, then rapid timeline tick/glow sequence across all split times. |
| `addMask({ vertices: [...] })` | One mask tool reveal, then point clicks distributed across remaining budget. |
| Many same-property `addKeyframe` calls | One property-row reveal, then rapid keyframe diamonds/pulses. |

Suggested scheduling model:

```text
1. Compile semantic tool calls into detailed guided actions.
2. Group consecutive actions by choreography family and semantic target.
3. Mark setup/reveal steps as shared within each group.
4. Assign minimum time to required result feedback and validation.
5. Distribute remaining time by group weight.
6. Compress repeated same-family operations with a curve:
   first item = detailed
   items 2-5 = medium
   items 6+ = rapid pulse/marker-only
7. If budget is too small, drop optional cursor/callout steps before dropping result feedback.
```

The runtime should expose scheduler diagnostics in dev mode:

```ts
{
  requestedBudgetMs: 4000,
  plannedDurationMs: 3980,
  droppedOptionalSteps: 12,
  compressedGroups: [
    { family: 'timeline.split', count: 32, mode: 'rapid' }
  ]
}
```

### 4.6 Surface Interaction Driver

The runtime also needs to show everything a user could naturally do in the UI:

- resize dock panels by dragging split edges
- switch tabs and activate panels
- press buttons and icon buttons
- open dropdowns and menus
- choose dropdown/menu options
- scroll panels and lists
- drag sliders, number fields, timeline clips, keyframes, trim edges, and playhead
- type into text inputs
- place preview/canvas points for masks and segmentation
- draw paths, rectangles, ellipses, and other canvas gestures

For AI replay, these operations are usually visual unless they represent UI-only state such as panel size or dropdown open state. For tutorials, the same operations can be either demo-only or real user-driven interactions validated afterward.

Important distinction:

- **Semantic editing tools** such as `setTransform`, `splitClip`, `addMask`, and `addEffect` should still execute through AI tools/stores.
- **Surface-only UI actions** such as resizing a panel, opening a dropdown, or switching a tab can execute through UI/store APIs because the UI state itself is the intended result.
- **Tutorial input steps** can wait for real user pointer/keyboard actions, then validate store/UI state.

Every surface action must declare an execution policy:

| Policy | Meaning | Example |
|---|---|---|
| `visualOnly` | Show the synthetic gesture only; do not change real UI state. | Show a cursor dragging a panel edge as explanatory motion. |
| `transientUi` | Temporarily change UI state for visibility, restore or allow normal layout persistence rules afterward. | Temporarily widen Properties so a mask control is visible during AI replay. |
| `persistUi` | Intentionally persist UI state because the workflow is about UI/layout editing. | Tutorial teaches the user how to resize a dock panel. |
| `semanticTool` | Gesture explains the action, but the actual edit happens through an AI tool/store call. | Draw mask points visually, then execute `addMask`. |

AI replay should default to `visualOnly` or `semanticTool`. It should not permanently resize panels, change layout, or select dropdown values unless that is the explicit semantic action. Tutorials may use `transientUi` or `persistUi` depending on the lesson.

### 4.7 Input Lock And Synthetic Cursor

During AI replay, the visible cursor is the guided synthetic cursor. Real user pointer and keyboard input should be locked by default to prevent the user from racing the animation or changing state mid-tool execution.

Input modes:

| Mode | Behavior | Use |
|---|---|---|
| `locked` | Overlay blocks pointer/keyboard input except cancel/skip/emergency controls. | Default AI replay and demo playback. |
| `passthrough` | Overlay is informational and does not block app interaction. | Non-critical hints and diagnostics. |
| `targetOnly` | Only specific targets accept real user input; everything else is blocked. | Guided-user tutorials where the user must click or drag one thing. |

Requirements:

- The synthetic cursor must look distinct from the OS cursor.
- The OS cursor should not be hidden globally; instead, the overlay communicates that the app is in replay mode.
- AI replay must expose a visible Cancel/Skip affordance and support Escape.
- Cancel before the semantic execution point skips the tool and returns a deterministic tool result.
- Cancel after a semantic execution point does not silently undo; the user can use normal undo.
- Guided-user tutorial steps should dim or hide the synthetic cursor when waiting for real user input.

### 4.8 Semantic Execution Adapter

The guided runtime needs an execution adapter between visual replay and the existing tool dispatcher.

Responsibilities:

- Preserve `executeAITool` policy checks and caller restrictions.
- Preserve `executeBatch` as one undo group.
- Provide hooks for visual replay: `beforeAction`, `afterAction`, `onResult`, `onError`.
- Support abort/cancel with deterministic tool results.
- Suppress, bridge, or delegate legacy `aiFeedback` so visual feedback is not duplicated.
- Keep devBridge/console/native-helper calls fast and non-visual unless visualization is explicitly requested.

For `executeBatch`, do not unroll subactions into separate public `executeAITool` calls. Extract or introduce a batch core that can execute subactions once, with hooks, while preserving the current result shape and undo semantics.

Legacy feedback modes:

| Mode | Meaning |
|---|---|
| `native` | Existing handler feedback runs as it does today. |
| `bridge` | Existing handler feedback is routed into guided runtime events where possible. |
| `off` | Existing handler feedback is suppressed because guided replay owns the visuals. |

---

## 5. Parallel Agent Workstreams

Each stream below is intended to be owned by a different agent. Agents should avoid editing files outside their assigned stream unless the contract explicitly requires it.

### Stream A: Core Runtime And Store

**Owner scope**

- `src/services/guidedActions/types.ts`
- `src/services/guidedActions/runtime.ts`
- `src/services/guidedActions/scheduler.ts`
- `src/services/guidedActions/index.ts`
- `src/stores/guidedActionStore.ts`

**Responsibilities**

- Define shared types.
- Implement session lifecycle: start, pause, resume, cancel, finish.
- Implement step scheduler with async execution and cancellation tokens.
- Expose read-only selectors for overlay components.
- Support speed multipliers and reduced-motion fallback.
- Enforce the persistent total animation budget for a whole guided session.
- Compress repeated same-family actions so large batches finish inside the selected budget.
- Model `GuidedExecutionContext`, input lock state, cancellation, and one active guided session policy.

**Must not do**

- Do not hardcode AI tool mappings.
- Do not query DOM directly except through injected target registry APIs.
- Do not mutate timeline/media stores except through guided action executors.

**Acceptance**

- A synthetic session with cursor move, delay, highlight, and cancel can run without AI.
- Cancel stops pending timers and clears transient overlay state.
- Store state remains serializable except for explicitly internal runtime handles.
- `totalMs: 0` executes semantic actions instantly and produces no overlay.
- A batch with many repeated split actions is compressed into the selected total duration.
- AI replay sessions default to locked input with Cancel/Escape available.

**Dependencies**

- None. This stream should land first.

---

### Stream B: Global Overlay UI

**Owner scope**

- `src/components/guidedActions/*`
- root app integration point where global overlays are mounted
- optional reuse of tutorial overlay CSS after cleanup

**Responsibilities**

- Render fake cursor.
- Render click ripple.
- Render spotlight mask.
- Render target highlight ring.
- Render callout / step HUD.
- Respect reduced motion and small viewport constraints.
- Keep overlay pointer-events safe.
- Implement input-lock presentation: locked, passthrough, and target-only.
- Render a synthetic cursor that is visually distinct from the OS cursor.
- Provide visible Cancel/Skip affordance for locked replay sessions.

**Must not do**

- Do not perform edits.
- Do not resolve app-specific target semantics; consume resolved rects from the store/runtime.

**Acceptance**

- Overlay can render with no target, one target, or moving cursor.
- Text never blocks target resolution or causes layout shifts in editor panels.
- Cursor and highlight stay aligned during window resize.
- Locked mode blocks app pointer/keyboard interaction except Cancel/Escape.
- Target-only mode permits interaction only on registered allowed targets.

**Dependencies**

- Stream A contracts.

---

### Stream C: Target Registry And UI Instrumentation

**Owner scope**

- `src/services/guidedActions/targetRegistry.ts`
- `src/services/guidedActions/targetResolvers/*`
- minimal `data-guided-target` attributes across UI surfaces
- typed React registration/provider helpers for surfaces that cannot be resolved from static DOM attributes

**Responsibilities**

- Resolve stable targets into viewport coordinates.
- Provide fallback behavior when a target is currently hidden.
- Add stable attributes to properties tabs, transform controls, mask toolbar buttons, effect stack controls, media items, and major panel containers.
- Resolve timeline targets from store state plus current timeline zoom/scroll.
- Resolve preview normalized points into viewport points.
- Provide geometry providers for timeline time/track positions, preview normalized points, Properties controls, and offscreen/virtual surfaces.

**Must not do**

- Do not run guided sessions.
- Do not duplicate business logic from stores.
- Do not rely on text labels for target lookup.

**Acceptance**

- `panel`, `propertiesTab`, `propertyControl`, `timelineClip`, `timelineTime`, `previewPoint`, and `maskToolbarButton` targets resolve in a loaded project.
- Hidden target returns a structured `missing` reason and suggested activation action.
- Target resolution is deterministic in tests.
- Timeline handles, marker targets, keyframe ticks, preview path points, and mask vertices/handles have first-class target refs or provider-backed fallbacks.

**Dependencies**

- Stream A types.
- Can proceed in parallel with Stream B.

---

### Stream D: AI Tool Choreography Compiler

**Owner scope**

- `src/services/guidedActions/compiler.ts`
- `src/services/guidedActions/choreography/*`

**Responsibilities**

- Convert AI tool calls into guided action arrays.
- Provide default choreography and per-tool overrides.
- Cover timeline, transform, masks, effects, keyframes, media, preview, playback.
- Normalize nested `executeBatch.actions[]` into visible substeps.
- Annotate compiled actions with family/group metadata for scheduler compression.
- Add state confirmations for important edits.

**Initial tool coverage**

- `selectClips`
- `setTransform`
- `splitClip`
- `splitClipEvenly`
- `splitClipAtTimes`
- `trimClip`
- `moveClip`
- `deleteClip`
- `addRectangleMask`
- `addEllipseMask`
- `addMask`
- `updateMask`
- `addEffect`
- `updateEffect`
- `addKeyframe`
- `captureFrame`
- `importLocalFiles`

**Must not do**

- Do not change AI prompts as a substitute for deterministic choreography.
- Do not ask the model to emit UI steps.

**Acceptance**

- Every supported tool compiles to guided actions with one clear execution point.
- Unsupported tools still get a generic "executing tool" visual instead of failing.
- Tool compile does not mutate app state.

**Dependencies**

- Stream A contracts.
- Stream C target refs for meaningful target choices.
- Stream K surface primitives for button, dropdown, resize, drag, and canvas gestures.

---

### Stream K: Surface Interaction Driver

**Owner scope**

- `src/services/guidedActions/surfaceInteractionDriver.ts`
- surface-related action handlers in `src/services/guidedActions/runtime.ts`
- shared helpers for simulated cursor gestures that may optionally execute UI/store actions
- target resolver additions for buttons, dropdowns, menus, panel edges, sliders, number fields, and canvas points

**Responsibilities**

- Implement user-visible operations that look like real UI usage:
  - panel edge resize
  - button/icon-button press
  - dropdown open and option selection
  - menu open and item selection
  - scroll-to-target and list scrolling
  - drag gestures for sliders, playhead, timeline clips, trim edges, keyframes, and panel splits
  - text input typing
  - preview/canvas point placement and path drawing
- Separate visual-only gestures from real UI-state operations.
- Prefer high-level UI/store APIs for execution when the intended result is UI state.
- Provide a strict fallback when a surface operation cannot be executed safely.
- Enforce `SurfaceExecutionPolicy` for every surface action.
- Avoid native dropdown dependence by supporting ghost menus or controlled app popovers where native `<select>` cannot be addressed reliably.

**Must not do**

- Do not use raw DOM event simulation as the default source of truth for semantic edits.
- Do not bypass policy checks for AI editing tools.
- Do not couple surface interactions to one specific tutorial.

**Acceptance**

- A guided session can visually resize a dock split and optionally apply the new ratio.
- A guided session can visually open a dropdown and choose an option.
- A guided session can visually press a button and either execute the real action or only demonstrate it.
- A guided session can draw a path over the Preview without mutating masks unless a semantic action is executed.
- Surface operation failures produce structured diagnostics instead of hanging.
- Panel resize can run as `visualOnly`, `transientUi`, or `persistUi` with different persistence behavior.
- Native dropdowns either use a guided ghost menu or a controlled app popover path, not unreliable browser option DOM.

**Dependencies**

- Stream A contracts.
- Stream B overlay cursor/ripple.
- Stream C target resolution.

---

### Stream L: Semantic Execution Adapter

**Owner scope**

- `src/services/guidedActions/semanticExecutionAdapter.ts`
- shared execution context types in `src/services/guidedActions/types.ts`
- refactor seams in `src/services/aiTools/index.ts`
- batch core extraction from `src/services/aiTools/handlers/batch.ts`
- legacy feedback bridge/suppression path around `src/services/aiTools/aiFeedback.ts` and handler feedback calls

**Responsibilities**

- Introduce scoped `GuidedExecutionContext` or a compatible bridge for existing AI execution.
- Replace or wrap the global `isAIExecutionActive()` behavior with session-aware execution state.
- Extract a batch core that can execute subactions with hooks while preserving one undo group.
- Preserve policy checks, caller context, confirmation behavior, history batching, and tool result shape.
- Provide legacy feedback modes: `native`, `bridge`, `off`.
- Make `0s` instant mode set all legacy stagger/feedback delays to zero.
- Return deterministic results for cancellation and abort.

**Must not do**

- Do not execute `executeBatch.actions[]` as separate public `executeAITool` calls.
- Do not let guided visualization bypass policy checks or confirmation prompts.
- Do not make devBridge/console/native-helper calls visual by default.

**Acceptance**

- `executeBatch` can expose subaction hooks and still undo as one batch.
- Cancel before a semantic execution point returns a tool result and leaves state unchanged.
- Guided replay does not produce duplicate split glows, preview flashes, or tab jumps from legacy feedback.
- DevBridge/internal execution stays fast and non-visual unless explicitly requested.
- `0s` animation budget disables old stagger delays as well as new overlay animation.

**Dependencies**

- Stream A contracts.

---

### Stream E: AI Execution Integration

**Owner scope**

- `src/services/aiTools/index.ts`
- `src/services/aiTools/handlers/batch.ts`
- `src/components/panels/AIChatPanel.tsx`
- integration with `SemanticExecutionAdapter`

**Responsibilities**

- Route chat tool calls through guided runtime when enabled.
- Preserve policy enforcement and undo batching.
- Keep `executeAITool` usable by dev bridge, console, and internal callers.
- Ensure `executeBatch` can expose subactions visually while preserving one undo group.
- Add settings gate for guided visualization: off, concise, full.
- Plan guided sessions per `sendMessage` tool transaction, not only per individual assistant response, because OpenAI can emit multiple tool calls and tool-call turns.
- Keep Lemonade's smaller tool subset and one-tool-context behavior in mind.

**Must not do**

- Do not break the AI bridge request/response contract.
- Do not make external agents wait forever for visual playback.
- Do not require the app to be visible for devBridge execution unless visualization is requested.

**Acceptance**

- Existing AI tool calls still work with visualization disabled.
- With visualization enabled, `executeBatch` shows substeps and returns the same result shape.
- With a `0s` animation budget, tool calls execute immediately without visual replay.
- With many repeated tool calls, the guided session finishes within the persisted total animation budget.
- Confirmation prompts still happen before high-risk actions.
- Failed tools end the guided session with a visible error state and a normal tool result.
- Cancellation always results in a valid tool result for every pending tool call.

**Dependencies**

- Streams A, D, and L.
- Stream B for visible overlay.

---

### Stream F: Tutorial Scenario Runtime

**Owner scope**

- `src/components/common/tutorial/InteractiveTutorialOverlay.tsx`
- `src/components/common/tutorial/interactiveCampaigns.ts`
- `src/services/guidedActions/scenarios/tutorialScenarioCompiler.ts`
- migration adapters for `tutorialCampaigns.ts`

**Responsibilities**

- Replace the interactive tutorial stub with guided runtime sessions.
- Support tutorial modes:
  - demo: system performs the action visually
  - guided: user performs the action, runtime validates state
  - assist: user can ask the system to complete the step
- Reuse existing tutorial campaign picker.
- Migrate static spotlight campaigns through an adapter first, then add real interactive campaigns.

**Must not do**

- Do not create a separate tutorial-only cursor system.
- Do not duplicate target resolution.

**Acceptance**

- A tutorial campaign can start a guided session.
- Static campaign steps can still be shown.
- At least one interactive tutorial can validate a real store change.

**Dependencies**

- Streams A, B, C.
- Stream D optional for demo steps that reuse tool choreography.

---

### Stream G: Validation And State Checks

**Owner scope**

- `src/services/guidedActions/scenarios/validation.ts`
- validation helpers near relevant stores if needed

**Responsibilities**

- Define `ValidationCheck` types.
- Implement checks for:
  - clip selected
  - properties tab open
  - playhead at time
  - clip transform matches expected value
  - mask exists / active mask selected
  - effect exists / effect param changed
  - keyframe exists
  - media item imported
- Provide polling and event-based validation helpers.

**Must not do**

- Do not read DOM for semantic validation when store state exists.
- Do not make validation depend on animation timing.

**Acceptance**

- Checks are unit-testable without rendering the full app.
- Tutorial guided mode can wait for a user action and complete when state matches.

**Dependencies**

- Stream A contracts.

---

### Stream H: Authoring And Recording Layer

**Owner scope**

- `src/services/guidedActions/scenarios/recording.ts`
- optional developer-only panel/debug UI
- docs for authoring scenarios

**Responsibilities**

- Define a scenario authoring format.
- Provide a way to record user-visible semantic actions later.
- Support export/import of guided scenarios for tutorials.
- Provide debug dump of compiled guided actions.

**Must not do**

- Do not block the core runtime on recorder complexity.
- Do not record raw pointer movement as the authoritative action.

**Acceptance**

- A guided scenario can be represented as JSON/TS data.
- Compiled action list can be inspected in dev mode.

**Dependencies**

- Streams A and F.

---

### Stream I: Tests And Diagnostics

**Owner scope**

- unit tests for `src/services/guidedActions`
- Playwright/browser tests for overlay and target resolution
- docs/debug notes

**Responsibilities**

- Test scheduler cancellation.
- Test target resolver edge cases.
- Test choreography compile output.
- Test AI batch integration with visualization disabled and enabled.
- Add visual smoke tests for cursor, spotlight, and panel switching.

**Acceptance**

- `npm run test` covers pure runtime logic.
- UI smoke can verify a guided `setTransform -> addRectangleMask` sequence without checking pixel-perfect animation.
- Failure diagnostics identify missing targets by target ref.

**Dependencies**

- Streams A, B, C, D, E as they land.

---

### Stream J: Documentation, Settings, And Migration

**Owner scope**

- `docs/Features/Guided-Action-Runtime-Plan.md`
- `docs/Features/AI-Integration.md`
- `docs/Features/UI-Panels.md`
- `docs/Features/README.md`
- settings docs and optional UI labels

**Responsibilities**

- Keep docs aligned with implementation.
- Document settings for guided visualization.
- Document how AI replay differs from execution.
- Document tutorial authoring rules.
- Maintain migration notes from `aiFeedback.ts` and `TutorialOverlay.tsx`.

**Acceptance**

- README links the guided runtime plan/doc.
- Docs explain which features are implemented and which are still target architecture.

**Dependencies**

- Can start now, then update after implementation streams.

---

## 6. Agent Coordination Rules

Parallel agents should follow these rules:

1. Stream A owns shared runtime contracts. Other streams may request additive fields, but should avoid editing core types directly unless coordinated.
2. No stream should create another cursor, spotlight, or target system.
3. UI instrumentation should use stable `data-guided-target` attributes and typed resolver helpers.
4. Surface interactions should go through the shared surface interaction driver, not one-off DOM event scripts.
5. Tool choreography must call semantic actions for semantic edits, not DOM click handlers.
6. Tutorial code must consume the guided runtime, not fork it.
7. AI integration must keep visualization optional.
8. Batch execution must preserve one undo group.
9. Legacy AI feedback must be deliberately bridged or suppressed; double visual feedback is a bug.
10. AI replay should lock real user input unless explicitly configured otherwise.
11. Guided-user tutorials should use target-only or passthrough input, not global locked input.
12. Every stream should include at least one focused verification path.
13. Merge order should prioritize contracts before broad UI wiring.

Recommended merge order:

```text
A Core Runtime
  -> L Semantic Execution Adapter
  -> B Overlay UI
  -> C Target Registry
  -> K Surface Interaction Driver
  -> D Choreography Compiler
  -> G Validation
  -> E AI Integration
  -> F Tutorial Runtime
  -> H Authoring/Recording
  -> I Tests/Diagnostics throughout
  -> J Docs throughout
```

Streams B, C, G, J, K, and L can start immediately after Stream A's first contract commit. Stream D can start once the first target and surface primitives exist. Stream E should wait for Stream L's execution adapter contract.

---

## 7. Runtime Behavior Requirements

### AI Replay

- The user asks AI for an edit.
- AI emits tool calls as today.
- The app groups the full `sendMessage` tool transaction into a guided session when visualization is enabled.
- OpenAI may emit multiple tool calls in one assistant message and may continue for multiple tool-call turns; all of that shares one guided transaction budget.
- Lemonade usually has one tool-call phase with a smaller tool subset; the runtime should still use the same session contract.
- The input lock enters `locked` mode and the synthetic guided cursor becomes the visible replay cursor.
- The guided session executes visual steps and real tools.
- Chat receives normal tool results.
- User can cancel visual playback; cancellation should not leave half-open timers.
- If cancellation happens before the real tool execution point, the tool is skipped.
- If cancellation happens after a real tool execution point, the edit remains and undo handles rollback.
- The overlay blocks normal app interaction during AI replay except for Cancel/Skip/Escape.
- `0s` duration bypasses guided replay entirely and runs semantic tools immediately.

### Tutorial Demo

- Tutorial scenario starts a guided session.
- Runtime performs actions on a safe sample project or current project, depending on campaign definition.
- The user watches the same cursor/highlight language used by AI replay.

### Guided User Tutorial

- Runtime shows target, callout, and cursor hint.
- User performs the real action.
- Runtime validates store state.
- On success, scenario advances.
- On timeout, scenario can offer "show me" or "do it for me".
- Input lock uses `targetOnly` or `passthrough`; it must not globally block the action the user is supposed to perform.
- The synthetic cursor should dim or hide while waiting for real user input.

### Assist Mode

- User starts an action manually.
- Runtime recognizes partial progress.
- Runtime can complete remaining steps through semantic actions.
- Input policy depends on the current step: target-only while the user acts, locked while the system completes.

### Replay Mode

- Recent semantic actions can be replayed visually for explanation.
- This should use action logs, not raw pointer logs.

---

## 8. Target Resolution Strategy

Targets should be semantic first, DOM-backed second.

| Target | Resolver Strategy |
|---|---|
| `panel` | Dock store activates panel, DOM resolver finds panel group or active tab content. |
| `panelEdge` | Resolve dock split handle or panel group edge for visual drag and optional ratio update. |
| `button` | Resolve by stable `data-guided-target`, with optional safe click execution through registered handlers. |
| `dropdown` / `dropdownOption` | Resolve trigger and option rows after opening; support scrolling inside dropdowns. |
| `menuItem` | Resolve menu entry by stable menu/item ids, not visible text. |
| `propertiesTab` | Dispatch/open tab, then resolve tab button by stable target id. |
| `propertyControl` | Stable target id on control row or number field. |
| `timelineClip` | Resolve from timeline clip element by `data-clip-id`; fallback from timeline geometry. |
| `timelineTime` | Resolve from current timeline viewport, scroll, zoom, and track layout. |
| `timelineTrimHandle` / `timelineFadeHandle` | Resolve clip edge handles through first-class target refs, not CSS classes. |
| `timelineKeyframe` / `timelineMarker` | Resolve keyframe diamonds and markers through ids or provider geometry. |
| `previewPoint` | Resolve from preview canvas wrapper bounds and normalized coordinates. |
| `previewPathVertex` | Resolve normalized preview coordinates for path drawing, mask points, segmentation prompts, and tutorials. |
| `maskVertex` / `maskHandle` / `maskEdge` | Resolve mask SVG editing targets through `MaskOverlay` geometry/provider helpers. |
| `maskToolbarButton` | Stable target id in `MasksTab`. |
| `mediaItem` | Stable media item id target, with scroll-into-view support. |

For virtual or geometry-derived surfaces, prefer React/provider registration over static DOM attributes. Timeline, Preview, Properties, and MaskOverlay should register typed geometry providers so targets can be resolved even when the DOM shape changes.

Missing targets must return structured diagnostics:

```ts
{
  status: 'missing',
  target,
  reason: 'panel-hidden' | 'not-mounted' | 'offscreen' | 'entity-not-found',
  suggestedAction?: GuidedAction
}
```

---

## 9. Tool Choreography Rules

Each tool choreography should follow this order:

1. Context reveal: activate relevant panel or timeline.
2. Target reveal: move/scroll to relevant clip/control/time.
3. Intent cue: callout or highlight.
4. Real execution point.
5. Result cue: state highlight, preview flash, timeline overlay, or value pulse.
6. Optional validation.

### Example: `setTransform`

```text
select clip
open Properties
open Transform tab
highlight changed controls
execute setTransform
pulse updated values
flash preview subtly
confirm transform changed
```

### Example: `addMask`

```text
select clip
ensure Preview and Properties are usable
resize panel if the Masks controls are cramped or hidden
open Properties
open Masks tab
move cursor to mask tool or shape button
for custom vertices, move cursor to each preview point and show point placement
execute addMask/addRectangleMask/addEllipseMask
show preview outline and mask list highlight
confirm mask exists
```

### Example: `splitClip`

```text
focus Timeline
move cursor to clip
move cursor to split time
execute splitClip
show split glow
confirm two clips around split time
```

---

## 10. Settings And Feature Flags

Add a user-facing setting under AI or Tutorials:

| Setting | Values |
|---|---|
| AI action visualization | Off, Concise, Full |
| AI action animation duration | Persistent slider, `0s` to `10s`; `0s` disables visual replay and runs tools instantly |
| Repeated action compression | Auto by default; repeated same-family tool calls are accelerated to fit the total duration |
| Guided cursor speed | Derived from total budget by default; optional Slow, Normal, Fast override for tutorials |
| Tutorial assist mode | Ask, Auto, Off |
| Reduced motion | Respect system, Always reduce |
| Replay input lock | Locked by default for AI replay; optional passthrough only for advanced/debug use |

Persistence notes:

- Store this in `settingsStore` with the other AI/tutorial settings.
- Prefer a dedicated `AI & Guidance` or `Tutorials` settings section instead of burying these controls under General.
- The setting applies to a whole AI response, not each tool call.
- `executeBatch`, multiple assistant tool calls, and compound tools all share the same configured budget.
- The default should be long enough to explain simple actions without making batch edits feel slow, for example `3s`.
- The UI should show the zero state clearly as `Instant / no animation`.

Add a developer feature flag for staged integration:

```ts
guidedActionsRuntime: boolean
guidedActionsAIReplay: boolean
guidedActionsTutorials: boolean
guidedActionsRecorder: boolean
```

---

## 11. Failure Handling

The runtime must handle:

- missing clip or media item
- hidden panel or unmounted tab
- target outside current scroll viewport
- AI tool policy denial
- user cancellation
- real user input while AI replay is running
- tool failure after visual prelude
- validation timeout
- project closing while a session is active
- HMR during development
- native dropdowns that cannot expose option DOM reliably
- duplicate legacy and guided feedback firing for the same action

Failure state should be visible but not modal by default. The chat/tool result remains the authoritative error for AI calls.

---

## 12. Verification Matrix

| Scenario | Required Verification |
|---|---|
| Guided session starts and cancels | Unit test scheduler cancellation. |
| Cursor moves to known DOM target | Browser smoke. |
| Properties tab target opens | Browser smoke. |
| `setTransform` choreography | Unit compile test plus browser smoke. |
| `splitClip` choreography | Unit compile test plus store validation. |
| `addRectangleMask` choreography | Unit compile test plus store validation. |
| AI `executeBatch` visualization | Integration test or bridge smoke. |
| `0s` animation duration | Semantic tool executes, overlay never appears, no artificial delay. |
| Repeated split compression | Many split actions complete inside the configured total duration. |
| AI replay input lock | User cannot interact with editor controls during replay except Cancel/Escape. |
| Target-only tutorial input | Only expected target accepts input while the tutorial waits for the user. |
| Legacy feedback bridge | Guided replay produces no duplicate split glows, preview flashes, or tab jumps. |
| `executeBatch` adapter | Visual subaction hooks preserve one undo group and original result shape. |
| Static tutorial migration | Manual/browser smoke. |
| Interactive tutorial validation | Unit validation test plus browser smoke. |

Before committing implementation work:

```bash
npm run build
npm run lint
npm run test
```

During development, focused tests are acceptable, but the full checks remain required before commit.

---

## 13. Definition Of Done For The Full Vision

The system is complete when:

- AI chat tool calls can be replayed visually without changing their semantic contract.
- `executeBatch` actions are visible as understandable substeps and still undo as one unit.
- A persistent `0s-10s` total animation-duration slider controls the whole AI replay budget.
- `0s` is instant mode with no overlay or visual delay.
- Repeated same-family actions are compressed so large batches still finish inside the selected total duration.
- AI replay uses a visibly synthetic guided cursor and locks normal user input by default.
- Guided-user tutorials can selectively allow real user input through `targetOnly`/`passthrough` policies.
- A semantic execution adapter preserves batch, policy, confirmation, history, cancellation, and tool-result contracts.
- Existing legacy AI feedback is bridged or suppressed so guided replay does not double-render effects.
- Tutorials can run demo and guided-user modes through the same runtime.
- Target resolution is typed, stable, and test-covered.
- User-surface operations such as panel resizing, button presses, dropdowns, scrolling, dragging, typing, and preview point placement are represented as first-class guided actions.
- Existing ad hoc AI feedback is either migrated or explicitly bridged.
- The runtime can recover from cancellation and target failures.
- Scenario authors can define tutorials without touching runtime internals.
- Developers can inspect compiled guided actions for debugging.
- Documentation explains the architecture, settings, and authoring rules.
