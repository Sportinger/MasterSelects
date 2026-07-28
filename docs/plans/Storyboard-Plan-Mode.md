# AI Storyboard, Plan Mode, and Timeline Variants

Status: expanded draft (2026-07-28)<br>
Scope: public MasterSelects client. Kernel-side planning, prompting, and
candidate-ranking logic lives in the private kernel repository. This document
defines the client UX, persisted state, safety rules, and the public wire
contract the kernel may rely on.

## 1. Vision

The storyboard is not only a pre-cut outline for existing footage. It is the
directing surface for a video that may combine:

- existing source material;
- AI-generated stills and video;
- voice, music, and sound generation;
- conventional edits, effects, and transitions.

Each scene starts as a readable card on the real timeline. The card states what
the scene must achieve, what it should look and sound like, what evidence or
references support it, and how long it should be. It can later collect source
moments, visual concepts, generated video candidates, and accepted timeline
clips without losing the original intent.

The chat pill gains a Plan mode. In Plan mode the AI discusses and changes the
storyboard, but cannot silently edit real media or spend generation credits. A
separate decision policy controls how autonomous execution is:

- **Plan**: discuss structure, create/update scene cards, prompts, and briefs.
- **Co-direct**: build alternatives and pause at decisions so the user can
  compare, choose, combine, or request more options.
- **Execute**: use the existing verified edit path for actions the user has
  approved.

The defining interaction is:

> Mark a timeline range, say “I do not like this part; make three options,” and
> receive three range-scoped timeline variants. Scrub or play them, compare
> their reasoning and cost, choose one (or combine them), and apply the result
> to the main timeline as one undoable edit.

The full loop is:

**talk → storyboard → gather/generate candidates → compare variants → decide →
commit → verify**

The storyboard remains the durable contract throughout. It does not disappear
when the first media is generated or the first cut is accepted.

## 2. Architecture anchor points (as-is)

The current client already has most of the primitives, but they are not yet
connected as one directing workflow.

### 2.1 Chat and kernel execution

- Chat pill:
  `src/components/panels/flashboard/useFlashBoardChatController.ts` →
  `sendFlashBoardChatMessage` in
  `src/services/flashboard/FlashBoardChatService.ts`.
- Kernel-first cutover:
  `src/services/kernelClient/kernelChatGateway.ts`.
- The current verified path is compile → execute `resolvedCalls` through
  `executeAIToolCalls` inside an agent transaction → `/complete` fingerprint
  verification.
- The compile contract in `src/services/kernelClient/types.ts` currently
  supports mechanical/story execution and abort/failure responses. Planning,
  decisions, generation intents, and range variants need explicit response
  variants; they must not be disguised as ordinary synchronous tool calls.

### 2.2 Timeline selection and editing

- `TimelineClip` lives in `src/types/timeline.ts`; `TimelineSourceType` is in
  `src/types/timelineSource.ts`.
- Text and solid clips are precedents for file-less, freely trimmable sources
  (`src/components/timeline/utils/clipSourceTiming.ts`).
- A real range-selection model already exists:
  `TimelineRangeSelection { startTime, endTime, trackIds, anchorTrackId? }` in
  `src/stores/timeline/storeTypes/toolTypes.ts`.
- The visual overlay and store action already exist, but
  `handleGetTimelineState` currently exposes clip selection and in/out points,
  not `timelineRangeSelection`. The kernel therefore cannot yet address the
  exact range and track scope the user painted.
- Edit operations already support range work, batching, linked-clip policies,
  keyframes, transitions, and undo. A variant commit should use those
  primitives rather than mutate arrays directly.

### 2.3 AI generation

- FlashBoard already has a persisted asynchronous job model:
  `FlashBoardActiveGenerationRecord`, `FlashBoardGenerationOutput`, and
  `FlashBoardResult` in `src/stores/flashboardStore/types.ts`.
- `FlashBoardJobService.ts` owns provider submission, polling/resume,
  cancellation, and reference-media resolution.
- `FlashBoardMediaBridge.ts` downloads completed output, imports it as a
  project-local file under `AI Gen / Video`, `Images`, or `Audio`, writes
  generation metadata, and returns stable `mediaFileId` values.
- Generated results can already be dragged or inserted into the timeline.
- The missing piece is a stable association from a storyboard scene or variant
  option to its generation record, output, imported media, prompt revision,
  and decision state.

### 2.4 Compositions and history

- `duplicateComposition` already produces a timeline clone, and composition
  tabs can display alternatives.
- Current duplication deliberately strips transition-composition IDs. A
  production variant clone therefore needs its own clone/remap path if
  editable transition subcompositions must survive.
