# Motion Design Wave 1 Contract Preflight

Date: 2026-07-31
Status: complete; `MDX2_CONTRACTS_FROZEN` satisfied

This preflight records the exact ownership and contract gaps discovered during
Wave 0. Wave 0 is now closed, and its proposed ownership has been registered in
the executable architecture registry. `MDX1` and `MDX2` are satisfied; the
fixture-tested result is recorded in
[`wave1-contract-freeze-report.md`](./wave1-contract-freeze-report.md).

## Planned exclusive ownership

| Lane | Contract artifacts | Exclusive responsibility |
|---|---|---|
| L0 Main | `src/architecture/motionDesignGateRegistry.ts`, `motionDesignLaneWriteManifest.ts`, shared contracts under `src/services/motionDesign/contracts/`, project DTO/codecs, and `MotionFrameState` | MDX gates, write leases, schema/migration boundary, project/history integration, shared render/store/AI seams |
| L1 MD3/MD4 | `replicator/contracts.ts`, `referenceEvaluator.ts`, fixtures; modifier/falloff contracts and reference evaluator | Layout/count/offset/index/bounds semantics, deterministic seeds, modifier plans, capacity diagnostics |
| L2 MD6/MD8 | Parent-graph contracts/planner; preset, template, and expression contracts | Reparent policy, group decision, dependency/remap envelopes, grammar and security budgets |
| L3 MD7/MD5 | Adjustment operation/order/effect contracts; media source-time/reuse contracts | Ordered compositor stream, adjustment semantics, effect matrix, media timing and reuse keys |

Shared renderer, store, project, registry, and architecture files remain L0
integration seams. Leaf lanes produce pure contracts and fixtures first.

## Blockers that Wave 1 must resolve

1. MDX gates and Motion-specific write ownership are not registered. Existing
   architecture phases cover P0-P8 and Storyboard, while the high-conflict map
   has no Motion renderer/type/project ownership (`src/architecture/types.ts`,
   `highConflictOwnership.ts`).
2. Persistent Motion definitions and appearance stacks use a fixed version 1
   without a dedicated project DTO/migration codec. Runtime Motion types flow
   directly into project clips (`src/types/motionDesign.ts`,
   `src/services/project/types/composition.types.ts`).
3. Replicator limits conflict: durable defaults advertise 10,000, the current
   shader/runtime caps at 100, and AI describes ten per axis/100 effective.
   `maxInstances` currently conflates requested, user, device, and effective
   limits (`motionDesign.ts`, `MotionTypes.ts`, `mvpCapabilities.ts`).
4. Preview, nested preview, target preview, and export do not consume one
   evaluated `MotionFrameState`; renderer entry points still receive raw Motion
   definitions independently (`renderFrameSnapshot.ts`, `MotionRenderer.ts`,
   `RenderDispatcher.ts`, `NestedCompRenderer.ts`, `targetPreviewRenderer.ts`).
5. Parenting is tied to live playhead state, lacks the world-preserving domain
   operation, and does not consistently persist/remap `parentClipId` through
   project and clipboard paths (`clipSlice.ts`,
   `keyframeTransformInterpolationActions.ts`, `projectSave.ts`,
   `loadTimelineHydration.ts`, `clipboardTypes.ts`).
6. Adjustment clips are created but discarded by main, nested, and export layer
   builders. A discriminated ordered compositor stream and one canonical
   bottom-to-top rule do not yet exist (`LayerBuilderService.ts`,
   `layerBuilderNestedLayerBuilder.ts`, `nestedLayers.ts`,
   `src/engine/core/types.ts`).
7. Texture Motion is only a `mediaFileId` schema stub. Image/video/nested source
   envelopes, time modes, relink state, and reuse keys are missing; the existing
   MediaRuntime lease boundary must be consumed rather than duplicated.
8. UI and AI still mutate Motion through separate store/handler paths. Shared
   typed domain operations and revision/mutation envelopes are required before
   MD3-MD8 surface integration (`handlers/motionDesign.ts`,
   `MotionShapeTab.tsx`, `MotionAppearanceStackEditor.tsx`).
9. Mutation entity kinds do not describe modifiers, falloffs, parent edges,
   adjustment operations, media bindings, presets, or templates
   (`mutationEntityResults.ts`).
10. Only an appearance-preset codec exists. Project-local catalogs, `.msmotion`
    templates, dependencies, stable remapping, and bounded expressions have no
    frozen ownership or envelope (`appearancePresets.ts`).

## Reusable foundations

- Property Registry descriptors and dynamic Motion properties.
- Timeline revision, transaction, and batch infrastructure.
- History Motion data and partial parent-link support.
- RenderFrameSnapshot and MediaRuntime as shared integration boundaries.

`MDX0_BASELINE_CLOSED`, `MDX1_OWNERSHIP_REGISTERED`, and
`MDX2_CONTRACTS_FROZEN` are satisfied. The Wave 1 exit evidence covers tested
serialization, migration defaults, determinism, stable ids, invalid-input
behavior, preview/export-consumable evaluated state, and zero ownership
overlap.
