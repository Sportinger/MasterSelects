import type { FieldOwnershipMap } from './fieldOwnership';
import type { AppearanceStack } from '../../../../types/motionDesign';
import type { AudioAnalysisArtifact } from '../../../../types/audio';
import type { AudioAnalysisWarning } from '../../../../types/audio';
import type { AudioArtifactByteRange } from '../../../../types/audio';
import type { AudioBakeRestoreState } from '../../../../types/audio';
import type { AudioChannelLayout } from '../../../../types/audio';
import type { AudioDerivedAssetRef } from '../../../../types/audio';
import type { AudioEffectInstance } from '../../../../types/audio';
import type { AudioExportPreflightMeasurement } from '../../../../types/audio';
import type { AudioExportPreflightMeasurementHistoryEntry } from '../../../../types/audio';
import type { AudioExportPreflightState } from '../../../../types/audio';
import type { AudioSendState } from '../../../../types/audio';
import type { AudioSignalArtifactRef } from '../../../../types/audio';
import type { AutomationLane } from '../../../../types/midiClip';
import type { AutomationPoint } from '../../../../types/midiClip';
import type { BezierHandle } from '../../../../types/animationProperties';
import type { BoundOperatorNode } from '../../../../types/operatorGraph';
import type { CaptionBackgroundProperties } from '../../../../types/caption';
import type { CaptionClipProperties } from '../../../../types/caption';
import type { CaptionCompositionLink } from '../../../../types/caption';
import type { CaptionHighlightProperties } from '../../../../types/caption';
import type { CaptionLayerBinding } from '../../../../types/caption';
import type { ClipAudioEditOperation } from '../../../../types/audio';
import type { ClipAudioState } from '../../../../types/audio';
import type { ClipAudioStemLayer } from '../../../../types/audio';
import type { ClipAudioStemState } from '../../../../types/audio';
import type { ClipCustomNodeAIAuthoring } from '../../../../types/nodeGraph';
import type { ClipCustomNodeConversationMessage } from '../../../../types/nodeGraph';
import type { ClipCustomNodeDefinition } from '../../../../types/nodeGraph';
import type { ClipCustomNodeParamDefinition } from '../../../../types/nodeGraph';
import type { ClipCustomNodeParamOption } from '../../../../types/nodeGraph';
import type { ClipMask } from '../../../../types/masks';
import type { ClipNodeGraph } from '../../../../types/nodeGraph';
import type { ClipNodeGraphNodeState } from '../../../../types/nodeGraph';
import type { ClipStabilizationGraph } from '../../../../types/faceStabilization';
import type { ClipTransform } from '../../../../types/timelineCore';
import type { ColorCorrectionState } from '../../../../types/colorCorrection';
import type { ColorCorrectionUiState } from '../../../../types/colorCorrection';
import type { ColorEdge } from '../../../../types/colorCorrection';
import type { ColorFillAppearance } from '../../../../types/motionDesign';
import type { ColorGradeVersion } from '../../../../types/colorCorrection';
import type { ColorNode } from '../../../../types/colorCorrection';
import type { CommonsSourceAsset } from '../../../seedancePreproduction/contracts';
import type { CompositionMulticam } from '../../../../types/multicam';
import type { CurvesPanelData } from '../../../../types/dock';
import type { DenseTerrainMesh } from '../../../../types/terrainTracking';
import type { DepthMapMetadata } from '../../../../types/depthMap';
import type { DockLayout } from '../../../../types/dock';
import type { DockPanel } from '../../../../types/dock';
import type { DockSplit } from '../../../../types/dock';
import type { DockTabGroup } from '../../../../types/dock';
import type { DocumentAnchor } from '../../../../types/documents';
import type { DocumentBlock } from '../../../../types/documents';
import type { DocumentComment } from '../../../../types/documents';
import type { DocumentLink } from '../../../../types/documents';
import type { DocumentSource } from '../../../../types/documents';