- The History panel already visualizes branches. Those branches are global
  project snapshots created when a redo path is abandoned. They are a useful
  safety net, but not the primary variant model:
  - they include unrelated project/media/FlashBoard state;
  - they cannot naturally show three alternatives at once;
  - they are not explicitly range- or track-scoped;
  - switching branches changes the whole project.

The recommended v1 implementation materializes options as temporary
compositions for playback while retaining an explicit range-scoped
`TimelineVariantSet` as the canonical comparison object.

## 3. Product model

### 3.1 Two independent controls

Do not overload one toggle with two meanings.

```ts
type ChatIntent = 'plan' | 'execute';
type DecisionPolicy = 'automatic' | 'milestones' | 'every-decision';
```

- The existing requested **Plan** chip controls `ChatIntent`.
- A small adjacent policy control (labelled e.g. “Co-direct”) controls how
  often the AI must pause.
- Recommended default:
  - `intent: 'plan'`;
  - `decisionPolicy: 'milestones'`.
- Turning Plan off does not imply permission to spend credits. Generation
  approval remains a separate explicit gate.

This supports:

- planning without touching media;
- automatic low-risk edits but manual generation approval;
- step-by-step direction during both source-based cutting and AI generation;
- the existing direct edit behavior for users who want it.

### 3.2 What counts as a decision

The kernel may pause for:

- story structure (remove/add/reorder a beat);
- choice of source evidence or interview moment;
- cut rhythm or scene order;
- generated-video prompt direction;
- model/provider capability and estimated spend;
- visual continuity reference;
- duration mismatch policy;
- selection among timeline variants;
- replacing an accepted scene with a new candidate.

A decision is durable. It has an ID, question, options, explanation, state, and
the exact base snapshot/fingerprint it was made against. The chat may render
it as choice cards, but the record must survive panel close and project reload.

### 3.3 Scene lifecycle

Recommended scene statuses:

```ts
type StoryboardSceneStatus =
  | 'draft'
  | 'ready'
  | 'gathering'
  | 'generating'
  | 'review'
  | 'accepted'
  | 'filled'
  | 'blocked';
```

- `draft`: the idea is incomplete.
- `ready`: intent, duration, and direction are sufficient to search/generate.
- `gathering`: source evidence or references are being collected.
- `generating`: one or more external jobs are active.
- `review`: candidates exist and need a choice.
- `accepted`: a candidate or edit option has been selected.
- `filled`: accepted media is committed to the main timeline.
- `blocked`: required evidence, reference, provider capability, or approval is
  missing.

The status is derived where possible. A canceled job should not leave a scene
permanently in `generating`.

## 4. Persisted data model

The visible card stays a normal `TimelineClip`, but AI candidates and variants
should not be duplicated into every clip copy. Use a small clip-local
projection plus normalized project state.

### 4.1 Storyboard clip

New file `src/types/storyboard.ts`:

```ts
export interface StoryboardClipProperties {
  schemaVersion: 1;
  planId: string;
  sceneId: string;                    // stable identity, separate from clip.id
  title: string;                      // bold card title
  description: string;                // readable story/action description
  intent?: string;                    // what this scene must accomplish
  visualDirection?: string;
  audioDirection?: string;
  transitionIntent?: string;
  sceneKind?: string;                 // hook, interview, b-roll, CTA, etc.
  beatId?: string;
  color?: string;
  targetDurationSeconds: number;
  status: StoryboardSceneStatus;
  generationBriefId?: string;
  selectedCandidateId?: string;
  filledClipIds?: string[];
  evidenceRefIds?: string[];
  variantSetIds?: string[];
  notes?: string;
}
```

- `TimelineSourceType` gains `'storyboard'`.
- `TimelineClip` gains
  `storyboardProperties?: StoryboardClipProperties`.
- `sceneId` remains stable if a card receives a new clip ID during copy or
  repair. Scene cards should not normally be split; if the user splits one,
  the new right-hand scene receives a new `sceneId`.
- `'storyboard'` joins the infinite-source set so cards trim/extend freely.
- Clip duration is the live planned duration. `targetDurationSeconds` records
  the explicit intent so target-vs-actual reporting is not lost after filling.

### 4.2 Normalized storyboard project state

Add `storyboardStore` (or an equivalent slice in a project-content store):

```ts
export interface StoryboardProjectState {
  plans: Record<string, StoryboardPlan>;
  generationBriefs: Record<string, StoryboardGenerationBrief>;
  candidates: Record<string, StoryboardCandidate>;
  variantSets: Record<string, TimelineVariantSet>;
  decisions: Record<string, StoryboardDecision>;
  templates: Record<string, StoryboardTemplate>;
}
```

This state is project content:

- include it in project save/load and migrations;
- include it in history snapshots where an undoable edit changes it;
- fingerprint the relevant plan/scene/variant subset during verified work;
- do not store blobs or remote provider URLs in it;
- reference existing `mediaFileId`, generation record ID, and moment handles.

