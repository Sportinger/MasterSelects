# Keyframes.md — audit 2026-08-02

## Verified (spot checks that held)

- Per-clip keyframes are stored in `clipKeyframes`, with recording keys scoped as `clipId:property`; add/update, removal, movement, selection, and Bezier-handle actions are implemented in `src/stores/timeline/keyframes/keyframeBasicActions.ts` and `src/stores/timeline/keyframeSlice.ts`.
- Transform, camera, effect, color, mask, vector-animation, and motion-property namespaces in the document are represented by `AnimatableProperty` in `src/types/animationProperties.ts`; their values are routed by `src/stores/timeline/keyframeSlice.ts`.
- Camera properties (`camera.fov`, `camera.near`, `camera.far`, `camera.resolutionWidth`, and `camera.resolutionHeight`) are interpolated in `src/utils/keyframeInterpolation.ts`.
- Mask path keyframes retain a separate `pathValue` payload and are created through `src/stores/timeline/keyframes/keyframePathActions.ts`.
- Copy/paste normalizes keyframe times to the earliest copied keyframe and pastes at the playhead in `src/stores/timeline/clipboardSlice.ts`.
- The four preset easing modes plus Bezier, rotation interpolation, and the documented 18 px / 80–600 px layout constants are present in `src/types/animationProperties.ts`, `src/utils/keyframeInterpolation.ts`, and `src/stores/timeline/constants.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Audio fades are built from `audio-volume.volume` keyframes” → fades use `effect.{volumeEffectId}.volume`. The renderer selects `effect.${volumeEffect.id}.${AUDIO_VOLUME_PARAM}` in `src/engine/audio/effectRender/offlineNodeRenderer.ts`; the timeline fade UI resolves the same automation through `src/components/timeline/utils/audioAutomationCurve.ts`.
- “Shift+drag on a timeline diamond makes the drag 10x slower” → Shift snaps the drag delta to nearby keyframes in the same clip. See `src/components/timeline/TimelineKeyframes.tsx` and `src/components/timeline/components/ClipKeyframeTicks.tsx`.
- The Curve Editor section describes a single per-row editor without the current graph workspace → current interaction opens Graph mode from either a property row or diamond; it can display and select multiple numeric curve series. See `src/components/timeline/components/TimelineHeaderPropertyRow.tsx`, `src/components/timeline/TimelineKeyframes.tsx`, `src/components/timeline/TimelineGlobalCurveSurface.tsx`, and `src/components/timeline/GlobalCurveEditor.tsx`.
- The active Graph mode does not implement the documented Shift+wheel resize or right-click handle reset; those handlers exist only in the unreferenced legacy `src/components/timeline/CurveEditor.tsx`. The active graph is mounted through `src/components/timeline/hooks/useTimelineGraphHostController.tsx` and `src/components/timeline/TimelineGlobalCurveSurface.tsx`.
- The opening capability list omits shipped text-bound, light, and custom-node animation targets → `textBounds.*`, `light.*`, and `node.*` are part of `AnimatableProperty` and are applied by `src/stores/timeline/keyframeSlice.ts`; their authoring UI exists in `src/components/panels/TextTab.tsx`, `src/components/panels/properties/LightTab.tsx`, and `src/components/panels/nodes/workspace/AINodeExposedParameters.tsx`.

## Noteworthy / unusual

- The legacy `CurveEditor.tsx` remains alongside the active global Graph-mode path (`TimelineGlobalCurveSurface.tsx` / `GlobalCurveEditor.tsx`), so references to curve-editor behavior require care about which surface is meant.
- The keyframe type stores numeric `value` plus an optional mask `pathValue` (`src/types/keyframes.ts`); text bounds reuse the mask-path payload shape through `src/stores/timeline/keyframes/keyframePathActions.ts`.
- `AnimatableProperty` includes `transitionRender.progress`, but `src/stores/timeline/keyframeSlice.ts` has no corresponding static-value write branch or visible authoring control found in `src/components/`; it should not be documented as a user-facing keyframe target without further implementation evidence.
