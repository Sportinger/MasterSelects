import type { FieldOwnershipMap } from './fieldOwnership';
import type { StoryboardScene } from '../../../storyboard/contracts/models';
import type { StoryboardTemplate } from '../../../storyboard/contracts/models';
import type { StoryboardTemplateBeat } from '../../../storyboard/contracts/models';
import type { StrokeAppearance } from '../../../../types/motionDesign';
import type { SurfaceOcclusion } from '../../../../types/planarTracking';
import type { SurfacePoint } from '../../../../types/planarTracking';
import type { SurfaceSample } from '../../../../types/planarTracking';
import type { SynthFilter } from '../../../../types/midiClip';
import type { SynthLfo } from '../../../../types/midiClip';
import type { TerrainAnchorConnector } from '../../../../types/terrainAttachment';
import type { TerrainAttachment } from '../../../../types/terrainAttachment';
import type { TerrainCamera } from '../../../../types/terrainTracking';
import type { TerrainFootstep } from '../../../../types/terrainTracking';
import type { TerrainIntrinsics } from '../../../../types/terrainTracking';
import type { TerrainPlacement } from '../../../../types/terrainTracking';
import type { TerrainReconstruction } from '../../../../types/terrainTracking';
import type { TerrainScreenAnchor } from '../../../../types/terrainAttachment';
import type { TerrainVertex } from '../../../../types/terrainTracking';
import type { TextureFillAppearance } from '../../../../types/motionDesign';
import type { TimelineFragment } from '../../../storyboard/contracts/models';
import type { TimelineFragmentClip } from '../../../storyboard/contracts/models';
import type { TimelineFragmentLink } from '../../../storyboard/contracts/models';
import type { TimelineFragmentOwnedPayload } from '../../../storyboard/contracts/models';
import type { TimelineFragmentTrack } from '../../../storyboard/contracts/models';
import type { TimelineFragmentTransition } from '../../../storyboard/contracts/models';
import type { TimelinePanelData } from '../../../../types/dock';
import type { TimelineTransition } from '../../../../types/timelineCore';
import type { TimelineVariantOption } from '../../../storyboard/contracts/models';
import type { TimelineVariantOptionLineage } from '../../../storyboard/contracts/models';
import type { TimelineVariantScope } from '../../../storyboard/contracts/models';
import type { TimelineVariantSet } from '../../../storyboard/contracts/models';
import type { TrackAudioState } from '../../../../types/audio';
import type { TrackingAsset } from '../../../../types/trackingAsset';
import type { TrackingBinding } from '../../../../types/trackingBinding';
import type { TransitionCompositionLink } from '../../../../types/timelineCore';
import type { TransitionOverlayClipDefinition } from '../../../../types/timeline';
import type { TransitionRecipeBlendWindow } from '../../../../types/timelineCore';
import type { TransitionSourceMapV1 } from '../../../../types/timelineCore';
import type { TransitionSourceMapV2 } from '../../../../types/timelineCore';
import type { TransitionSourceMapV2AnimationSnapshot } from '../../../../types/timelineCore';
import type { TransitionSourceMapV2ParentContract } from '../../../../types/timelineCore';
import type { VectorAnimationClipSettings } from '../../../../types/vectorAnimation';
import type { VectorAnimationDataBindingProperty } from '../../../../types/vectorAnimation';
import type { VectorAnimationMetadata } from '../../../../types/vectorAnimation';
import type { VectorAnimationStateCue } from '../../../../types/vectorAnimation';
import type { VectorAnimationStateMachineInput } from '../../../../types/vectorAnimation';
import type { VectorAnimationViewModelMetadata } from '../../../../types/vectorAnimation';
import type { VisualStoryConcept } from '../../../seedancePreproduction/orchestrationContracts';
import type { VisualStoryConceptReview } from '../../../seedancePreproduction/orchestrationContracts';