Keeping all of this on the clip would make option compositions duplicate job
state, decisions, and candidates. Keeping only IDs on the card lets every
variant refer to the same generated assets and reasoning.

### 4.3 Generation brief

```ts
export interface StoryboardGenerationBrief {
  id: string;
  sceneId: string;
  revision: number;
  prompt: string;
  negativePrompt?: string;
  visualContinuity?: string;
  camera?: string;
  motion?: string;
  lighting?: string;
  audioIntent?: string;
  durationSeconds: number;
  aspectRatio: string;
  referenceMediaFileIds: string[];
  startFrameMediaFileId?: string;
  endFrameMediaFileId?: string;
  capabilityPolicy: {
    mediaType: 'image' | 'video' | 'audio';
    needsImageToVideo?: boolean;
    needsStartEndFrames?: boolean;
    needsNativeAudio?: boolean;
    preferredQuality?: 'draft' | 'balanced' | 'final';
  };
  createdAt: number;
}
```

The kernel writes the creative brief and capability needs, not a hard-coded
provider ID. The client resolves those needs against the current FlashBoard
catalog, availability, user keys, pricing, and preferences. The user can still
lock a provider/model in the UI; that lock is recorded separately in the
prepared generation request.

Every candidate points to the exact brief revision that produced it. Editing
the scene does not rewrite the provenance of existing candidates.

### 4.4 Candidate

```ts
export interface StoryboardCandidate {
  id: string;
  sceneId: string;
  kind:
    | 'source-cut'
    | 'generated-image'
    | 'generated-video'
    | 'generated-audio'
    | 'hybrid';
  state:
    | 'proposed'
    | 'awaiting-approval'
    | 'queued'
    | 'processing'
    | 'ready'
    | 'rejected'
    | 'accepted'
    | 'failed'
    | 'canceled';
  generationBriefRevision?: number;
  generationRequestKey?: string;
  generationRecordId?: string;
  outputId?: string;
  mediaFileId?: string;
  sourceMomentHandles?: string[];
  variantSetId?: string;
  variantOptionId?: string;
  durationSeconds?: number;
  estimatedCredits?: number;
  actualCredits?: number;
  rationale?: string;
  createdAt: number;
}
```

`generationRequestKey` is client-created and idempotent. Retrying after a
transport failure must not submit the same paid job twice.

### 4.5 Evidence and coverage

Evidence references are versioned pointers, not copied transcript prose:

```ts
type StoryboardEvidenceRef =
  | { kind: 'transcript-moment'; handle: string; indexVersion: string }
  | { kind: 'source-range'; mediaFileId: string; start: number; end: number }
  | { kind: 'generated-candidate'; candidateId: string }
  | { kind: 'reference-image'; mediaFileId: string };

interface StoryboardCoverage {
  level: 'red' | 'yellow' | 'green';
  sourceScore: number;
  generationReadinessScore: number;
  reasons: string[];
  evaluatedAgainstFingerprint: string;
  evaluatedAt: number;
}
```

The UI must explain the color. “Yellow: two plausible transcript moments, but
no clean establishing shot” is useful; an unexplained yellow dot is not.

Source coverage and generation readiness stay separate internally:

- source coverage asks whether existing material can fulfill the scene;
- generation readiness asks whether the prompt, references, provider
  capability, duration, and approval are sufficient;
- overall color is a presentation summary, not the only stored result.

## 5. Timeline card and storyboard editing

### 5.1 Card rendering

Render in both the timeline worker painter and main-thread fallback:

- tinted card background and border;
- bold, larger title;
- wrapped description below the title;
- optional thumbnail strip when a visual storyboard image exists;
- status glyph and candidate count;
- coverage color and target/actual badge;
- narrow-card degradation:
  - full card at normal width;
  - title plus status below approximately 90 px;
  - only color/status below the existing minimum label width.

Storyboard joins `hasBodyPreview` in the chrome overlay so the normal
label/icon layer is not drawn over its own text.

Text layout should be cached by:

`(title, description, width, height, devicePixelRatio, font settings)`

This avoids re-wrapping every long card on every paint.

### 5.2 Editing

- Context menu: **Add scene card**.
- Double-click title: reuse
  `TimelineCanvasClipRenameInput.tsx`.
- Properties:
  - title and description;
  - scene kind / beat;
  - visual and audio direction;
  - transition intent;
  - target duration;
  - coverage explanation;
  - evidence and candidates;
  - generation brief and revision history.
- Drag, trim, snap, ripple, multi-select, and undo remain normal timeline
  operations.
- Scene reorder/retime in Plan mode edits only cards.

### 5.3 Target vs. actual badge

Once a scene has committed media:

