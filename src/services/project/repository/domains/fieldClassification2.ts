import type { FieldOwnershipMap } from './fieldOwnership';
import type { NodeGraphLayout } from '../../../../types/nodeGraph';
import type { NodeGraphPort } from '../../../../types/nodeGraph';
import type { NodeGraphPortMetadata } from '../../../../types/nodeGraph';
import type { NodeGroupSize } from '../../../../types/nodeGraph';
import type { NodePortContract } from '../../../../types/nodePortContract';
import type { NodeWorkspacePanelData } from '../../../../types/dock';
import type { NoiseMotionModifier } from '../../../motionDesign/modifiers/contracts';
import type { NotebookFormat } from '../../../../types/documents';
import type { NotebookLabel } from '../../../../types/documents';
import type { NotebookScene } from '../../../../types/documents';
import type { OperatorCompositionInstance } from '../../../../types/operatorGraph';
import type { OperatorEdge } from '../../../../types/operatorGraph';
import type { OperatorEndpoint } from '../../../../types/operatorGraph';
import type { OperatorGroup } from '../../../../types/operatorGraph';
import type { OscillatorMotionModifier } from '../../../motionDesign/modifiers/contracts';
import type { ParameterSourceBinding } from '../../../../types/parameterSources';
import type { ParameterSources } from '../../../../types/parameterSources';
import type { PathShapeDefinition } from '../../../../types/motionDesign';
import type { PlanarTrack } from '../../../../types/planarTracking';
import type { PreviewPanelData } from '../../../../types/dock';
import type { ProjectAudioState } from '../../../../types/audio';
import type { ProjectBatchExportData } from '../../types/export.types';
import type { ProjectBatchExportJob } from '../../types/export.types';
import type { ProjectCameraItem } from '../../types/schema.types';
import type { ProjectClip } from '../../types/composition.types';
import type { ProjectClipAnalysis } from '../../types/clip-payload.types';
import type { ProjectClipVideoState } from '../../types/clip-payload.types';
import type { ProjectComposition } from '../../types/composition.types';
import type { ProjectDocument } from '../../../../types/documents';
import type { ProjectEffect } from '../../types/timeline.types';
import type { ProjectExportPreset } from '../../types/export.types';
import type { ProjectExportSettings } from '../../types/export.types';
import type { ProjectExportStoreData } from '../../types/export.types';
import type { ProjectFaceAnalysisBox } from '../../types/clip-payload.types';
import type { ProjectFaceAnalysisPoint } from '../../types/clip-payload.types';
import type { ProjectFaceAnalysisResult } from '../../types/clip-payload.types';
import type { ProjectFaceFrameDetection } from '../../types/clip-payload.types';
import type { ProjectFacePersonSummary } from '../../types/clip-payload.types';
import type { ProjectFile } from '../../types/project.types';
import type { ProjectFlashBoardAIWorkspace } from '../../types/flashboard.types';
import type { ProjectFlashBoardChatEditOption } from '../../types/flashboard.types';
import type { ProjectFlashBoardChatExecutedToolCall } from '../../types/flashboard.types';
import type { ProjectFlashBoardChatMessage } from '../../types/flashboard.types';
import type { ProjectFlashBoardChatToolCall } from '../../types/flashboard.types';

export const NodeGraphLayoutFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeGraphLayout>;

export const NodeGraphPortFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "direction": { class: 'content', owner: 'timeline' },
  "metadata": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeGraphPort>;