export const StoryboardSceneFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "planId": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "description": { class: 'content', owner: 'storyboard' },
  "intent": { class: 'content', owner: 'storyboard' },
  "visualDirection": { class: 'content', owner: 'storyboard' },
  "audioDirection": { class: 'content', owner: 'storyboard' },
  "transitionIntent": { class: 'content', owner: 'storyboard' },
  "sceneKind": { class: 'content', owner: 'storyboard' },
  "beatId": { class: 'content', owner: 'storyboard' },
  "color": { class: 'content', owner: 'storyboard' },
  "targetDurationSeconds": { class: 'content', owner: 'storyboard' },
  "status": { class: 'content', owner: 'storyboard' },
  "generationBriefId": { class: 'content', owner: 'storyboard' },
  "selectedCandidateId": { class: 'content', owner: 'storyboard' },
  "filledClipIds": { class: 'content', owner: 'storyboard' },
  "evidenceRefIds": { class: 'content', owner: 'storyboard' },
  "variantSetIds": { class: 'content', owner: 'storyboard' },
  "notes": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
  "updatedAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardScene>;

export const StoryboardTemplateFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "name": { class: 'content', owner: 'storyboard' },
  "version": { class: 'content', owner: 'storyboard' },
  "description": { class: 'content', owner: 'storyboard' },
  "targetDurationSeconds": { class: 'content', owner: 'storyboard' },
  "aspectRatio": { class: 'content', owner: 'storyboard' },
  "beats": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardTemplate>;