- target = the explicit planned duration;
- actual = the union of accepted `filledClipIds` inside the scene scope;
- badge examples: `12 s / 10 s`, `+2.0 s`, or `−15%`;
- green within a small tolerance, yellow for a meaningful drift, red only when
  the drift violates a declared format/template constraint;
- click the badge to show where the duration changed and offer:
  - retime the edit;
  - update the plan;
  - leave the discrepancy as an accepted exception.

This must not assume that any deviation is an error.

## 6. Visual storyboard and animatic

### 6.1 Visual storyboard

Each scene may request a low-cost concept image before video generation.

Workflow:

1. Derive an image brief from the scene’s current generation brief.
2. Show prompt, references, model, and estimated cost before submission.
3. Import the result through `FlashBoardMediaBridge`.
4. Attach the resulting candidate to the scene and show it on the card.
5. Let the user explicitly promote it to:
   - visual reference only;
   - start frame for image-to-video;
   - end frame;
   - both a card thumbnail and a generation reference.

A concept image must not silently become an image-to-video start frame; that
changes creative intent and provider cost.

### 6.2 Animatic

Program-monitor priority for a storyboard scene:

1. accepted generated/source video candidate;
2. selected visual storyboard image with a simple configurable camera move;
3. scene slate (title, description, target duration, status).

Optional animatic narration:

- use the existing ElevenLabs path to read scene narration or description;
- create a dedicated temporary/persisted animatic narration track;
- show narration duration against target scene duration;
- offer “fit scene to narration” and “rewrite narration to fit,” never silently
  retime the plan;
- use scene audio direction to add temp music/SFX notes without pretending they
  are final sound design.

Export behavior should be explicit:

- **Animatic export** includes slates, visual concepts, temp narration, and
  optional watermarks/status.
- **Normal video export** warns about visible unfilled storyboard scenes and
  never silently ships a slate as final footage.

## 7. AI-generated video workflow

### 7.1 Prepare before spending

Planning and generation submission are separate phases.

1. Kernel/client creates or revises a `StoryboardGenerationBrief`.
2. Client resolves compatible current models and displays:
   - provider/model;
   - duration and resolution;
   - reference inputs;
   - number of candidates;
   - estimated credits and maximum possible spend.
3. User approves the batch.
4. Client creates candidate records and submits jobs with idempotency keys.
5. Existing FlashBoard queue runs them asynchronously.
6. Existing media bridge imports completed results and yields `mediaFileId`.
7. Candidate records move to `ready`; the scene moves to `review`.

No fallback provider and no kernel response may silently start a paid
generation.

### 7.2 Transaction boundary

Remote generation cannot be rolled back like a timeline edit.

- Writing a brief, preparing candidate records, or attaching completed output
  can participate in normal history.
- Provider submission happens outside the agent timeline transaction.
- Undoing a local record does not refund an already submitted job.
- Cancellation is best effort; the UI must distinguish:
  - canceled before provider submission;
  - cancel requested while processing;
  - completed and therefore billable.
- If a candidate is rejected or an option discarded, its imported media stays
  in the Media Pool until the user explicitly deletes it.

The existing kernel fingerprint verification remains useful for timeline and
storyboard state, but it must not claim that an external provider side effect
was rolled back.

### 7.3 Continuity across scenes

The plan needs explicit continuity controls:

- continuity groups for recurring character/location/style;
- reference-image locks;
- previous accepted scene as optional start/reference input;
- aspect-ratio and visual-style constraints inherited from the plan/template;
- per-scene override with a visible break-in-continuity warning;
- prompt revision lineage when the user says “like option B, but less camera
  motion.”

Generated assets are candidates, not automatically final. The user can:

- accept one;
- reject all;
- ask for more like one candidate;
- combine a generated establishing shot with a source-based dialogue cut;
- keep one only as a reference for the next generation.

### 7.4 Duration mismatch

Provider durations are often discrete. If generated output does not match the
planned range, create a decision with explicit strategies:

- trim the generation;
- change scene target duration and ripple later storyboard cards;
- retime within a safe bound;
- cover the gap with another shot;
- regenerate at a compatible duration;
- hold/loop only when visually appropriate.

The selected strategy becomes part of the variant rationale and target/actual
record.

## 8. Step-by-step co-direct mode

### 8.1 Decision cards in chat

The kernel may return a durable `awaiting-decision` response:

```ts
interface KernelDecisionResponse {
  runId: string;
  status: 'awaiting-decision';
  message: string;
  decision: {
    id: string;
    kind:
      | 'story'
      | 'evidence'
      | 'generation'
      | 'cut'
      | 'variant'
      | 'duration';
    question: string;
    baseFingerprint: unknown;
    options: Array<{
      id: string;
      title: string;
      summary: string;
      rationale?: string;
      tradeoffs?: string[];
      estimatedCredits?: number;
      preview?: unknown;
    }>;
    allowMultiple?: boolean;
    allowFreeform?: boolean;
  };
}
```

