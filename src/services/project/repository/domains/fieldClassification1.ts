import type { FieldOwnershipMap } from './fieldOwnership';
import type { DocumentsProjectManifest } from '../../../../types/documents';
import type { DocumentsProjectState } from '../../../../types/documents';
import type { EditableHookLayerMetadata } from '../../../../types/timeline';
import type { Effect } from '../../../../types/effects';
import type { EffectOperatorGraph } from '../../../../types/operatorGraph';
import type { ExternalMediaOrigin } from '../../../../types/mediaMetadata';
import type { FaceStabilizationBake } from '../../../../types/faceStabilization';
import type { FieldMotionModifier } from '../../../motionDesign/modifiers/contracts';
import type { FinalVisualStoryConcept } from '../../../seedancePreproduction/orchestrationContracts';
import type { FloatingPanel } from '../../../../types/dock';
import type { FlockCacheSettings } from '../../../../types/flock';
import type { FlockDefinition } from '../../../../types/flock';
import type { FlockEdge } from '../../../../types/flock';
import type { FlockExposedParam } from '../../../../types/flock';
import type { FlockGroupDefinition } from '../../../../types/flock';
import type { FlockGroupPortBinding } from '../../../../types/flock';
import type { FlockNode } from '../../../../types/flock';
import type { FlockNodeLayout } from '../../../../types/flock';
import type { FlockPortRef } from '../../../../types/flock';
import type { FlockTimeSettings } from '../../../../types/flock';
import type { GmInstrument } from '../../../../types/midiClip';
import type { GradientStop } from '../../../../types/motionDesign';
import type { HistoryListEntry } from '../../../../types/history';
import type { HistoryTimelineEvent } from '../../../../types/history';
import type { JsonObject } from '../../../storyboard/contracts/models';
import type { KernelUserInputRequest } from '../../../kernelClient/types';
import type { Keyframe } from '../../../../types/keyframes';
import type { KeyframeNodeChannel } from '../../../../types/keyframeNode';
import type { KeyframeNodeDefinition } from '../../../../types/keyframeNode';
import type { LayerSourceRect } from '../../../../types/layers';
import type { LinearGradientAppearance } from '../../../../types/motionDesign';
import type { LinkedMediaSource } from '../../../../types/mediaMetadata';
import type { MarkerMIDIBinding } from '../../../../types/midi';
import type { MaskPathKeyframeValue } from '../../../../types/masks';
import type { MaskVertex } from '../../../../types/masks';
import type { MasterAudioState } from '../../../../types/audio';
import type { MediaFileAudioAnalysisRefs } from '../../../../types/audio';
import type { MediaFileStemInfo } from '../../../../types/audio';
import type { MediaPixelAspectRatio } from '../../../../types/mediaMetadata';
import type { MediaVideoColorSpace } from '../../../../types/mediaMetadata';
import type { MidiAdsr } from '../../../../types/midiClip';
import type { MidiClipAutomation } from '../../../../types/midiClip';
import type { MidiClipData } from '../../../../types/midiClip';
import type { MidiNote } from '../../../../types/midiClip';
import type { MIDINoteBinding } from '../../../../types/midi';
import type { MIDIParameterBinding } from '../../../../types/midi';
import type { ModMatrixRoute } from '../../../../types/midiClip';
import type { MotionColor } from '../../../../types/motionDesign';
import type { MotionExpressionBinding } from '../../../../types/motionDesign';
import type { MotionLayerDefinition } from '../../../../types/motionDesign';
import type { MotionLayerUiState } from '../../../../types/motionDesign';
import type { MotionModifierFalloff } from '../../../motionDesign/modifiers/contracts';
import type { MotionModifierStackContractV1 } from '../../../motionDesign/modifiers/contracts';
import type { MotionModifierTarget } from '../../../motionDesign/modifiers/contracts';
import type { MotionPathDash } from '../../../../types/motionDesign';
import type { MotionPathTrim } from '../../../../types/motionDesign';
import type { MotionPathVertex } from '../../../../types/motionDesign';
import type { MotionVector2 } from '../../../../types/motionDesign';
import type { MulticamAngle } from '../../../../types/multicam';
import type { MulticamAngleSource } from '../../../../types/multicam';
import type { MulticamClipTemplate } from '../../../../types/multicam';
import type { MultiPreviewPanelData } from '../../../../types/dock';
import type { MultiPreviewSlotData } from '../../../../types/dock';
import type { NodeCableBranch } from '../../../../types/nodeGraph';
import type { NodeCanvasPlacement } from '../../../../types/nodeGraph';
import type { NodeGraphEdge } from '../../../../types/nodeGraph';