export const StoryboardTemplateBeatFields = {
  "id": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "purpose": { class: 'content', owner: 'storyboard' },
  "targetShare": { class: 'content', owner: 'storyboard' },
  "defaultSceneKind": { class: 'content', owner: 'storyboard' },
  "evidenceExpectations": { class: 'content', owner: 'storyboard' },
  "generationDefaults": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<StoryboardTemplateBeat>;

export const StrokeAppearanceFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "width": { class: 'content', owner: 'timeline' },
  "alignment": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<StrokeAppearance>;

export const SurfaceOcclusionFields = {
  "time": { class: 'content', owner: 'timeline' },
  "quad": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SurfaceOcclusion>;

export const SurfacePointFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SurfacePoint>;

export const SurfaceSampleFields = {
  "time": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "quad": { class: 'content', owner: 'timeline' },
  "confidence": { class: 'content', owner: 'timeline' },
  "manual": { class: 'content', owner: 'timeline' },
  "objectPrompts": { class: 'content', owner: 'timeline' },
  "contour": { class: 'content', owner: 'timeline' },
  "detailContour": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SurfaceSample>;

export const SynthFilterFields = {
  "type": { class: 'content', owner: 'timeline' },
  "cutoff": { class: 'content', owner: 'timeline' },
  "resonance": { class: 'content', owner: 'timeline' },
  "envAmount": { class: 'content', owner: 'timeline' },
  "keytrack": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SynthFilter>;

export const SynthLfoFields = {
  "id": { class: 'content', owner: 'timeline' },
  "target": { class: 'content', owner: 'timeline' },
  "shape": { class: 'content', owner: 'timeline' },
  "rate": { class: 'content', owner: 'timeline' },
  "depth": { class: 'content', owner: 'timeline' },
  "global": { class: 'content', owner: 'timeline' },
  "fadeIn": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SynthLfo>;

export const TerrainAnchorConnectorFields = {
  "anchorClipId": { class: 'content', owner: 'tracking' },
  "color": { class: 'content', owner: 'tracking' },
  "width": { class: 'content', owner: 'tracking' },
  "opacity": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainAnchorConnector>;

export const TerrainAttachmentFields = {
  "version": { class: 'content', owner: 'tracking' },
  "targetVideoClipId": { class: 'content', owner: 'tracking' },
  "trackId": { class: 'content', owner: 'tracking' },
  "footstepId": { class: 'content', owner: 'tracking' },
  "placement": { class: 'content', owner: 'tracking' },
  "visible": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainAttachment>;

export const TerrainCameraFields = {
  "time": { class: 'content', owner: 'tracking' },
  "duration": { class: 'content', owner: 'tracking' },
  "rotation": { class: 'content', owner: 'tracking' },
  "translation": { class: 'content', owner: 'tracking' },
  "error": { class: 'content', owner: 'tracking' },
  "observations": { class: 'content', owner: 'tracking' },
  "occluders": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainCamera>;

export const TerrainFootstepFields = {
  "id": { class: 'content', owner: 'tracking' },
  "name": { class: 'content', owner: 'tracking' },
  "placement": { class: 'content', owner: 'tracking' },
  "mesh": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainFootstep>;

export const TerrainIntrinsicsFields = {
  "width": { class: 'content', owner: 'tracking' },
  "height": { class: 'content', owner: 'tracking' },
  "fx": { class: 'content', owner: 'tracking' },
  "fy": { class: 'content', owner: 'tracking' },
  "cx": { class: 'content', owner: 'tracking' },
  "cy": { class: 'content', owner: 'tracking' },
  "k1": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainIntrinsics>;

export const TerrainPlacementFields = {
  "x": { class: 'content', owner: 'tracking' },
  "y": { class: 'content', owner: 'tracking' },
  "width": { class: 'content', owner: 'tracking' },
  "height": { class: 'content', owner: 'tracking' },
  "rotation": { class: 'content', owner: 'tracking' },
  "contour": { class: 'content', owner: 'tracking' },
  "contactTime": { class: 'content', owner: 'tracking' },
  "lockTime": { class: 'content', owner: 'tracking' },
  "labelX": { class: 'content', owner: 'tracking' },
  "labelY": { class: 'content', owner: 'tracking' },
  "profile": { class: 'content', owner: 'tracking' },
  "side": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainPlacement>;

export const TerrainReconstructionFields = {
  "version": { class: 'content', owner: 'tracking' },
  "solver": { class: 'content', owner: 'tracking' },
  "denseMesh": { class: 'content', owner: 'tracking' },
  "footsteps": { class: 'content', owner: 'tracking' },
  "referenceTime": { class: 'content', owner: 'tracking' },
  "intrinsics": { class: 'content', owner: 'tracking' },
  "cameras": { class: 'content', owner: 'tracking' },
  "vertices": { class: 'content', owner: 'tracking' },
  "triangles": { class: 'content', owner: 'tracking' },
  "sourceFrameCount": { class: 'content', owner: 'tracking' },
  "sparsePointCount": { class: 'content', owner: 'tracking' },
  "medianError": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainReconstruction>;

export const TerrainScreenAnchorFields = {
  "attachment": { class: 'content', owner: 'tracking' },
  "offset": { class: 'content', owner: 'tracking' },
  "contentBounds": { class: 'content', owner: 'tracking' },
  "labelLayout": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainScreenAnchor>;

export const TerrainVertexFields = {
  "position": { class: 'content', owner: 'tracking' },
  "uvq": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TerrainVertex>;

export const TextureFillAppearanceFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "mediaFileId": { class: 'content', owner: 'timeline' },
  "fit": { class: 'content', owner: 'timeline' },
  "transform": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TextureFillAppearance>;

export const TimelineFragmentFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "durationSeconds": { class: 'content', owner: 'timeline' },
  "tracks": { class: 'content', owner: 'timeline' },
  "clips": { class: 'content', owner: 'timeline' },
  "links": { class: 'content', owner: 'timeline' },
  "keyframes": { class: 'content', owner: 'timeline' },
  "effects": { class: 'content', owner: 'timeline' },
  "masks": { class: 'content', owner: 'timeline' },
  "transitions": { class: 'content', owner: 'timeline' },
  "markers": { class: 'content', owner: 'timeline' },
  "annotations": { class: 'content', owner: 'timeline' },
  "sceneIds": { class: 'content', owner: 'timeline' },
  "candidateIds": { class: 'content', owner: 'timeline' },
  "warnings": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragment>;

export const TimelineFragmentClipFields = {
  "localId": { class: 'content', owner: 'timeline' },
  "sourceClipId": { class: 'content', owner: 'timeline' },
  "localTrackId": { class: 'content', owner: 'timeline' },
  "startOffsetSeconds": { class: 'content', owner: 'timeline' },
  "durationSeconds": { class: 'content', owner: 'timeline' },
  "payload": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragmentClip>;

export const TimelineFragmentLinkFields = {
  "fromClipId": { class: 'content', owner: 'timeline' },
  "toClipId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragmentLink>;

export const TimelineFragmentOwnedPayloadFields = {
  "ownerClipId": { class: 'content', owner: 'timeline' },
  "payload": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragmentOwnedPayload>;

export const TimelineFragmentTrackFields = {
  "localTrackId": { class: 'content', owner: 'timeline' },
  "sourceTrackId": { class: 'content', owner: 'timeline' },
  "kind": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragmentTrack>;

export const TimelineFragmentTransitionFields = {
  "fromClipId": { class: 'content', owner: 'timeline' },
  "toClipId": { class: 'content', owner: 'timeline' },
  "payload": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineFragmentTransition>;

export const TimelinePanelDataFields = {
  "timelineSurfaceMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelinePanelData>;

export const TimelineTransitionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "offset": { class: 'content', owner: 'timeline' },
  "linkedClipId": { class: 'content', owner: 'timeline' },
  "compositionId": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TimelineTransition>;

export const TimelineVariantOptionFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "variantSetId": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "rationale": { class: 'content', owner: 'storyboard' },
  "state": { class: 'content', owner: 'storyboard' },
  "fragment": { class: 'content', owner: 'storyboard' },
  "materializedCompositionId": { class: 'content', owner: 'storyboard' },
  "candidateIds": { class: 'content', owner: 'storyboard' },
  "expectedFingerprint": { class: 'content', owner: 'storyboard' },
  "lineage": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<TimelineVariantOption>;

export const TimelineVariantOptionLineageFields = {
  "kind": { class: 'content', owner: 'storyboard' },
  "parentOptionIds": { class: 'content', owner: 'storyboard' },
  "instruction": { class: 'content', owner: 'storyboard' },
  "lockedSubranges": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<TimelineVariantOptionLineage>;

export const TimelineVariantScopeFields = {
  "startTime": { class: 'content', owner: 'storyboard' },
  "endTime": { class: 'content', owner: 'storyboard' },
  "trackIds": { class: 'content', owner: 'storyboard' },
  "includeLinked": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<TimelineVariantScope>;

export const TimelineVariantSetFields = {
  "schemaVersion": { class: 'content', owner: 'storyboard' },
  "id": { class: 'content', owner: 'storyboard' },
  "title": { class: 'content', owner: 'storyboard' },
  "baseCompositionId": { class: 'content', owner: 'storyboard' },
  "sceneIds": { class: 'content', owner: 'storyboard' },
  "scope": { class: 'content', owner: 'storyboard' },
  "baseFingerprint": { class: 'content', owner: 'storyboard' },
  "boundaryFingerprint": { class: 'content', owner: 'storyboard' },
  "status": { class: 'content', owner: 'storyboard' },
  "optionIds": { class: 'content', owner: 'storyboard' },
  "committedOptionId": { class: 'content', owner: 'storyboard' },
  "createdAt": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<TimelineVariantSet>;

export const TrackAudioStateFields = {
  "volumeDb": { class: 'content', owner: 'audio' },
  "pan": { class: 'content', owner: 'audio' },
  "muted": { class: 'content', owner: 'audio' },
  "solo": { class: 'content', owner: 'audio' },
  "recordArm": { class: 'workspace', owner: 'audio' },
  "inputMonitor": { class: 'workspace', owner: 'audio' },
  "inputDeviceId": { class: 'workspace', owner: 'audio' },
  "effectStack": { class: 'content', owner: 'audio' },
  "sends": { class: 'content', owner: 'audio' },
  "meterMode": { class: 'workspace', owner: 'audio' },
} as const satisfies FieldOwnershipMap<TrackAudioState>;

export const TrackingAssetFields = {
  "id": { class: 'content', owner: 'tracking' },
  "type": { class: 'content', owner: 'tracking' },
  "name": { class: 'content', owner: 'tracking' },
  "parentId": { class: 'content', owner: 'tracking' },
  "createdAt": { class: 'content', owner: 'tracking' },
  "sourceMediaId": { class: 'content', owner: 'tracking' },
  "sourceVideoClipId": { class: 'content', owner: 'tracking' },
  "sourceCompositionId": { class: 'content', owner: 'tracking' },
  "track": { class: 'content', owner: 'tracking' },
  "revision": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TrackingAsset>;

export const TrackingBindingFields = {
  "version": { class: 'content', owner: 'tracking' },
  "assetId": { class: 'content', owner: 'tracking' },
  "targetVideoClipId": { class: 'content', owner: 'tracking' },
  "mode": { class: 'content', owner: 'tracking' },
  "point": { class: 'content', owner: 'tracking' },
  "offset": { class: 'content', owner: 'tracking' },
  "placement": { class: 'content', owner: 'tracking' },
  "sourceStart": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<TrackingBinding>;

export const TransitionCompositionLinkFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "sourceLayout": { class: 'content', owner: 'timeline' },
  "legacyBackupCompositionId": { class: 'content', owner: 'timeline' },
  "parentCompositionId": { class: 'content', owner: 'timeline' },
  "parentTransitionId": { class: 'content', owner: 'timeline' },
  "parentOutgoingClipId": { class: 'content', owner: 'timeline' },
  "parentIncomingClipId": { class: 'content', owner: 'timeline' },
  "linkedOutgoingClipId": { class: 'content', owner: 'timeline' },
  "linkedIncomingClipId": { class: 'content', owner: 'timeline' },
  "innerTransitionId": { class: 'content', owner: 'timeline' },
  "templateType": { class: 'content', owner: 'timeline' },
  "templateVersion": { class: 'content', owner: 'timeline' },
  "templateParamsKey": { class: 'content', owner: 'timeline' },
  "paddingBefore": { class: 'content', owner: 'timeline' },
  "paddingAfter": { class: 'content', owner: 'timeline' },
  "bodyStart": { class: 'content', owner: 'timeline' },
  "bodyEnd": { class: 'content', owner: 'timeline' },
  "materialized": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionCompositionLink>;

export const TransitionOverlayClipDefinitionFields = {
  "pattern": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "widthRatio": { class: 'content', owner: 'timeline' },
  "softness": { class: 'content', owner: 'timeline' },
  "angle": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionOverlayClipDefinition>;

export const TransitionRecipeBlendWindowFields = {
  "compStart": { class: 'content', owner: 'timeline' },
  "compEnd": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionRecipeBlendWindow>;

export const TransitionSourceMapV1Fields = {
  "version": { class: 'content', owner: 'timeline' },
  "segments": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionSourceMapV1>;

export const TransitionSourceMapV2Fields = {
  "version": { class: 'content', owner: 'timeline' },
  "mediaDuration": { class: 'content', owner: 'timeline' },
  "parent": { class: 'content', owner: 'timeline' },
  "segments": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionSourceMapV2>;

export const TransitionSourceMapV2AnimationSnapshotFields = {
  "baseTransform": { class: 'content', owner: 'timeline' },
  "parameterTimelineStart": { class: 'content', owner: 'timeline' },
  "keyframes": { class: 'content', owner: 'timeline' },
  "sourceEffectIds": { class: 'content', owner: 'timeline' },
  "sourceMaskIds": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionSourceMapV2AnimationSnapshot>;

export const TransitionSourceMapV2ParentContractFields = {
  "duration": { class: 'content', owner: 'timeline' },
  "inPoint": { class: 'content', owner: 'timeline' },
  "outPoint": { class: 'content', owner: 'timeline' },
  "defaultSpeed": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<TransitionSourceMapV2ParentContract>;

export const VectorAnimationClipSettingsFields = {
  "loop": { class: 'content', owner: 'timeline' },
  "endBehavior": { class: 'content', owner: 'timeline' },
  "playbackMode": { class: 'content', owner: 'timeline' },
  "fit": { class: 'content', owner: 'timeline' },
  "renderWidth": { class: 'content', owner: 'timeline' },
  "renderHeight": { class: 'content', owner: 'timeline' },
  "backgroundColor": { class: 'content', owner: 'timeline' },
  "animationName": { class: 'content', owner: 'timeline' },
  "artboard": { class: 'content', owner: 'timeline' },
  "stateMachineName": { class: 'content', owner: 'timeline' },
  "stateMachineState": { class: 'content', owner: 'timeline' },
  "stateMachineStateCues": { class: 'content', owner: 'timeline' },
  "stateMachineInputValues": { class: 'content', owner: 'timeline' },
  "viewModelName": { class: 'content', owner: 'timeline' },
  "viewModelInstanceName": { class: 'content', owner: 'timeline' },
  "dataBindingValues": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationClipSettings>;

export const VectorAnimationDataBindingPropertyFields = {
  "name": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "viewModelName": { class: 'content', owner: 'timeline' },
  "defaultValue": { class: 'content', owner: 'timeline' },
  "values": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationDataBindingProperty>;

export const VectorAnimationMetadataFields = {
  "provider": { class: 'content', owner: 'timeline' },
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
  "fps": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "totalFrames": { class: 'content', owner: 'timeline' },
  "animationNames": { class: 'content', owner: 'timeline' },
  "defaultAnimationName": { class: 'content', owner: 'timeline' },
  "artboardNames": { class: 'content', owner: 'timeline' },
  "stateMachineNames": { class: 'content', owner: 'timeline' },
  "stateMachineStates": { class: 'content', owner: 'timeline' },
  "stateMachineInputs": { class: 'content', owner: 'timeline' },
  "viewModelNames": { class: 'content', owner: 'timeline' },
  "defaultViewModelName": { class: 'content', owner: 'timeline' },
  "viewModels": { class: 'content', owner: 'timeline' },
  "dataBindingProperties": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationMetadata>;

export const VectorAnimationStateCueFields = {
  "id": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "stateName": { class: 'content', owner: 'timeline' },
  "immediate": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationStateCue>;

export const VectorAnimationStateMachineInputFields = {
  "name": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "defaultValue": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationStateMachineInput>;

export const VectorAnimationViewModelMetadataFields = {
  "name": { class: 'content', owner: 'timeline' },
  "instanceNames": { class: 'content', owner: 'timeline' },
  "properties": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VectorAnimationViewModelMetadata>;

export const VisualStoryConceptFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "title": { class: 'content', owner: 'timeline' },
  "deliverableFormat": { class: 'content', owner: 'timeline' },
  "visualSummary": { class: 'content', owner: 'timeline' },
  "visualDramaturgy": { class: 'content', owner: 'timeline' },
  "premise": { class: 'content', owner: 'timeline' },
  "summary": { class: 'content', owner: 'timeline' },
  "visualCohesion": { class: 'content', owner: 'timeline' },
  "productionApproach": { class: 'content', owner: 'timeline' },
  "strongestOpportunity": { class: 'content', owner: 'timeline' },
  "largestRisk": { class: 'content', owner: 'timeline' },
  "targetDurationSeconds": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VisualStoryConcept>;

export const VisualStoryConceptReviewFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "conceptId": { class: 'content', owner: 'timeline' },
  "recommendation": { class: 'content', owner: 'timeline' },
  "summary": { class: 'content', owner: 'timeline' },
  "scores": { class: 'content', owner: 'timeline' },
  "strengths": { class: 'content', owner: 'timeline' },
  "weaknesses": { class: 'content', owner: 'timeline' },
  "requiredImprovements": { class: 'content', owner: 'timeline' },
  "optionalImprovements": { class: 'content', owner: 'timeline' },
  "alternative": { class: 'content', owner: 'timeline' },
  "duplicateOfConceptId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<VisualStoryConceptReview>;