No mutation or generation submission is implied by merely returning this
response. The user’s selection is sent back with `decisionId`, `optionId`, and
the latest snapshot. The kernel must reject or rebase a stale decision instead
of applying it against changed material.

### 8.2 Refinement tree

Options are not a one-time modal:

- “more like B” creates child options linked to B;
- “A’s opening plus C’s ending” creates a new hybrid option;
- “keep shot 1, redo shots 2–3” locks accepted subranges;
- rejected options remain inspectable until the variant set is archived;
- rationale and prompt/edit lineage remain visible.

This is a small decision tree attached to the scene or variant set, not an
unstructured chat transcript.

## 9. Range-scoped timeline variants

### 9.1 User interaction

1. User paints a `timelineRangeSelection`; it already includes time and track
   IDs.
2. User asks for alternatives in chat.
3. Chat shows a scope chip such as:
   `00:42–01:03 · V1–V3 + linked audio`.
4. The AI may ask one focused question or propose three directions.
5. It builds exactly three options against the same base fingerprint.
6. A comparison tray opens:
   - Option A/B/C tabs at minimum;
   - synchronized playhead and loop over the selected range;
   - labels, rationale, status, generation progress, and cost;
   - optional side-by-side Preview panels.
7. User accepts, rejects, refines, or combines.
8. Accepting commits only the selected scope to the base composition in one
   undoable transaction.

### 9.2 Canonical variant model

```ts
interface TimelineVariantSet {
  id: string;
  title: string;
  baseCompositionId: string;
  sceneIds: string[];
  scope: {
    startTime: number;
    endTime: number;
    trackIds: string[];
    includeLinked: boolean;
  };
  baseFingerprint: unknown;
  boundaryFingerprint: unknown;
  status: 'building' | 'review' | 'stale' | 'committed' | 'archived';
  optionIds: string[];
  committedOptionId?: string;
  createdAt: number;
}

interface TimelineVariantOption {
  id: string;
  variantSetId: string;
  title: string;
  rationale: string;
  state: 'planned' | 'building' | 'ready' | 'failed' | 'rejected' | 'accepted';
  fragment: TimelineFragment;
  materializedCompositionId?: string;
  candidateIds: string[];
  expectedFingerprint?: unknown;
}
```

`TimelineFragment` stores range-local offsets and the content required to
recreate the option:

- clips and track mapping;
- linked-clip relationships;
- keyframes/effects/masks;
- internal transitions;
- relevant scene IDs and candidate IDs;
- optional markers/annotations;
- warnings about unsupported boundary features.

It does not duplicate media blobs.

### 9.3 Materialization strategy

Recommended v1:

- clone the base composition into one temporary composition per option;
- use fresh clip IDs with an explicit old→new ID map;
- preserve/remap linked IDs, keyframes, masks, and internal transitions;
- rebuild transition subcompositions rather than use the current
  `duplicateComposition` shortcut that strips their IDs;
- apply the option only inside the selected range/tracks;
- lock or visibly dim the unchanged outside context;
- open option compositions as tabs and allow assignment to independent Preview
  panels.

The canonical record remains the range-scoped variant set. Temporary full
compositions are playback adapters, not proof that the option owns or changed
the whole timeline.

A later optimized comparison view can render `TimelineFragment`s as stacked
mini-timelines without materializing complete compositions.

### 9.4 Isolation rules

An option builder may modify only:

- the selected time range;
- the selected tracks;
- linked audio/video required by the declared `includeLinked` policy;
- explicitly declared boundary transition handles.

It may not:

- move later clips via ripple unless the decision explicitly expands scope;
- alter unselected tracks;
- change project settings;
- delete source/generated media;
- submit paid generation without approval;
- rewrite storyboard scenes outside the selected range.

Before presenting an option, compare its before/after scope fingerprint and an
outside-scope fingerprint. Any outside mutation is a build failure.

### 9.5 Commit algorithm

`replaceTimelineRangeWithVariant` should be a first-class edit operation:

1. Validate base and boundary fingerprints; mark stale on mismatch.
2. Resolve track mapping and linked-clip expansion.
3. Split base clips at range boundaries while preserving outside fragments.
4. Remove only the interior affected pieces.
5. Clone option fragment clips with fresh IDs.
6. Remap linked IDs, keyframes, masks, effects, and internal transitions.
7. Reconcile boundary transitions according to a declared policy:
   preserve, rebuild, or drop with warning.
8. Insert at `scope.startTime`.
9. Update storyboard scene status, selected candidate, and `filledClipIds`.
10. Commit as one history batch.
11. Run local isolation assertions and kernel `/complete` verification.