export const DocumentsProjectManifestFields = {
  "schemaVersion": { class: 'content', owner: 'documents' },
  "activeDocumentId": { class: 'workspace', owner: 'documents' },
  "artifacts": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentsProjectManifest>;

export const DocumentsProjectStateFields = {
  "schemaVersion": { class: 'content', owner: 'documents' },
  "documents": { class: 'content', owner: 'documents' },
  "activeDocumentId": { class: 'workspace', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentsProjectState>;

export const EditableHookLayerMetadataFields = {
  "id": { class: 'content', owner: 'timeline' },
  "role": { class: 'content', owner: 'timeline' },
  "rowIndex": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<EditableHookLayerMetadata>;

export const EffectFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
  "operatorGraph": { class: 'content', owner: 'timeline' },
  "detached": { class: 'content', owner: 'timeline' },
  "surfaceTrack": { class: 'content', owner: 'timeline' },
  "terrainRender": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<Effect>;

export const EffectOperatorGraphFields = {
  "version": { class: 'content', owner: 'timeline' },
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "compositionRules": { class: 'content', owner: 'timeline' },
  "colorCompositionRules": { class: 'content', owner: 'timeline' },
  "samplingCompositionRules": { class: 'content', owner: 'timeline' },
  "processingCompositionRules": { class: 'content', owner: 'timeline' },
  "effectPresentationRules": { class: 'content', owner: 'timeline' },
  "gaussianBlurPresentation": { class: 'content', owner: 'timeline' },
  "incomplete": { class: 'content', owner: 'timeline' },
  "domain": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "edges": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
  "groups": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<EffectOperatorGraph>;

export const ExternalMediaOriginFields = {
  "provider": { class: 'content', owner: 'media' },
  "providerLabel": { class: 'content', owner: 'media' },
  "assetId": { class: 'content', owner: 'media' },
  "sourcePageUrl": { class: 'content', owner: 'media' },
  "contextUrl": { class: 'content', owner: 'media' },
  "originalUrl": { class: 'content', owner: 'media' },
  "creator": { class: 'content', owner: 'media' },
  "creatorUrl": { class: 'content', owner: 'media' },
  "licenseName": { class: 'content', owner: 'media' },
  "licenseUrl": { class: 'content', owner: 'media' },
  "attribution": { class: 'content', owner: 'media' },
  "rightsStatus": { class: 'content', owner: 'media' },
  "rightsNote": { class: 'content', owner: 'media' },
  "retrievedAt": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<ExternalMediaOrigin>;

export const FaceStabilizationBakeFields = {
  "version": { class: 'content', owner: 'timeline' },
  "target": { class: 'content', owner: 'timeline' },
  "lockCenter": { class: 'content', owner: 'timeline' },
  "smoothing": { class: 'content', owner: 'timeline' },
  "sourceId": { class: 'content', owner: 'timeline' },
  "trackingCreatedAt": { class: 'content', owner: 'timeline' },
  "bakedAt": { class: 'content', owner: 'timeline' },
  "frameRate": { class: 'content', owner: 'timeline' },
  "sampleCount": { class: 'content', owner: 'timeline' },
  "detectedSamples": { class: 'content', owner: 'timeline' },
  "inputSignature": { class: 'content', owner: 'timeline' },
  "curveSignature": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FaceStabilizationBake>;

export const FieldMotionModifierFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "field": { class: 'content', owner: 'timeline' },
  "center": { class: 'content', owner: 'timeline' },
  "radius": { class: 'content', owner: 'timeline' },
  "exponent": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "order": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FieldMotionModifier>;

export const FinalVisualStoryConceptFields = {
  "rank": { class: 'content', owner: 'timeline' },
  "lineage": { class: 'content', owner: 'timeline' },
  "changeSummary": { class: 'content', owner: 'timeline' },
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
} as const satisfies FieldOwnershipMap<FinalVisualStoryConcept>;

export const FloatingPanelFields = {
  "id": { class: 'content', owner: 'timeline' },
  "panel": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "size": { class: 'content', owner: 'timeline' },
  "zIndex": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FloatingPanel>;

export const FlockCacheSettingsFields = {
  "precomputeStart": { class: 'content', owner: 'timeline' },
  "precomputeEnd": { class: 'content', owner: 'timeline' },
  "persist": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockCacheSettings>;

export const FlockDefinitionFields = {
  "version": { class: 'content', owner: 'timeline' },
  "presetId": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "edges": { class: 'content', owner: 'timeline' },
  "exposed": { class: 'content', owner: 'timeline' },
  "groups": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "cache": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockDefinition>;

export const FlockEdgeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "from": { class: 'content', owner: 'timeline' },
  "to": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockEdge>;

export const FlockExposedParamFields = {
  "id": { class: 'content', owner: 'timeline' },
  "nodeId": { class: 'content', owner: 'timeline' },
  "param": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "group": { class: 'content', owner: 'timeline' },
  "order": { class: 'content', owner: 'timeline' },
  "min": { class: 'content', owner: 'timeline' },
  "max": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockExposedParam>;

export const FlockGroupDefinitionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "version": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "edges": { class: 'content', owner: 'timeline' },
  "inputs": { class: 'content', owner: 'timeline' },
  "outputs": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockGroupDefinition>;

export const FlockGroupPortBindingFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "required": { class: 'content', owner: 'timeline' },
  "target": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockGroupPortBinding>;

export const FlockNodeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "operator": { class: 'content', owner: 'timeline' },
  "operatorVersion": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
  "bypassed": { class: 'content', owner: 'timeline' },
  "groupRef": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockNode>;

export const FlockNodeLayoutFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockNodeLayout>;

export const FlockPortRefFields = {
  "nodeId": { class: 'content', owner: 'timeline' },
  "port": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockPortRef>;

export const FlockTimeSettingsFields = {
  "loop": { class: 'content', owner: 'timeline' },
  "loopSeconds": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<FlockTimeSettings>;

export const GmInstrumentFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "program": { class: 'content', owner: 'timeline' },
  "isDrum": { class: 'content', owner: 'timeline' },
  "gain": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<GmInstrument>;

export const GradientStopFields = {
  "id": { class: 'content', owner: 'timeline' },
  "offset": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<GradientStop>;

export const HistoryListEntryFields = {
  "id": { class: 'content', owner: 'timeline' },
  "kind": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "timestamp": { class: 'content', owner: 'timeline' },
  "nodeId": { class: 'content', owner: 'timeline' },
  "parentNodeId": { class: 'content', owner: 'timeline' },
  "onActivePath": { class: 'content', owner: 'timeline' },
  "stackIndex": { class: 'content', owner: 'timeline' },
  "eventType": { class: 'content', owner: 'timeline' },
  "active": { class: 'content', owner: 'timeline' },
  "highlighted": { class: 'content', owner: 'timeline' },
  "branchId": { class: 'content', owner: 'timeline' },
  "branchLabel": { class: 'content', owner: 'timeline' },
  "branchIndex": { class: 'content', owner: 'timeline' },
  "branchBaseStackIndex": { class: 'content', owner: 'timeline' },
  "branchBaseTimestamp": { class: 'content', owner: 'timeline' },
  "branchLength": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<HistoryListEntry>;

export const HistoryTimelineEventFields = {
  "id": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "timestamp": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<HistoryTimelineEvent>;

export const JsonObjectFields = {
} as const satisfies FieldOwnershipMap<JsonObject>;

export const KernelUserInputRequestFields = {
  "allowFreeform": { class: 'content', owner: 'timeline' },
  "allowMultiple": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "options": { class: 'content', owner: 'timeline' },
  "question": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<KernelUserInputRequest>;

export const KeyframeFields = {
  "animationSource": { class: 'content', owner: 'timeline' },
  "hold": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "clipId": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "property": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
  "pathValue": { class: 'content', owner: 'timeline' },
  "easing": { class: 'content', owner: 'timeline' },
  "rotationInterpolation": { class: 'content', owner: 'timeline' },
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<Keyframe>;

export const KeyframeNodeChannelFields = {
  "id": { class: 'content', owner: 'timeline' },
  "property": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<KeyframeNodeChannel>;

export const KeyframeNodeDefinitionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
  "channels": { class: 'content', owner: 'timeline' },
  "presentation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<KeyframeNodeDefinition>;

export const LayerSourceRectFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<LayerSourceRect>;

export const LinearGradientAppearanceFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "stops": { class: 'content', owner: 'timeline' },
  "start": { class: 'content', owner: 'timeline' },
  "end": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<LinearGradientAppearance>;

export const LinkedMediaSourceFields = {
  "id": { class: 'content', owner: 'media' },
  "name": { class: 'content', owner: 'media' },
  "sourcePath": { class: 'resolver', owner: 'media' },
  "fileKey": { class: 'resolver', owner: 'media' },
  "role": { class: 'content', owner: 'media' },
  "origin": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<LinkedMediaSource>;

export const MarkerMIDIBindingFields = {
  "action": { class: 'content', owner: 'midi' },
  "channel": { class: 'content', owner: 'midi' },
  "note": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MarkerMIDIBinding>;

export const MaskPathKeyframeValueFields = {
  "vertices": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MaskPathKeyframeValue>;

export const MaskVertexFields = {
  "id": { class: 'content', owner: 'timeline' },
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
  "handleMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MaskVertex>;

export const MasterAudioStateFields = {
  "volumeDb": { class: 'content', owner: 'audio' },
  "limiterEnabled": { class: 'content', owner: 'audio' },
  "targetLufs": { class: 'content', owner: 'audio' },
  "truePeakCeilingDb": { class: 'content', owner: 'audio' },
  "effectStack": { class: 'content', owner: 'audio' },
  "exportPreflight": { class: 'workspace', owner: 'audio' },
} as const satisfies FieldOwnershipMap<MasterAudioState>;

export const MediaFileAudioAnalysisRefsFields = {
  "waveformPyramidId": { class: 'content', owner: 'audio' },
  "processedWaveformPyramidId": { class: 'content', owner: 'audio' },
  "spectrogramTileSetIds": { class: 'content', owner: 'audio' },
  "loudnessEnvelopeId": { class: 'content', owner: 'audio' },
  "beatGridId": { class: 'content', owner: 'audio' },
  "onsetMapId": { class: 'content', owner: 'audio' },
  "phaseCorrelationId": { class: 'content', owner: 'audio' },
  "transcriptTimingId": { class: 'content', owner: 'audio' },
  "frequencySummaryId": { class: 'content', owner: 'audio' },
  "voiceActivityId": { class: 'content', owner: 'audio' },
  "speechMarkersId": { class: 'content', owner: 'audio' },
  "prosodyContourId": { class: 'content', owner: 'audio' },
  "roomToneProfileId": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<MediaFileAudioAnalysisRefs>;

export const MediaFileStemInfoFields = {
  "schemaVersion": { class: 'content', owner: 'audio' },
  "sourceMediaFileId": { class: 'content', owner: 'audio' },
  "sourceFingerprint": { class: 'content', owner: 'audio' },
  "sourceClipId": { class: 'content', owner: 'audio' },
  "sourceClipName": { class: 'content', owner: 'audio' },
  "activeSetId": { class: 'content', owner: 'audio' },
  "modelId": { class: 'content', owner: 'audio' },
  "modelVersion": { class: 'content', owner: 'audio' },
  "kind": { class: 'content', owner: 'audio' },
  "label": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<MediaFileStemInfo>;

export const MediaPixelAspectRatioFields = {
  "numerator": { class: 'content', owner: 'media' },
  "denominator": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<MediaPixelAspectRatio>;

export const MediaVideoColorSpaceFields = {
  "primaries": { class: 'content', owner: 'media' },
  "transfer": { class: 'content', owner: 'media' },
  "matrix": { class: 'content', owner: 'media' },
  "fullRange": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<MediaVideoColorSpace>;

export const MidiAdsrFields = {
  "attack": { class: 'content', owner: 'midi' },
  "decay": { class: 'content', owner: 'midi' },
  "sustain": { class: 'content', owner: 'midi' },
  "release": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MidiAdsr>;

export const MidiClipAutomationFields = {
  "cutoff": { class: 'content', owner: 'midi' },
  "mod": { class: 'content', owner: 'midi' },
  "expression": { class: 'content', owner: 'midi' },
  "pitchBend": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MidiClipAutomation>;

export const MidiClipDataFields = {
  "notes": { class: 'content', owner: 'midi' },
  "provenance": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MidiClipData>;

export const MidiNoteFields = {
  "id": { class: 'content', owner: 'midi' },
  "pitch": { class: 'content', owner: 'midi' },
  "start": { class: 'content', owner: 'midi' },
  "duration": { class: 'content', owner: 'midi' },
  "velocity": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MidiNote>;

export const MIDINoteBindingFields = {
  "channel": { class: 'content', owner: 'midi' },
  "note": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MIDINoteBinding>;

export const MIDIParameterBindingFields = {
  "id": { class: 'content', owner: 'midi' },
  "message": { class: 'content', owner: 'midi' },
  "invert": { class: 'content', owner: 'midi' },
  "damping": { class: 'content', owner: 'midi' },
  "clipId": { class: 'content', owner: 'midi' },
  "property": { class: 'content', owner: 'midi' },
  "properties": { class: 'content', owner: 'midi' },
  "label": { class: 'content', owner: 'midi' },
  "min": { class: 'content', owner: 'midi' },
  "max": { class: 'content', owner: 'midi' },
  "currentValue": { class: 'workspace', owner: 'midi' },
} as const satisfies FieldOwnershipMap<MIDIParameterBinding>;

export const ModMatrixRouteFields = {
  "source": { class: 'content', owner: 'timeline' },
  "destination": { class: 'content', owner: 'timeline' },
  "amount": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ModMatrixRoute>;

export const MotionColorFields = {
  "r": { class: 'content', owner: 'timeline' },
  "g": { class: 'content', owner: 'timeline' },
  "b": { class: 'content', owner: 'timeline' },
  "a": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionColor>;

export const MotionExpressionBindingFields = {
  "id": { class: 'content', owner: 'timeline' },
  "path": { class: 'content', owner: 'timeline' },
  "source": { class: 'content', owner: 'timeline' },
  "fallback": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionExpressionBinding>;

export const MotionLayerDefinitionFields = {
  "version": { class: 'content', owner: 'timeline' },
  "kind": { class: 'content', owner: 'timeline' },
  "shape": { class: 'content', owner: 'timeline' },
  "appearance": { class: 'content', owner: 'timeline' },
  "replicator": { class: 'content', owner: 'timeline' },
  "modifierStack": { class: 'content', owner: 'timeline' },
  "expressions": { class: 'content', owner: 'timeline' },
  "replicatorRecovery": { class: 'content', owner: 'timeline' },
  "ui": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionLayerDefinition>;

export const MotionLayerUiStateFields = {
  "labelColor": { class: 'content', owner: 'timeline' },
  "locked": { class: 'content', owner: 'timeline' },
  "pinnedProperties": { class: 'content', owner: 'timeline' },
  "propertiesSearch": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionLayerUiState>;

export const MotionModifierFalloffFields = {
  "shapeClipId": { class: 'content', owner: 'timeline' },
  "shapeRevision": { class: 'content', owner: 'timeline' },
  "feather": { class: 'content', owner: 'timeline' },
  "invert": { class: 'content', owner: 'timeline' },
  "clip": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionModifierFalloff>;

export const MotionModifierStackContractV1Fields = {
  "contract": { class: 'content', owner: 'timeline' },
  "version": { class: 'content', owner: 'timeline' },
  "revision": { class: 'content', owner: 'timeline' },
  "timeBasis": { class: 'content', owner: 'timeline' },
  "ticksPerSecond": { class: 'content', owner: 'timeline' },
  "modifiers": { class: 'content', owner: 'timeline' },
  "falloff": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionModifierStackContractV1>;

export const MotionModifierTargetFields = {
  "path": { class: 'content', owner: 'timeline' },
  "operation": { class: 'content', owner: 'timeline' },
  "amount": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionModifierTarget>;

export const MotionPathDashFields = {
  "length": { class: 'content', owner: 'timeline' },
  "gap": { class: 'content', owner: 'timeline' },
  "offset": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionPathDash>;

export const MotionPathTrimFields = {
  "start": { class: 'content', owner: 'timeline' },
  "end": { class: 'content', owner: 'timeline' },
  "offset": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionPathTrim>;

export const MotionPathVertexFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionPathVertex>;

export const MotionVector2Fields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MotionVector2>;

export const MulticamAngleFields = {
  "trackId": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "sources": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MulticamAngle>;

export const MulticamAngleSourceFields = {
  "mediaFileId": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "inPoint": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "template": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MulticamAngleSource>;

export const MulticamClipTemplateFields = {
  "name": { class: 'content', owner: 'storyboard' },
  "transform": { class: 'content', owner: 'storyboard' },
  "effects": { class: 'content', owner: 'storyboard' },
  "masks": { class: 'content', owner: 'storyboard' },
} as const satisfies FieldOwnershipMap<MulticamClipTemplate>;

export const MultiPreviewPanelDataFields = {
  "sourceCompositionId": { class: 'content', owner: 'timeline' },
  "slots": { class: 'content', owner: 'timeline' },
  "showTransparencyGrid": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MultiPreviewPanelData>;

export const MultiPreviewSlotDataFields = {
  "compositionId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<MultiPreviewSlotData>;

export const NodeCableBranchFields = {
  "nodeId": { class: 'content', owner: 'timeline' },
  "portId": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeCableBranch>;

export const NodeCanvasPlacementFields = {
  "compactEffects": { class: 'content', owner: 'timeline' },
  "branches": { class: 'content', owner: 'timeline' },
  "flowLayoutVersion": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "pinned": { class: 'content', owner: 'timeline' },
  "displaced": { class: 'content', owner: 'timeline' },
  "groups": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeCanvasPlacement>;

export const NodeGraphEdgeFields = {
  "readOnly": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "fromNodeId": { class: 'content', owner: 'timeline' },
  "fromPortId": { class: 'content', owner: 'timeline' },
  "toNodeId": { class: 'content', owner: 'timeline' },
  "toPortId": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeGraphEdge>;