export const AppearanceStackFields = {
  "version": { class: 'content', owner: 'timeline' },
  "items": { class: 'content', owner: 'timeline' },
  "selectedItemId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<AppearanceStack>;

export const AudioAnalysisArtifactFields = {
  "schemaVersion": { class: 'content', owner: 'audio' },
  "id": { class: 'content', owner: 'audio' },
  "kind": { class: 'content', owner: 'audio' },
  "mediaFileId": { class: 'content', owner: 'audio' },
  "sourceFingerprint": { class: 'content', owner: 'audio' },
  "clipAudioStateHash": { class: 'content', owner: 'audio' },
  "decoderId": { class: 'content', owner: 'audio' },
  "decoderVersion": { class: 'content', owner: 'audio' },
  "analyzerVersion": { class: 'content', owner: 'audio' },
  "sampleRate": { class: 'content', owner: 'audio' },
  "channelLayout": { class: 'content', owner: 'audio' },
  "duration": { class: 'content', owner: 'audio' },
  "payloadRefs": { class: 'content', owner: 'audio' },
  "manifestRef": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
  "stale": { class: 'content', owner: 'audio' },
  "warnings": { class: 'content', owner: 'audio' },
  "metadata": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioAnalysisArtifact>;

export const AudioAnalysisWarningFields = {
  "code": { class: 'content', owner: 'audio' },
  "message": { class: 'content', owner: 'audio' },
  "severity": { class: 'content', owner: 'audio' },
  "details": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioAnalysisWarning>;

export const AudioArtifactByteRangeFields = {
  "offset": { class: 'content', owner: 'audio' },
  "length": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioArtifactByteRange>;

export const AudioBakeRestoreStateFields = {
  "name": { class: 'content', owner: 'audio' },
  "mediaFileId": { class: 'content', owner: 'audio' },
  "duration": { class: 'content', owner: 'audio' },
  "inPoint": { class: 'content', owner: 'audio' },
  "outPoint": { class: 'content', owner: 'audio' },
  "sourceNaturalDuration": { class: 'content', owner: 'audio' },
  "waveform": { class: 'cache', owner: 'audio' },
  "waveformChannels": { class: 'cache', owner: 'audio' },
  "audioState": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioBakeRestoreState>;

export const AudioChannelLayoutFields = {
  "kind": { class: 'content', owner: 'audio' },
  "channelCount": { class: 'content', owner: 'audio' },
  "labels": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioChannelLayout>;

export const AudioDerivedAssetRefFields = {
  "id": { class: 'content', owner: 'audio' },
  "mediaFileId": { class: 'content', owner: 'audio' },
  "sourceMediaFileId": { class: 'content', owner: 'audio' },
  "sourceClipId": { class: 'content', owner: 'audio' },
  "operationIds": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
  "provenance": { class: 'content', owner: 'audio' },
  "restore": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioDerivedAssetRef>;

export const AudioEffectInstanceFields = {
  "id": { class: 'content', owner: 'audio' },
  "descriptorId": { class: 'content', owner: 'audio' },
  "enabled": { class: 'content', owner: 'audio' },
  "params": { class: 'content', owner: 'audio' },
  "automationMode": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioEffectInstance>;

export const AudioExportPreflightMeasurementFields = {
  "mode": { class: 'content', owner: 'audio' },
  "duration": { class: 'content', owner: 'audio' },
  "sampleRate": { class: 'content', owner: 'audio' },
  "channelCount": { class: 'content', owner: 'audio' },
  "integratedLufs": { class: 'content', owner: 'audio' },
  "truePeakDbtp": { class: 'content', owner: 'audio' },
  "samplePeakDbfs": { class: 'content', owner: 'audio' },
  "rmsDbfs": { class: 'content', owner: 'audio' },
  "targetLufs": { class: 'content', owner: 'audio' },
  "loudnessDelta": { class: 'content', owner: 'audio' },
  "truePeakCeilingDb": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioExportPreflightMeasurement>;

export const AudioExportPreflightMeasurementHistoryEntryFields = {
  "checkedAt": { class: 'content', owner: 'audio' },
  "startTime": { class: 'content', owner: 'audio' },
  "endTime": { class: 'content', owner: 'audio' },
  "measurement": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioExportPreflightMeasurementHistoryEntry>;

export const AudioExportPreflightStateFields = {
  "lastCheckedAt": { class: 'content', owner: 'audio' },
  "warnings": { class: 'content', owner: 'audio' },
  "measurement": { class: 'content', owner: 'audio' },
  "measurementHistory": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioExportPreflightState>;

export const AudioSendStateFields = {
  "id": { class: 'content', owner: 'audio' },
  "targetBusId": { class: 'content', owner: 'audio' },
  "gainDb": { class: 'content', owner: 'audio' },
  "preFader": { class: 'content', owner: 'audio' },
  "enabled": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioSendState>;

export const AudioSignalArtifactRefFields = {
  "artifactId": { class: 'content', owner: 'audio' },
  "hash": { class: 'content', owner: 'audio' },
  "size": { class: 'content', owner: 'audio' },
  "mimeType": { class: 'content', owner: 'audio' },
  "encoding": { class: 'content', owner: 'audio' },
  "storage": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
  "byteRange": { class: 'content', owner: 'audio' },
  "metadata": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<AudioSignalArtifactRef>;

export const AutomationLaneFields = {
  "points": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<AutomationLane>;

export const AutomationPointFields = {
  "time": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<AutomationPoint>;

export const BezierHandleFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<BezierHandle>;

export const BoundOperatorNodeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "operator": { class: 'content', owner: 'timeline' },
  "bindings": { class: 'content', owner: 'timeline' },
  "operatorVersion": { class: 'content', owner: 'timeline' },
  "constants": { class: 'content', owner: 'timeline' },
  "valueControl": { class: 'content', owner: 'timeline' },
  "exposed": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "enabledDefault": { class: 'content', owner: 'timeline' },
  "bypassed": { class: 'content', owner: 'timeline' },
  "composition": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<BoundOperatorNode>;

export const CaptionBackgroundPropertiesFields = {
  "enabled": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "paddingX": { class: 'content', owner: 'timeline' },
  "paddingY": { class: 'content', owner: 'timeline' },
  "borderRadius": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CaptionBackgroundProperties>;

export const CaptionClipPropertiesFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "sourceClipId": { class: 'content', owner: 'timeline' },
  "wordsPerCaption": { class: 'content', owner: 'timeline' },
  "gapThreshold": { class: 'content', owner: 'timeline' },
  "holdAfter": { class: 'content', owner: 'timeline' },
  "maxLines": { class: 'content', owner: 'timeline' },
  "positionX": { class: 'content', owner: 'timeline' },
  "positionY": { class: 'content', owner: 'timeline' },
  "maxWidth": { class: 'content', owner: 'timeline' },
  "textAlign": { class: 'content', owner: 'timeline' },
  "fontFamily": { class: 'content', owner: 'timeline' },
  "fontSize": { class: 'content', owner: 'timeline' },
  "fontWeight": { class: 'content', owner: 'timeline' },
  "fontStyle": { class: 'content', owner: 'timeline' },
  "textTransform": { class: 'content', owner: 'timeline' },
  "lineHeight": { class: 'content', owner: 'timeline' },
  "letterSpacing": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "outlineEnabled": { class: 'content', owner: 'timeline' },
  "outlineColor": { class: 'content', owner: 'timeline' },
  "outlineWidth": { class: 'content', owner: 'timeline' },
  "background": { class: 'content', owner: 'timeline' },
  "highlight": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CaptionClipProperties>;

export const CaptionCompositionLinkFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "templateVersion": { class: 'content', owner: 'timeline' },
  "parentCompositionId": { class: 'content', owner: 'timeline' },
  "parentCaptionClipId": { class: 'content', owner: 'timeline' },
  "inputClipId": { class: 'content', owner: 'timeline' },
  "textClipId": { class: 'content', owner: 'timeline' },
  "backgroundClipId": { class: 'content', owner: 'timeline' },
  "previewText": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CaptionCompositionLink>;

export const CaptionHighlightPropertiesFields = {
  "enabled": { class: 'content', owner: 'timeline' },
  "mode": { class: 'content', owner: 'timeline' },
  "style": { class: 'content', owner: 'timeline' },
  "scaleEnabled": { class: 'content', owner: 'timeline' },
  "scale": { class: 'content', owner: 'timeline' },
  "textColor": { class: 'content', owner: 'timeline' },
  "backgroundColor": { class: 'content', owner: 'timeline' },
  "backgroundOpacity": { class: 'content', owner: 'timeline' },
  "underlineColor": { class: 'content', owner: 'timeline' },
  "underlineWidth": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CaptionHighlightProperties>;

export const CaptionLayerBindingFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "role": { class: 'content', owner: 'timeline' },
  "inputClipId": { class: 'content', owner: 'timeline' },
  "textClipId": { class: 'content', owner: 'timeline' },
  "paddingX": { class: 'content', owner: 'timeline' },
  "paddingY": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CaptionLayerBinding>;

export const ClipAudioEditOperationFields = {
  "id": { class: 'content', owner: 'audio' },
  "type": { class: 'content', owner: 'audio' },
  "enabled": { class: 'content', owner: 'audio' },
  "params": { class: 'content', owner: 'audio' },
  "timeRange": { class: 'content', owner: 'audio' },
  "channelMask": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<ClipAudioEditOperation>;

export const ClipAudioStateFields = {
  "sourceAudioRevisionId": { class: 'content', owner: 'audio' },
  "editStack": { class: 'content', owner: 'audio' },
  "effectStack": { class: 'content', owner: 'audio' },
  "spectralLayers": { class: 'content', owner: 'audio' },
  "stemSeparation": { class: 'content', owner: 'audio' },
  "sourceAnalysisRefs": { class: 'content', owner: 'audio' },
  "processedAnalysisRefs": { class: 'content', owner: 'audio' },
  "bakeHistory": { class: 'content', owner: 'audio' },
  "muted": { class: 'content', owner: 'audio' },
  "soloSafe": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<ClipAudioState>;

export const ClipAudioStemLayerFields = {
  "id": { class: 'content', owner: 'audio' },
  "kind": { class: 'content', owner: 'audio' },
  "label": { class: 'content', owner: 'audio' },
  "analysisArtifactId": { class: 'content', owner: 'audio' },
  "manifestArtifactId": { class: 'content', owner: 'audio' },
  "payloadRef": { class: 'content', owner: 'audio' },
  "mediaFileId": { class: 'content', owner: 'audio' },
  "waveform": { class: 'cache', owner: 'audio' },
  "enabled": { class: 'content', owner: 'audio' },
  "gainDb": { class: 'content', owner: 'audio' },
  "phaseAligned": { class: 'content', owner: 'audio' },
  "modelId": { class: 'content', owner: 'audio' },
  "sourceFingerprint": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<ClipAudioStemLayer>;

export const ClipAudioStemStateFields = {
  "activeSetId": { class: 'content', owner: 'audio' },
  "modelId": { class: 'content', owner: 'audio' },
  "modelVersion": { class: 'content', owner: 'audio' },
  "createdAt": { class: 'content', owner: 'audio' },
  "sourceFingerprint": { class: 'content', owner: 'audio' },
  "range": { class: 'content', owner: 'audio' },
  "sampleRate": { class: 'content', owner: 'audio' },
  "channelCount": { class: 'content', owner: 'audio' },
  "stems": { class: 'content', owner: 'audio' },
  "soloStemId": { class: 'content', owner: 'audio' },
  "sourceGainDb": { class: 'content', owner: 'audio' },
  "mixMode": { class: 'content', owner: 'audio' },
} as const satisfies FieldOwnershipMap<ClipAudioStemState>;

export const ClipCustomNodeAIAuthoringFields = {
  "prompt": { class: 'content', owner: 'timeline' },
  "plan": { class: 'content', owner: 'timeline' },
  "generatedCode": { class: 'content', owner: 'timeline' },
  "conversation": { class: 'content', owner: 'timeline' },
  "conversationSummary": { class: 'content', owner: 'timeline' },
  "updatedAt": { class: 'content', owner: 'timeline' },
  "acceptedAt": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipCustomNodeAIAuthoring>;

export const ClipCustomNodeConversationMessageFields = {
  "id": { class: 'content', owner: 'timeline' },
  "role": { class: 'content', owner: 'timeline' },
  "kind": { class: 'content', owner: 'timeline' },
  "content": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipCustomNodeConversationMessage>;

export const ClipCustomNodeDefinitionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "description": { class: 'content', owner: 'timeline' },
  "bypassed": { class: 'content', owner: 'timeline' },
  "runtime": { class: 'content', owner: 'timeline' },
  "status": { class: 'content', owner: 'timeline' },
  "inputs": { class: 'content', owner: 'timeline' },
  "outputs": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
  "parameterSchema": { class: 'content', owner: 'timeline' },
  "ai": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipCustomNodeDefinition>;

export const ClipCustomNodeParamDefinitionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "default": { class: 'content', owner: 'timeline' },
  "min": { class: 'content', owner: 'timeline' },
  "max": { class: 'content', owner: 'timeline' },
  "step": { class: 'content', owner: 'timeline' },
  "options": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipCustomNodeParamDefinition>;

export const ClipCustomNodeParamOptionFields = {
  "label": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipCustomNodeParamOption>;

export const ClipMaskFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "purpose": { class: 'content', owner: 'timeline' },
  "compositeEnabled": { class: 'content', owner: 'timeline' },
  "vertices": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "feather": { class: 'content', owner: 'timeline' },
  "featherOffset": { class: 'content', owner: 'timeline' },
  "featherBalance": { class: 'content', owner: 'timeline' },
  "edgeFeathers": { class: 'content', owner: 'timeline' },
  "featherQuality": { class: 'content', owner: 'timeline' },
  "inverted": { class: 'content', owner: 'timeline' },
  "mode": { class: 'content', owner: 'timeline' },
  "expanded": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "rotation": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "outlineColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipMask>;

export const ClipNodeGraphFields = {
  "version": { class: 'content', owner: 'timeline' },
  "canvasPlacements": { class: 'content', owner: 'timeline' },
  "previews": { class: 'content', owner: 'timeline' },
  "stabilization": { class: 'content', owner: 'timeline' },
  "keyframeNodes": { class: 'content', owner: 'timeline' },
  "parameterSources": { class: 'content', owner: 'timeline' },
  "scene": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "customNodes": { class: 'content', owner: 'timeline' },
  "forcedBuiltIns": { class: 'content', owner: 'timeline' },
  "manualEdges": { class: 'content', owner: 'timeline' },
  "updatedAt": { class: 'content', owner: 'timeline' },
  "groups": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipNodeGraph>;

export const ClipNodeGraphNodeStateFields = {
  "id": { class: 'content', owner: 'timeline' },
  "backing": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipNodeGraphNodeState>;

export const ClipStabilizationGraphFields = {
  "bake": { class: 'content', owner: 'timeline' },
  "layouts": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipStabilizationGraph>;

export const ClipTransformFields = {
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "anchor": { class: 'content', owner: 'timeline' },
  "scale": { class: 'content', owner: 'timeline' },
  "rotation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ClipTransform>;

export const ColorCorrectionStateFields = {
  "version": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "stackIndex": { class: 'content', owner: 'timeline' },
  "activeVersionId": { class: 'content', owner: 'timeline' },
  "versions": { class: 'content', owner: 'timeline' },
  "ui": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorCorrectionState>;

export const ColorCorrectionUiStateFields = {
  "viewMode": { class: 'content', owner: 'timeline' },
  "selectedNodeId": { class: 'content', owner: 'timeline' },
  "nodeDisplayMode": { class: 'content', owner: 'timeline' },
  "nodeLayoutVersion": { class: 'content', owner: 'timeline' },
  "workspaceViewport": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorCorrectionUiState>;

export const ColorEdgeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "fromNodeId": { class: 'content', owner: 'timeline' },
  "fromPort": { class: 'content', owner: 'timeline' },
  "toNodeId": { class: 'content', owner: 'timeline' },
  "toPort": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorEdge>;

export const ColorFillAppearanceFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorFillAppearance>;

export const ColorGradeVersionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "edges": { class: 'content', owner: 'timeline' },
  "outputNodeId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorGradeVersion>;

export const ColorNodeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "preview": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ColorNode>;

export const CommonsSourceAssetFields = {
  "id": { class: 'content', owner: 'seedance' },
  "requirementId": { class: 'content', owner: 'seedance' },
  "sceneIds": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "description": { class: 'content', owner: 'seedance' },
  "creator": { class: 'content', owner: 'seedance' },
  "credit": { class: 'content', owner: 'seedance' },
  "license": { class: 'content', owner: 'seedance' },
  "licenseUrl": { class: 'content', owner: 'seedance' },
  "sourceUrl": { class: 'content', owner: 'seedance' },
  "originalUrl": { class: 'content', owner: 'seedance' },
  "thumbnailUrl": { class: 'content', owner: 'seedance' },
  "mimeType": { class: 'content', owner: 'seedance' },
  "width": { class: 'content', owner: 'seedance' },
  "height": { class: 'content', owner: 'seedance' },
  "pageId": { class: 'content', owner: 'seedance' },
  "revisionId": { class: 'content', owner: 'seedance' },
  "retrievedAt": { class: 'content', owner: 'seedance' },
  "importToken": { class: 'content', owner: 'seedance' },
  "selected": { class: 'content', owner: 'seedance' },
  "mediaFileId": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<CommonsSourceAsset>;

export const CompositionMulticamFields = {
  "version": { class: 'content', owner: 'timeline' },
  "active": { class: 'content', owner: 'timeline' },
  "groupId": { class: 'content', owner: 'timeline' },
  "angles": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CompositionMulticam>;

export const CurvesPanelDataFields = {
  "curvePreferredTarget": { class: 'content', owner: 'timeline' },
  "curveTimeView": { class: 'content', owner: 'timeline' },
  "curveViewedClipId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<CurvesPanelData>;

export const DenseTerrainMeshFields = {
  "positions": { class: 'content', owner: 'tracking' },
  "indices": { class: 'content', owner: 'tracking' },
  "origin": { class: 'content', owner: 'tracking' },
  "axisX": { class: 'content', owner: 'tracking' },
  "axisY": { class: 'content', owner: 'tracking' },
  "normal": { class: 'content', owner: 'tracking' },
  "size": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<DenseTerrainMesh>;

export const DepthMapMetadataFields = {
  "version": { class: 'content', owner: 'timeline' },
  "sourceMediaId": { class: 'content', owner: 'timeline' },
  "sourceFingerprint": { class: 'content', owner: 'timeline' },
  "sourceStart": { class: 'content', owner: 'timeline' },
  "sourceEnd": { class: 'content', owner: 'timeline' },
  "fps": { class: 'content', owner: 'timeline' },
  "nearIsWhite": { class: 'content', owner: 'timeline' },
  "model": { class: 'content', owner: 'timeline' },
  "modelRevision": { class: 'content', owner: 'timeline' },
  "edge": { class: 'content', owner: 'timeline' },
  "rangeSmoothing": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<DepthMapMetadata>;

export const DockLayoutFields = {
  "root": { class: 'content', owner: 'timeline' },
  "floatingPanels": { class: 'content', owner: 'timeline' },
  "panelZoom": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<DockLayout>;

export const DockPanelFields = {
  "id": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "title": { class: 'content', owner: 'timeline' },
  "data": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<DockPanel>;

export const DockSplitFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "direction": { class: 'content', owner: 'timeline' },
  "children": { class: 'content', owner: 'timeline' },
  "ratio": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<DockSplit>;

export const DockTabGroupFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "panels": { class: 'content', owner: 'timeline' },
  "activeIndex": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<DockTabGroup>;

export const DocumentAnchorFields = {
  "blockId": { class: 'content', owner: 'documents' },
  "start": { class: 'content', owner: 'documents' },
  "endBlockId": { class: 'content', owner: 'documents' },
  "end": { class: 'content', owner: 'documents' },
  "quote": { class: 'content', owner: 'documents' },
  "status": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentAnchor>;

export const DocumentBlockFields = {
  "id": { class: 'content', owner: 'documents' },
  "kind": { class: 'content', owner: 'documents' },
  "text": { class: 'content', owner: 'documents' },
  "sceneNumber": { class: 'content', owner: 'documents' },
  "omitted": { class: 'content', owner: 'documents' },
  "revisionId": { class: 'content', owner: 'documents' },
  "sourcePage": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentBlock>;

export const DocumentCommentFields = {
  "id": { class: 'content', owner: 'documents' },
  "anchor": { class: 'content', owner: 'documents' },
  "text": { class: 'content', owner: 'documents' },
  "createdAt": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentComment>;

export const DocumentLinkFields = {
  "id": { class: 'content', owner: 'documents' },
  "anchor": { class: 'content', owner: 'documents' },
  "target": { class: 'content', owner: 'documents' },
  "label": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentLink>;

export const DocumentSourceFields = {
  "fileName": { class: 'content', owner: 'documents' },
  "mimeType": { class: 'content', owner: 'documents' },
  "format": { class: 'content', owner: 'documents' },
  "importedAt": { class: 'content', owner: 'documents' },
  "byteLength": { class: 'content', owner: 'documents' },
  "originalText": { class: 'content', owner: 'documents' },
  "originalData": { class: 'content', owner: 'documents' },
  "previewHtml": { class: 'content', owner: 'documents' },
  "fidelity": { class: 'content', owner: 'documents' },
  "report": { class: 'content', owner: 'documents' },
  "pageCount": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<DocumentSource>;