Undo restores the base timeline in one step. It does not delete already
generated media.

### 9.6 Stale variants

Store fingerprints for:

- the exact selected range;
- a small boundary neighborhood;
- referenced media/generation brief revisions.

If the base changes:

- outside the range and outside the boundary neighborhood: option may remain
  valid;
- at a boundary or inside the range: mark stale;
- prompt/reference revision only: existing built option remains playable but
  is labelled as based on an older brief;
- offer **Rebase**, **Rebuild**, or **Keep as archived comparison**.

Never silently apply an old option to a changed range.

## 10. Evidence chips and coverage traffic light

### 10.1 Evidence chips

A scene card and its Properties panel can show:

- transcript moment: speaker, short excerpt, duration;
- source range: thumbnail/timecode;
- visual-analysis fact: face/action/location;
- generated candidate: thumbnail, model, prompt revision, state;
- reference image: role (style/start/end/character).

Clicking a chip seeks or opens the referenced source/candidate. Stale moment
handles show a repair action rather than disappearing.

The fill step consumes the pinned evidence first. The kernel may search wider
only when:

- the user allows it;
- pinned evidence is insufficient;
- it explains the expansion in the option rationale.

### 10.2 Coverage calculation

Recalculate when:

- scene intent/description changes;
- relevant analysis/transcript becomes available;
- references are added/removed;
- generation completes/fails;
- selected candidate changes;
- the underlying media fingerprint changes.

Suggested meaning:

- **Green**: at least one credible route can fulfill the scene now (strong
  source evidence or a ready accepted-quality candidate).
- **Yellow**: plausible route exists but has a known gap, weak match, missing
  approval, or generation still pending.
- **Red**: no usable evidence/candidate or a hard requirement cannot be met.

Coverage is advisory. It must not block the user from deliberately using an
abstract, text-only, or intentionally unresolved scene.

## 11. Format templates

Templates are structured starting plans, not frozen example projects.

```ts
interface StoryboardTemplate {
  id: string;
  name: string;
  version: number;
  description: string;
  targetDurationSeconds?: number;
  aspectRatio?: string;
  beats: Array<{
    id: string;
    title: string;
    purpose: string;
    targetShare?: number;             // percentage of total duration
    defaultSceneKind?: string;
    evidenceExpectations?: string[];
    generationDefaults?: Partial<StoryboardGenerationBrief>;
  }>;
}
```

Initial built-ins:

- YouTube essay;
- talking head + b-roll;
- trailer/teaser;
- short vertical social video;
- product demo;
- interview portrait.

Template application:

- instantiate into an empty plan;
- merge missing beats into an existing plan;
- map existing scenes to template beats;
- show differences before destructive restructuring;
- inherit format constraints without hard-coding provider/model IDs;
- let users save a current storyboard as a custom template.

Templates also drive useful coverage expectations. A talking-head template can
flag missing b-roll; a trailer template can flag an absent closing title or
audio climax.

## 12. Semantic tools

### 12.1 Storyboard tools

New AI tools, mirrored to MCP where appropriate:

- `createStoryboardPlan`
- `addStoryboardScene`
- `updateStoryboardScene`
- `listStoryboardScenes`
- `attachStoryboardEvidence`
- `detachStoryboardEvidence`
- `setStoryboardCoverage`
- `createGenerationBriefRevision`
- `prepareStoryboardGeneration`
- `listStoryboardCandidates`
- `selectStoryboardCandidate`
- `createStoryboardFromTemplate`

Existing `moveClip`, `trimClip`, and `deleteClip` remain the implementation for
scene reorder/retime/delete.

### 12.2 Variant tools

- `getTimelineRangeSelection`
- `createTimelineVariantSet`
- `addTimelineVariantOption`
- `materializeTimelineVariantOption`
- `listTimelineVariantOptions`
- `commitTimelineVariantOption`
- `archiveTimelineVariantSet`

`getTimelineState` should also expose `timelineRangeSelection`.

Tools that submit paid jobs are not ordinary silent mutation tools. Prefer:

- `prepareStoryboardGeneration`: safe, local, returns compatible models and
  cost;
- `submitPreparedStoryboardGeneration`: requires a client-generated approval
  token tied to exact request/cost limits.

The token expires when the request, candidate count, provider/model, or price
changes.

### 12.3 Plan-mode allowlist

While `intent: 'plan'`:

- allow storyboard/decision/template reads and writes;
- allow timeline reads and range selection reads;
- reject real clip mutation, media deletion, export, and provider submission;
- allow generation preparation, but not submission.

Enforce in the client executor, not only in prompts or the kernel.

## 13. Kernel public wire contract

### 13.1 Request