export const NodeGraphPortMetadataFields = {
  "readOnly": { class: 'content', owner: 'timeline' },
  "animationProperty": { class: 'content', owner: 'timeline' },
  "controlProperty": { class: 'content', owner: 'timeline' },
  "sourceArtifact": { class: 'content', owner: 'timeline' },
  "artifactTarget": { class: 'content', owner: 'timeline' },
  "contract": { class: 'content', owner: 'timeline' },
  "groupEndpoint": { class: 'content', owner: 'timeline' },
  "groupEndpoints": { class: 'content', owner: 'timeline' },
  "semanticKind": { class: 'content', owner: 'timeline' },
  "targetClipId": { class: 'content', owner: 'timeline' },
  "signalRefId": { class: 'content', owner: 'timeline' },
  "artifactId": { class: 'content', owner: 'timeline' },
  "artifactProvenance": { class: 'content', owner: 'timeline' },
  "artifactIndex": { class: 'content', owner: 'timeline' },
  "available": { class: 'content', owner: 'timeline' },
  "stale": { class: 'content', owner: 'timeline' },
  "previewable": { class: 'content', owner: 'timeline' },
  "required": { class: 'content', owner: 'timeline' },
  "repeated": { class: 'content', owner: 'timeline' },
  "generateAction": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeGraphPortMetadata>;

export const NodeGroupSizeFields = {
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeGroupSize>;

export const NodePortContractFields = {
  "typeLabel": { class: 'content', owner: 'timeline' },
  "description": { class: 'content', owner: 'timeline' },
  "formats": { class: 'content', owner: 'timeline' },
  "constraints": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodePortContract>;

export const NodeWorkspacePanelDataFields = {
  "nodeClipId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NodeWorkspacePanelData>;

export const NoiseMotionModifierFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "seed": { class: 'content', owner: 'timeline' },
  "indexFrequency": { class: 'content', owner: 'timeline' },
  "timeFrequencyHz": { class: 'content', owner: 'timeline' },
  "octaves": { class: 'content', owner: 'timeline' },
  "lacunarity": { class: 'content', owner: 'timeline' },
  "persistence": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "order": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<NoiseMotionModifier>;

export const NotebookFormatFields = {
  "id": { class: 'content', owner: 'documents' },
  "anchor": { class: 'content', owner: 'documents' },
  "kind": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<NotebookFormat>;

export const NotebookLabelFields = {
  "id": { class: 'content', owner: 'documents' },
  "name": { class: 'content', owner: 'documents' },
  "color": { class: 'content', owner: 'documents' },
  "anchor": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<NotebookLabel>;

export const NotebookSceneFields = {
  "id": { class: 'content', owner: 'documents' },
  "anchor": { class: 'content', owner: 'documents' },
  "name": { class: 'content', owner: 'documents' },
  "location": { class: 'content', owner: 'documents' },
  "interiorExterior": { class: 'content', owner: 'documents' },
  "timeOfDay": { class: 'content', owner: 'documents' },
  "labels": { class: 'content', owner: 'documents' },
  "mediaIds": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<NotebookScene>;

export const OperatorCompositionInstanceFields = {
  "nodeIds": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
  "children": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<OperatorCompositionInstance>;

export const OperatorEdgeFields = {
  "id": { class: 'content', owner: 'timeline' },
  "from": { class: 'content', owner: 'timeline' },
  "output": { class: 'content', owner: 'timeline' },
  "to": { class: 'content', owner: 'timeline' },
  "input": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<OperatorEdge>;

export const OperatorEndpointFields = {
  "nodeId": { class: 'content', owner: 'timeline' },
  "portId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<OperatorEndpoint>;

export const OperatorGroupFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "nodeIds": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "bypassed": { class: 'content', owner: 'timeline' },
  "bypassOutputs": { class: 'content', owner: 'timeline' },
  "collapsedByDefault": { class: 'content', owner: 'timeline' },
  "composition": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<OperatorGroup>;

export const OscillatorMotionModifierFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "waveform": { class: 'cache', owner: 'timeline' },
  "frequencyHz": { class: 'content', owner: 'timeline' },
  "cyclesAcrossInstances": { class: 'content', owner: 'timeline' },
  "phaseDegrees": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "order": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<OscillatorMotionModifier>;

export const ParameterSourceBindingFields = {
  "source": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "localMode": { class: 'content', owner: 'timeline' },
  "exposed": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ParameterSourceBinding>;

export const ParameterSourcesFields = {
  "version": { class: 'content', owner: 'timeline' },
  "graph": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
  "clipTimeOffset": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ParameterSources>;

export const PathShapeDefinitionFields = {
  "vertices": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
  "trim": { class: 'content', owner: 'timeline' },
  "dash": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<PathShapeDefinition>;

export const PlanarTrackFields = {
  "id": { class: 'content', owner: 'tracking' },
  "name": { class: 'content', owner: 'tracking' },
  "sourceId": { class: 'content', owner: 'tracking' },
  "fps": { class: 'content', owner: 'tracking' },
  "referenceTime": { class: 'content', owner: 'tracking' },
  "referenceQuad": { class: 'content', owner: 'tracking' },
  "samples": { class: 'content', owner: 'tracking' },
  "occlusions": { class: 'content', owner: 'tracking' },
  "enabled": { class: 'content', owner: 'tracking' },
  "color": { class: 'content', owner: 'tracking' },
  "opacity": { class: 'content', owner: 'tracking' },
  "fill": { class: 'content', owner: 'tracking' },
  "lineWidth": { class: 'content', owner: 'tracking' },
  "inset": { class: 'content', owner: 'tracking' },
  "shape": { class: 'content', owner: 'tracking' },
  "visibleFrom": { class: 'content', owner: 'tracking' },
  "visibleTo": { class: 'content', owner: 'tracking' },
  "fade": { class: 'content', owner: 'tracking' },
  "projection": { class: 'content', owner: 'tracking' },
  "terrain": { class: 'content', owner: 'tracking' },
  "showMesh": { class: 'content', owner: 'tracking' },
  "placement": { class: 'content', owner: 'tracking' },
  "footstepLookAhead": { class: 'content', owner: 'tracking' },
  "footstepPresentation": { class: 'content', owner: 'tracking' },
  "footstepInterlude": { class: 'content', owner: 'tracking' },
  "object": { class: 'content', owner: 'tracking' },
} as const satisfies FieldOwnershipMap<PlanarTrack>;

export const PreviewPanelDataFields = {
  "source": { class: 'content', owner: 'timeline' },
  "compositionId": { class: 'content', owner: 'timeline' },
  "showTransparencyGrid": { class: 'content', owner: 'timeline' },
  "initialEditMode": { class: 'content', owner: 'timeline' },
  "initialEditCameraView": { class: 'content', owner: 'timeline' },
  "showTransport": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<PreviewPanelData>;

export const ProjectAudioStateFields = {
  "schemaVersion": { class: 'content', owner: 'audio' },
  "analysisArtifactIds": { class: 'derived', owner: 'audio' },
  "analysisArtifacts": { class: 'content', owner: 'audio' },
  "derivedAssets": { class: 'content', owner: 'audio' },
  "masterAudioState": { class: 'derived', owner: 'audio' },
  "updatedAt": { class: 'derived', owner: 'audio' },
} as const satisfies FieldOwnershipMap<ProjectAudioState>;

export const ProjectBatchExportDataFields = {
  "enabled": { class: 'content', owner: 'export' },
  "useSharedSettings": { class: 'content', owner: 'export' },
  "selectedJobId": { class: 'workspace', owner: 'export' },
  "jobs": { class: 'content', owner: 'export' },
} as const satisfies FieldOwnershipMap<ProjectBatchExportData>;

export const ProjectBatchExportJobFields = {
  "id": { class: 'content', owner: 'export' },
  "mediaFileId": { class: 'content', owner: 'export' },
  "sourceName": { class: 'content', owner: 'export' },
  "mediaType": { class: 'content', owner: 'export' },
  "settings": { class: 'content', owner: 'export' },
  "createdAt": { class: 'content', owner: 'export' },
} as const satisfies FieldOwnershipMap<ProjectBatchExportJob>;

export const ProjectCameraItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "cameraSettings": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectCameraItem>;

export const ProjectClipFields = {
  "planarTracks": { class: 'content', owner: 'timeline' },
  "trackingBinding": { class: 'content', owner: 'timeline' },
  "terrainAttachment": { class: 'content', owner: 'timeline' },
  "terrainScreenAnchor": { class: 'content', owner: 'timeline' },
  "terrainAnchorConnector": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "trackId": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "mediaId": { class: 'content', owner: 'timeline' },
  "signalAssetId": { class: 'content', owner: 'timeline' },
  "signalRefId": { class: 'content', owner: 'timeline' },
  "signalRenderAdapterId": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "inPoint": { class: 'content', owner: 'timeline' },
  "outPoint": { class: 'content', owner: 'timeline' },
  "transform": { class: 'content', owner: 'timeline' },
  "sourceRect": { class: 'content', owner: 'timeline' },
  "transitionRender": { class: 'content', owner: 'timeline' },
  "effects": { class: 'content', owner: 'timeline' },
  "transitionIn": { class: 'content', owner: 'timeline' },
  "transitionOut": { class: 'content', owner: 'timeline' },
  "transitionSourceTimeOverride": { class: 'content', owner: 'timeline' },
  "transitionSourceHold": { class: 'content', owner: 'timeline' },
  "transitionSourceMap": { class: 'content', owner: 'timeline' },
  "transitionRecipeBlendWindows": { class: 'content', owner: 'timeline' },
  "colorCorrection": { class: 'content', owner: 'timeline' },
  "colorGradeMode": { class: 'content', owner: 'timeline' },
  "localColorCorrection": { class: 'content', owner: 'timeline' },
  "sceneGraphOutput": { class: 'content', owner: 'timeline' },
  "nodeGraph": { class: 'content', owner: 'timeline' },
  "masks": { class: 'content', owner: 'timeline' },
  "keyframes": { class: 'content', owner: 'timeline' },
  "volume": { class: 'content', owner: 'timeline' },
  "audioEnabled": { class: 'content', owner: 'timeline' },
  "videoState": { class: 'content', owner: 'timeline' },
  "audioState": { class: 'content', owner: 'timeline' },
  "reversed": { class: 'content', owner: 'timeline' },
  "disabled": { class: 'content', owner: 'timeline' },
  "speed": { class: 'content', owner: 'timeline' },
  "videoInspectorSections": { class: 'workspace', owner: 'timeline' },
  "preservesPitch": { class: 'content', owner: 'timeline' },
  "followsLinkedVideoSpeed": { class: 'content', owner: 'timeline' },
  "freeRun": { class: 'content', owner: 'timeline' },
  "isComposition": { class: 'content', owner: 'timeline' },
  "compositionId": { class: 'content', owner: 'timeline' },
  "parentClipId": { class: 'content', owner: 'timeline' },
  "sourceType": { class: 'content', owner: 'timeline' },
  "midiData": { class: 'content', owner: 'timeline' },
  "automation": { class: 'content', owner: 'timeline' },
  "scoreData": { class: 'content', owner: 'timeline' },
  "naturalDuration": { class: 'content', owner: 'timeline' },
  "liveInputId": { class: 'content', owner: 'timeline' },
  "linkedClipId": { class: 'content', owner: 'timeline' },
  "linkedGroupId": { class: 'content', owner: 'timeline' },
  "editableHook": { class: 'content', owner: 'timeline' },
  "thumbnails": { class: 'cache', owner: 'timeline' },
  "waveform": { class: 'cache', owner: 'timeline' },
  "waveformChannels": { class: 'cache', owner: 'timeline' },
  "meshType": { class: 'content', owner: 'timeline' },
  "modelPrimitiveIndex": { class: 'content', owner: 'timeline' },
  "modelMaterialSettings": { class: 'content', owner: 'timeline' },
  "cameraSettings": { class: 'content', owner: 'timeline' },
  "lightSettings": { class: 'content', owner: 'timeline' },
  "splatEffectorSettings": { class: 'content', owner: 'timeline' },
  "gaussianBlendshapes": { class: 'content', owner: 'timeline' },
  "gaussianSplatSettings": { class: 'content', owner: 'timeline' },
  "is3D": { class: 'content', owner: 'timeline' },
  "modelSequence": { class: 'content', owner: 'timeline' },
  "gaussianSplatSequence": { class: 'content', owner: 'timeline' },
  "threeDEffectorsEnabled": { class: 'content', owner: 'timeline' },
  "textProperties": { class: 'content', owner: 'timeline' },
  "captionProperties": { class: 'content', owner: 'timeline' },
  "captionLayerBinding": { class: 'content', owner: 'timeline' },
  "text3DProperties": { class: 'content', owner: 'timeline' },
  "solidColor": { class: 'content', owner: 'timeline' },
  "storyboardProperties": { class: 'content', owner: 'timeline' },
  "transitionOverlay": { class: 'content', owner: 'timeline' },
  "mathScene": { class: 'content', owner: 'timeline' },
  "flock": { class: 'content', owner: 'timeline' },
  "motion": { class: 'content', owner: 'timeline' },
  "vectorAnimationSettings": { class: 'content', owner: 'timeline' },
  "transcript": { class: 'content', owner: 'timeline' },
  "transcriptStatus": { class: 'cache', owner: 'timeline' },
  "analysis": { class: 'content', owner: 'timeline' },
  "analysisStatus": { class: 'cache', owner: 'timeline' },
  "faceAnalysisStatus": { class: 'cache', owner: 'timeline' },
  "faceAnalysisMessage": { class: 'cache', owner: 'timeline' },
  "sceneDescriptions": { class: 'content', owner: 'timeline' },
  "sceneDescriptionStatus": { class: 'cache', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectClip>;

export const ProjectClipAnalysisFields = {
  "frames": { class: 'content', owner: 'timeline' },
  "sampleInterval": { class: 'content', owner: 'timeline' },
  "faceAnalysis": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectClipAnalysis>;

export const ProjectClipVideoStateFields = {
  "bakeRegions": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectClipVideoState>;

export const ProjectCompositionFields = {
  "sharedSceneGraphs": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
  "frameRate": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "durationLocked": { class: 'content', owner: 'timeline' },
  "backgroundColor": { class: 'content', owner: 'timeline' },
  "folderId": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
  "transitionComp": { class: 'content', owner: 'timeline' },
  "captionComp": { class: 'content', owner: 'timeline' },
  "annotations": { class: 'content', owner: 'timeline' },
  "multicam": { class: 'content', owner: 'timeline' },
  "tracks": { class: 'content', owner: 'timeline' },
  "clips": { class: 'content', owner: 'timeline' },
  "videoBakeRegions": { class: 'content', owner: 'timeline' },
  "masterAudioState": { class: 'content', owner: 'timeline' },
  "markers": { class: 'content', owner: 'timeline' },
  "tempoMap": { class: 'content', owner: 'timeline' },
  "rulerLanes": { class: 'content', owner: 'timeline' },
  "activeRulerLaneId": { class: 'workspace', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectComposition>;

export const ProjectDocumentFields = {
  "id": { class: 'content', owner: 'documents' },
  "title": { class: 'content', owner: 'documents' },
  "kind": { class: 'content', owner: 'documents' },
  "schemaVersion": { class: 'content', owner: 'documents' },
  "revision": { class: 'content', owner: 'documents' },
  "createdAt": { class: 'content', owner: 'documents' },
  "updatedAt": { class: 'content', owner: 'documents' },
  "blocks": { class: 'content', owner: 'documents' },
  "links": { class: 'content', owner: 'documents' },
  "comments": { class: 'content', owner: 'documents' },
  "labels": { class: 'content', owner: 'documents' },
  "scenes": { class: 'content', owner: 'documents' },
  "formats": { class: 'content', owner: 'documents' },
  "source": { class: 'content', owner: 'documents' },
  "screenplay": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<ProjectDocument>;

export const ProjectEffectFields = {
  "id": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
  "operatorGraph": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectEffect>;

export const ProjectExportPresetFields = {
  "id": { class: 'content', owner: 'export' },
  "name": { class: 'content', owner: 'export' },
  "createdAt": { class: 'content', owner: 'export' },
  "updatedAt": { class: 'content', owner: 'export' },
  "settings": { class: 'content', owner: 'export' },
} as const satisfies FieldOwnershipMap<ProjectExportPreset>;

export const ProjectExportSettingsFields = {
  "encoder": { class: 'content', owner: 'export' },
  "width": { class: 'content', owner: 'export' },
  "height": { class: 'content', owner: 'export' },
  "customWidth": { class: 'content', owner: 'export' },
  "customHeight": { class: 'content', owner: 'export' },
  "useCustomResolution": { class: 'content', owner: 'export' },
  "fps": { class: 'content', owner: 'export' },
  "customFps": { class: 'content', owner: 'export' },
  "useCustomFps": { class: 'content', owner: 'export' },
  "useInOut": { class: 'content', owner: 'export' },
  "filename": { class: 'content', owner: 'export' },
  "bitrate": { class: 'content', owner: 'export' },
  "containerFormat": { class: 'content', owner: 'export' },
  "videoCodec": { class: 'content', owner: 'export' },
  "rateControl": { class: 'content', owner: 'export' },
  "ffmpegCodec": { class: 'content', owner: 'export' },
  "ffmpegContainer": { class: 'content', owner: 'export' },
  "ffmpegPreset": { class: 'content', owner: 'export' },
  "proresProfile": { class: 'content', owner: 'export' },
  "dnxhrProfile": { class: 'content', owner: 'export' },
  "hapFormat": { class: 'content', owner: 'export' },
  "ffmpegQuality": { class: 'content', owner: 'export' },
  "ffmpegBitrate": { class: 'content', owner: 'export' },
  "ffmpegRateControl": { class: 'content', owner: 'export' },
  "gifColors": { class: 'content', owner: 'export' },
  "gifDither": { class: 'content', owner: 'export' },
  "gifLoop": { class: 'content', owner: 'export' },
  "gifLoopCount": { class: 'content', owner: 'export' },
  "gifPaletteMode": { class: 'content', owner: 'export' },
  "gifOptimize": { class: 'content', owner: 'export' },
  "gifTransparency": { class: 'content', owner: 'export' },
  "gifAlphaThreshold": { class: 'content', owner: 'export' },
  "gifBayerScale": { class: 'content', owner: 'export' },
  "includeAlpha": { class: 'content', owner: 'export' },
  "stackedAlpha": { class: 'content', owner: 'export' },
  "includeAudio": { class: 'content', owner: 'export' },
  "audioOnlyFormat": { class: 'content', owner: 'export' },
  "audioSampleRate": { class: 'content', owner: 'export' },
  "audioBitrate": { class: 'content', owner: 'export' },
  "normalizeAudio": { class: 'content', owner: 'export' },
  "videoEnabled": { class: 'content', owner: 'export' },
  "visualMode": { class: 'content', owner: 'export' },
  "imageFormat": { class: 'content', owner: 'export' },
  "imageExportMode": { class: 'content', owner: 'export' },
  "imageQuality": { class: 'content', owner: 'export' },
  "specialContainer": { class: 'content', owner: 'export' },
} as const satisfies FieldOwnershipMap<ProjectExportSettings>;

export const ProjectExportStoreDataFields = {
  "settings": { class: 'content', owner: 'export' },
  "presets": { class: 'content', owner: 'export' },
  "selectedPresetId": { class: 'workspace', owner: 'export' },
  "batch": { class: 'content', owner: 'export' },
} as const satisfies FieldOwnershipMap<ProjectExportStoreData>;

export const ProjectFaceAnalysisBoxFields = {
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFaceAnalysisBox>;

export const ProjectFaceAnalysisPointFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFaceAnalysisPoint>;

export const ProjectFaceAnalysisResultFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "modelVersion": { class: 'content', owner: 'timeline' },
  "detector": { class: 'content', owner: 'timeline' },
  "recognizer": { class: 'content', owner: 'timeline' },
  "backend": { class: 'content', owner: 'timeline' },
  "observationCount": { class: 'content', owner: 'timeline' },
  "people": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFaceAnalysisResult>;

export const ProjectFaceFrameDetectionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "personId": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "identityEligible": { class: 'content', owner: 'timeline' },
  "manualSourcePersonId": { class: 'content', owner: 'timeline' },
  "confidence": { class: 'content', owner: 'timeline' },
  "box": { class: 'content', owner: 'timeline' },
  "landmarks": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFaceFrameDetection>;

export const ProjectFacePersonSummaryFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "firstSeen": { class: 'content', owner: 'timeline' },
  "lastSeen": { class: 'content', owner: 'timeline' },
  "sampleCount": { class: 'content', owner: 'timeline' },
  "averageConfidence": { class: 'content', owner: 'timeline' },
  "maxConfidence": { class: 'content', owner: 'timeline' },
  "appearances": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFacePersonSummary>;

export const ProjectFileFields = {
  "version": { class: 'container', owner: 'project' },
  "name": { class: 'content', owner: 'project' },
  "createdAt": { class: 'content', owner: 'project' },
  "updatedAt": { class: 'derived', owner: 'project' },
  "settings": { class: 'content', owner: 'project' },
  "media": { class: 'content', owner: 'media' },
  "signals": { class: 'content', owner: 'signals' },
  "audio": { class: 'content', owner: 'audio' },
  "compositions": { class: 'content', owner: 'timeline' },
  "trackingAssets": { class: 'content', owner: 'tracking' },
  "folders": { class: 'content', owner: 'project' },
  "activeCompositionId": { class: 'workspace', owner: 'workspace' },
  "openCompositionIds": { class: 'workspace', owner: 'workspace' },
  "expandedFolderIds": { class: 'workspace', owner: 'workspace' },
  "slotAssignments": { class: 'content', owner: 'project' },
  "slotClipSettings": { class: 'content', owner: 'project' },
  "mediaSourceFolders": { class: 'content', owner: 'project' },
  "mediaSourceRoots": { class: 'content', owner: 'project' },
  "uiState": { class: 'workspace', owner: 'workspace' },
  "flashboard": { class: 'content', owner: 'flashboard' },
  "storyboard": { class: 'content', owner: 'storyboard' },
  "seedancePreproduction": { class: 'content', owner: 'seedance' },
  "documents": { class: 'content', owner: 'documents' },
  "textItems": { class: 'content', owner: 'generated' },
  "solidItems": { class: 'content', owner: 'generated' },
  "meshItems": { class: 'content', owner: 'generated' },
  "cameraItems": { class: 'content', owner: 'generated' },
  "lightItems": { class: 'content', owner: 'generated' },
  "splatEffectorItems": { class: 'content', owner: 'generated' },
  "mathSceneItems": { class: 'content', owner: 'generated' },
  "motionShapeItems": { class: 'content', owner: 'generated' },
} as const satisfies FieldOwnershipMap<ProjectFile>;

export const ProjectFlashBoardAIWorkspaceFields = {
  "id": { class: 'content', owner: 'flashboard' },
  "title": { class: 'content', owner: 'flashboard' },
  "kind": { class: 'content', owner: 'flashboard' },
  "createdAt": { class: 'content', owner: 'flashboard' },
  "updatedAt": { class: 'content', owner: 'flashboard' },
  "chatConversationRef": { class: 'journal', owner: 'flashboard' },
  "composer": { class: 'workspace', owner: 'flashboard' },
  "chatMessages": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardAIWorkspace>;

export const ProjectFlashBoardChatEditOptionFields = {
  "index": { class: 'journal', owner: 'flashboard' },
  "title": { class: 'journal', owner: 'flashboard' },
  "description": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardChatEditOption>;

export const ProjectFlashBoardChatExecutedToolCallFields = {
  "modelContent": { class: 'journal', owner: 'flashboard' },
  "result": { class: 'journal', owner: 'flashboard' },
  "toolCall": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardChatExecutedToolCall>;

export const ProjectFlashBoardChatMessageFields = {
  "activityEvents": { class: 'journal', owner: 'flashboard' },
  "conversationRef": { class: 'journal', owner: 'flashboard' },
  "createdAt": { class: 'journal', owner: 'flashboard' },
  "id": { class: 'journal', owner: 'flashboard' },
  "role": { class: 'journal', owner: 'flashboard' },
  "text": { class: 'journal', owner: 'flashboard' },
  "decisionId": { class: 'journal', owner: 'flashboard' },
  "editOptions": { class: 'journal', owner: 'flashboard' },
  "inputRequest": { class: 'journal', owner: 'flashboard' },
  "isError": { class: 'journal', owner: 'flashboard' },
  "isPending": { class: 'runtime', owner: 'flashboard' },
  "isStreaming": { class: 'runtime', owner: 'flashboard' },
  "kernelReport": { class: 'journal', owner: 'flashboard' },
  "toolCalls": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardChatMessage>;

export const ProjectFlashBoardChatToolCallFields = {
  "id": { class: 'journal', owner: 'flashboard' },
  "name": { class: 'journal', owner: 'flashboard' },
  "arguments": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardChatToolCall>;
