# MD4 Modifiers / Falloffs Evidence

Status: complete; gate closed 2026-08-01

Date: 2026-08-01
Contract: frozen `masterselects.motion-modifier-stack` V1

## Implemented vertical slice

- Runtime: `MotionFrameRuntime` plans every clip's `modifierStack` through the
  frozen `planMotionModifiers` reference planner (deterministic seeds, tick-grid
  time sampling, budgets, fail-closed diagnostics) and carries the plans in the
  evaluated frame state with modifier revisions in the frame cache identity.
- Falloff shape references are provisioned from same-composition ellipse and
  rectangle clips with the shared revision convention
  (`motion.replicator?.revision ?? 0`) used identically by the runtime, the UI,
  and the AI tool. Missing and stale references keep their frozen diagnostic
  codes.
- Render consumption: `getMotionReplicatorRenderState` threads the frame's
  modifier plan into `createReplicatorRenderPacket`, which applies planned
  per-instance transforms and omits `clipped` instances. Without a stack the
  packet is byte-identical to before.
- AI: the semantic `editMotionModifier` tool (add / update / remove / reorder /
  set-falloff / clear-falloff) with flat parameters, stale-revision protection,
  parse-validated plans, single-entry history, and entity/revision reporting —
  registered across all seven parity sites (definitions, handler registry,
  policy, types, FlashBoard tools/prompt/playbooks).
- UI: the Modifiers section in the shape Properties tab — list with
  enable/reorder/remove, add menu for the four kinds, kind-specific fields,
  target editing, falloff subsection with shape picker, batch-grouped drags,
  inline diagnostics instead of silent clamping.

## Automated evidence

- MD4 matrix (runtime wiring, falloff references, contract freeze, AI tool,
  UI section, replicator composition/foundation): 74/74, plus the packed-data
  consumption suite `motionModifierInstanceConsumptionMd4.test.ts` 4/4 —
  packed per-instance opacity numerically follows
  `pow(clamp(1 - d/r, 0, 1), exponent)` (center 0, corner 1, mid 0.8704 with
  multiply amount -1), deterministic across builds, no-stack path unchanged,
  value changes reflected.
- Full application `tsc -b` passes (only the pre-existing unrelated
  `audioEffectProperties.ts` errors remain).
- Two real defects were found and fixed by this phase's own verification:
  a default-parameter bug that made the UI falloff unclearable
  (`apply(modifiers, undefined)` re-triggering the default), and the packed
  instance data ignoring plans entirely (hardcoded pass-through of
  `replicator.instanceData`; the same "produced but not consumed" class as the
  earlier `modifiers: []` and `shapeReferences: []` hardcodes).

## Visible required scenario — radial field

Captured 2026-08-01 in the disposable evidence session
`http://motion-md0-md4radialfield.localhost:5173/?motionDesignEvidenceSession=md4radialfield`
(bridge session `fc7d7d49`; the open user project was never touched).

- Scene authored end-to-end through the AI surface: `createMotionShapeClip`
  (ellipse) → `updateMotionProperties` → `configureMotionReplicator`
  (grid 21×13 = 273 instances) → `editMotionModifier` add field
  (radial-distance, center 0/0, radius 750, exponent 2, target
  `replicator.offset.opacity` multiply amount −1; stack revision 0→1,
  single-entry history, modifier entity reported).
- Screenshot
  [`md4/radial-field-editor-preview.jpg`](./md4/radial-field-editor-preview.jpg):
  the live preview shows the grid with a smooth radial hole — instances fade to
  fully transparent at the field center and return to full opacity beyond the
  radius, exactly the frozen weight formula.
- Semantics note recorded for authors: multiply applies
  `value * (1 + sample * amount)`, so amount −1 fades toward the field center
  and amount +1 is a no-op on an opacity of 1.

## Worker-GPU readback parity — closed 2026-08-01

Root cause: the worker frame-stack transport reconstructs Layer objects from
serializable payloads, so the admission's WeakMap-keyed `layerEntryIds` lookup
missed and the modifier/replicator resolvers returned null fail-closed — the
readback rendered blank while the main-thread preview was correct.

Fix: `resolveMotionFrameLayerEntryId` falls back from object identity to the
stable layer id, but ONLY on a unique match; duplicated/nested occurrence
entries deliberately remain identity-only and stay fail-closed on ambiguity.
Covered by `motionModifierWorkerReadbackParityMd4.test.ts`; the combined matrix
is 160/160.

Visual proof, fresh disposable session
`http://motion-md0-md4gpuproof.localhost:5173/?motionDesignEvidenceSession=md4gpuproof`
(bridge session `8ae0502a`): the same 21×13 field-modifier scene captured via
`captureFrame mode:"gpu"` (worker readback, call
`bridge-msaaedwe-1c3a8271-f58`) now shows the identical radial falloff as the
preview canvas — center instances fully faded, edges at full opacity. Readback
and preview agree.

`MD4_MODIFIERS_AND_FALLOFFS_COMPLETE` is closed. No live user project was
mutated. No commit or push was made.