```ts
interface KernelCompileRequest {
  request: string;
  snapshot: unknown;
  intent?: 'execute' | 'plan';
  decisionPolicy?: 'automatic' | 'milestones' | 'every-decision';
  conversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
  activeDecision?: { decisionId: string; optionIds: string[]; freeform?: string };
  activeVariantSetId?: string;
  moments?: KernelTranscriptMoment[];
  silentRanges?: KernelSilenceRange[];
}
```

The snapshot must contain:

- active composition;
- storyboard scene projection;
- normalized relevant storyboard state;
- `timelineRangeSelection`;
- selected clips;
- compatible generation capability summary (not secrets);
- candidate/job states and imported `mediaFileId`s;
- current fingerprints.

### 13.2 Planning response

```ts
interface KernelPlannedResponse {
  runId: string;
  status: 'planned';
  message: string;
  resolvedCalls: KernelResolvedCall[]; // plan-mode allowlist only; may be empty
  expectedFingerprint?: unknown;
  planSummary?: unknown;
}
```

- Empty calls are pure conversation; no transaction or `/complete`.
- Non-empty calls use the current transaction/verification path.

### 13.3 Decision response

Use the `awaiting-decision` response from section 8. It performs no implicit
mutation. The selected decision is compiled against the latest snapshot.

### 13.4 Variant response

```ts
interface KernelVariantPlanResponse {
  runId: string;
  status: 'variant-planned';
  message: string;
  variantSet: {
    scope: TimelineVariantSet['scope'];
    baseFingerprint: unknown;
    options: Array<{
      id: string;
      title: string;
      rationale: string;
      resolvedCalls: KernelResolvedCall[];
      generationBriefs?: StoryboardGenerationBrief[];
      estimatedCredits?: number;
    }>;
  };
}
```

The client:

- validates the scope against the user’s active range;
- creates isolated option contexts;
- runs only local/non-paid calls immediately;
- turns generation briefs into prepared, approval-gated jobs;
- marks partially ready options honestly;
- verifies each option before presenting it.

Kernel internals, ranking prompts, and provider-specific prompt craft stay in
the private repository.

## 14. Fill behavior

“Fill scene 3” may produce:

- a source-based cut;
- accepted generated video;
- a hybrid of source and generated media;
- a range variant requiring a user decision.

Default remains non-destructive:

- storyboard cards stay on a dedicated reference track;
- real clips land on normal tracks;
- card status and `filledClipIds` update in the same local history batch as the
  commit;
- hiding the storyboard track is a view choice, not deletion.

When one scene is refilled:

- preserve the previous accepted candidate as a recoverable alternative;
- create a new variant set for that scene/range;
- do not overwrite the main timeline until a new option is accepted;
- report target/actual duration and continuity impact.

## 15. Work packages and rollout

| WP | Deliverable | Main areas |
|---|---|---|
| 0 | Contract spike: exact scene/variant/generation schemas, migrations, fingerprint scope | `src/types`, kernel client contract, project persistence |
| 1 | Storyboard foundation: source type, scene cards, Properties, semantic tools | timeline types/renderers, Properties, AI tools |
| 2 | Plan chat: intent toggle, decision policy, allowlist, `planned` response, fallback playbook | FlashBoard chat/store, kernel gateway |
| 3 | Visual storyboard + animatic slate, explicit Animatic export | preview/text render path, FlashBoard image/TTS path, export |
| 4 | Candidate registry + generation briefs linked to existing queue/media bridge | storyboard store, FlashBoard job/metadata bridge |
| 5 | Cost/approval/idempotency boundary and reload/resume behavior | FlashBoard job service, generation UI, project restore |
| 6 | Evidence chips, coverage engine, target/actual badge | Agent Timeline/moment handles, card/Properties UI |
| 7 | Durable decisions and co-direct chat cards | kernel response parsing, chat output, storyboard store |
| 8 | Range selection in snapshots/tools; variant-set model and isolation assertions | timeline state tool, edit operations, fingerprints |
| 9 | Temporary option compositions, synchronized comparison, generation progress | composition clone/remap, tabs/Preview, comparison tray |
| 10 | Atomic range commit, stale/rebase flow, single-step undo and `/complete` verification | edit operations, history, kernel gateway |
| 11 | Format templates and custom template persistence | storyboard templates/UI |
| 12 | Docs, migrations, telemetry, accessibility, stress/E2E coverage | docs/tests |

Recommended milestones:

### Milestone A — Plan that can be played

WP 0–3:

- readable scene cards;
- Plan mode that cannot edit real media;
- plan-only kernel/fallback conversation;
- animatic slates and optional visual concepts.

### Milestone B — Generate one scene safely

WP 4–6:

- versioned generation brief;
- cost approval;
- async candidate generation/import;
- evidence, coverage, and target/actual reporting;
- accept one candidate into one scene.

### Milestone C — Co-direct and choose

WP 7:

- durable decision cards;
- “more like B” lineage;
- step-by-step source and generation choices.

### Milestone D — Three timelines for one marked range

WP 8–10:

- exact time+track scope;
- three isolated option timelines;
- synchronized compare;
- stale detection;
- atomic selected-range commit and undo.

### Milestone E — Repeatable formats

WP 11–12:

- built-in and custom templates;
- end-to-end polish and reliability.

## 16. Test plan

### 16.1 Unit and schema

- scene/card and normalized-store serialization/migration;
- stable `sceneId` behavior on trim/copy/split;
- infinite-source storyboard timing;
- plan-mode mutation allowlist;
- decision and variant response parsing;
- generation approval token expiry and idempotency;
- evidence-handle versioning and coverage derivation;
- target/actual calculation;
- template duration-share expansion.

### 16.2 Generation integration

- prepare without submit/spend;
- approve exact candidate batch;
- reload while queued/processing and resume;
- cancel at each lifecycle state;
- multi-output import maps `recordId`/`outputId`/`mediaFileId` correctly;
- failed download/provider job leaves an honest candidate state;
- undo local attachment without claiming a refund or deleting the asset;
- prompt revision provenance survives later scene edits.

### 16.3 Variant invariants

- only selected time and tracks change;
- linked audio expansion follows policy;
- clips crossing boundaries preserve outside fragments;
- fresh ID mapping for clips, links, keyframes, masks, effects, transitions;
- boundary transition preserve/rebuild/drop policy;
- generated and source candidates in the same option;
- outside-scope fingerprint remains unchanged;
- stale base prevents commit;
- commit is one undo point;
- undo restores the exact base timeline;
- discarded option media remains recoverable.

### 16.4 Component/E2E

- card paint at narrow/default/tall track heights;
- thumbnail/status/coverage overlay accessibility;
- Plan chip persists across popover close;
- decision cards support keyboard and screen reader choice;
- mark range → ask for three options → partial async readiness → compare →
  refine B → accept → commit → undo;
- compare options with synchronized loop/playhead;
- save/reload with open variant set and active jobs;
- kernel off: plan fallback still only touches storyboard state;
- normal export warns on unfilled cards; Animatic export intentionally renders
  them.

## 17. Acceptance criteria

The feature is complete only when:

1. Plan mode can create and revise a playable storyboard without changing real
   clips.
2. A scene can own versioned source and AI-generated candidates with clear
   provenance.
3. No paid generation begins without an exact, visible approval.
4. Reloading a project does not lose queued jobs, imported candidate links,
   decisions, or variants.
5. A painted time+track range is visible to the kernel and becomes an enforced
   mutation boundary.
6. “Make three options” produces three independently playable alternatives
   while leaving the base timeline untouched.
7. Options can finish asynchronously and report partial/failed state honestly.
8. Choosing one option changes only the selected scope and creates one undo
   step.
9. A stale option cannot silently overwrite a changed base range.
10. Evidence, coverage, and target/actual badges explain their reasoning.
11. Visual storyboard and animatic modes work before final video exists.
12. Existing direct chat editing continues to work when Plan mode is off.

## 18. Open decisions and risks

1. **Variant UI for v1**: composition tabs are the fastest robust playback
   adapter; a purpose-built stacked mini-timeline comparison is the better
   long-term UX. Recommendation: tabs + comparison tray first, while keeping
   `TimelineVariantSet` independent of that UI.
2. **Storyboard store location**: dedicated store vs project-content slice.
   Choose whichever gives explicit persistence/history integration without
   adding direct hot-path state reads.
3. **Fingerprint scope**: define storyboard, range, boundary, and referenced
   media fingerprints before kernel implementation; otherwise stale and
   isolation guarantees will be unreliable.
4. **Transitions at range boundaries**: start with explicit preserve/drop
   rules and warnings; fully editable transition-subcomposition cloning is a
   separate hard requirement for parity.
5. **Generation prices can change**: approval must be tied to a maximum spend,
   not only a cached estimate.
6. **Provider duration/capability drift**: kernel briefs should express
   capabilities, while the client resolves the current catalog.
7. **History size**: full materialized option compositions inside global
   snapshots can become expensive. Keep canonical fragments normalized, cap
   active materializations, and archive comparison state separately.
8. **Generated-media cleanup**: never auto-delete paid output when an option is
   rejected. Provide a later explicit “unused generated media” review.
9. **Fallback parity**: community fallback can plan and prepare generations,
   but must obey the same allowlist and approval boundary as the kernel.
10. **Normal export safety**: unfinished storyboard cards must not accidentally
    become final deliverables; use an explicit Animatic export mode and final
    export warnings.
