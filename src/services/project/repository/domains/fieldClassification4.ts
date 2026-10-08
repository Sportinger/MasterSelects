import type { FieldOwnershipMap } from './fieldOwnership';
import type { ProjectMediaFile } from '../../types/media.types';
import type { ProjectMediaSourceRoot } from '../../types/project.types';
import type { ProjectMeshItem } from '../../types/schema.types';
import type { ProjectMIDIState } from '../../types/project.types';
import type { ProjectModelMaterialSettings } from '../../types/schema.types';
import type { ProjectModelSequenceData } from '../../types/schema.types';
import type { ProjectModelSequenceFrame } from '../../types/schema.types';
import type { ProjectMotionShapeItem } from '../../types/schema.types';
import type { ProjectRulerLane } from '../../types/timeline.types';
import type { ProjectSceneCameraSettings } from '../../types/schema.types';
import type { ProjectSceneSegment } from '../../types/clip-payload.types';
import type { ProjectSettings } from '../../types/project.types';
import type { ProjectSignalAssetItemState } from '../../types/project.types';
import type { ProjectSignalState } from '../../types/project.types';
import type { ProjectSolidItem } from '../../types/schema.types';
import type { ProjectSplatEffectorItem } from '../../types/schema.types';
import type { ProjectSplatEffectorSettings } from '../../types/schema.types';
import type { ProjectTempoEvent } from '../../types/timeline.types';
import type { ProjectTempoMap } from '../../types/timeline.types';
import type { ProjectText3DProperties } from '../../types/clip-payload.types';
import type { ProjectTextBoundsPath } from '../../types/clip-payload.types';
import type { ProjectTextBoundsVertex } from '../../types/clip-payload.types';
import type { ProjectTextClipProperties } from '../../types/clip-payload.types';
import type { ProjectTextItem } from '../../types/schema.types';
import type { ProjectTrack } from '../../types/composition.types';
import type { ProjectTranscriptWord } from '../../types/clip-payload.types';
import type { ProjectTransform } from '../../types/timeline.types';
import type { ProjectUIState } from '../../types/project.types';
import type { ProjectVideoBakeRegion } from '../../types/clip-payload.types';
import type { RadialGradientAppearance } from '../../../../types/motionDesign';
import type { RandomMotionModifier } from '../../../motionDesign/modifiers/contracts';
import type { RemoteColorGradeState } from '../../../../types/colorGradeOwnership';
import type { RenderSourceActiveComp } from '../../../../types/renderTarget';
import type { RenderSourceComposition } from '../../../../types/renderTarget';
import type { RenderSourceLayerIndex } from '../../../../types/renderTarget';
import type { ReplicatorDefinition } from '../../../../types/motionDesign';
import type { ReplicatorTerminalTransform } from '../../../../types/motionDesign';
import type { ReplicatorVector2 } from '../../../motionDesign/replicator/contracts';
import type { SceneCutAnalysis } from '../../../../types/sceneCutAnalysis';
import type { SceneCutPoint } from '../../../../types/sceneCutAnalysis';
import type { SceneGraphOutput } from '../../../../types/sharedSceneGraph';
import type { SceneOperatorGraph } from '../../../../types/operatorGraph';
import type { ScopesPanelData } from '../../../../types/dock';
import type { ScreenplayLayout } from '../../../../types/documents';
import type { SeedanceAgentRecord } from '../../../seedancePreproduction/orchestrationContracts';
import type { SeedanceAssetNeed } from '../../../seedancePreproduction/contracts';
import type { SeedanceAssetPlan } from '../../../seedancePreproduction/contracts';
import type { SeedanceKeyframeBrief } from '../../../seedancePreproduction/contracts';
import type { SeedanceKeyframeVersion } from '../../../seedancePreproduction/contracts';
import type { SeedanceMasterLook } from '../../../seedancePreproduction/contracts';

export const ProjectMediaFileFields = {
  "depthMap": { class: 'content', owner: 'media' },
  "id": { class: 'content', owner: 'media' },
  "name": { class: 'content', owner: 'media' },
  "type": { class: 'content', owner: 'media' },
  "sourcePath": { class: 'resolver', owner: 'media' },
  "projectPath": { class: 'resolver', owner: 'media' },
  "sourceRootId": { class: 'resolver', owner: 'media' },
  "sourceRelativePath": { class: 'resolver', owner: 'media' },
  "linkedSources": { class: 'content', owner: 'media' },
  "sourceSelection": { class: 'content', owner: 'media' },
  "externalOrigin": { class: 'content', owner: 'media' },
  "fileHash": { class: 'content', owner: 'media' },
  "duration": { class: 'content', owner: 'media' },
  "width": { class: 'content', owner: 'media' },
  "height": { class: 'content', owner: 'media' },
  "frameRate": { class: 'content', owner: 'media' },
  "codec": { class: 'content', owner: 'media' },
  "audioCodec": { class: 'content', owner: 'media' },
  "container": { class: 'content', owner: 'media' },
  "bitrate": { class: 'content', owner: 'media' },
  "fileSize": { class: 'content', owner: 'media' },
  "hasAudio": { class: 'content', owner: 'media' },
  "audioAnalysisRefs": { class: 'content', owner: 'media' },
  "stemInfo": { class: 'content', owner: 'media' },
  "waveform": { class: 'cache', owner: 'media' },
  "waveformChannels": { class: 'cache', owner: 'media' },
  "splatCount": { class: 'content', owner: 'media' },
  "totalSplatCount": { class: 'content', owner: 'media' },
  "splatFrameCount": { class: 'content', owner: 'media' },
  "hasProxy": { class: 'cache', owner: 'media' },
  "proxyFormat": { class: 'cache', owner: 'media' },
  "sceneCutAnalysis": { class: 'content', owner: 'media' },
  "hasAudioProxy": { class: 'cache', owner: 'media' },
  "audioProxyStorageKey": { class: 'cache', owner: 'media' },
  "vectorAnimation": { class: 'content', owner: 'media' },
  "modelSequence": { class: 'content', owner: 'media' },
  "gaussianSplatSequence": { class: 'content', owner: 'media' },
  "folderId": { class: 'content', owner: 'media' },
  "labelColor": { class: 'content', owner: 'media' },
  "remoteColorGrade": { class: 'content', owner: 'media' },
  "importedAt": { class: 'content', owner: 'media' },
  "liveInput": { class: 'content', owner: 'media' },
  "sourceAnnotations": { class: 'content', owner: 'media' },
  "videoCodecId": { class: 'content', owner: 'media' },
  "codedWidth": { class: 'content', owner: 'media' },
  "codedHeight": { class: 'content', owner: 'media' },
  "rotation": { class: 'content', owner: 'media' },
  "pixelAspectRatio": { class: 'content', owner: 'media' },
  "videoColorSpace": { class: 'content', owner: 'media' },
  "hasHighDynamicRange": { class: 'content', owner: 'media' },
  "canBeTransparent": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<ProjectMediaFile>;

export const ProjectMediaSourceRootFields = {
  "id": { class: 'content', owner: 'media' },
  "name": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<ProjectMediaSourceRoot>;

export const ProjectMeshItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "meshType": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMeshItem>;

export const ProjectMIDIStateFields = {
  "isEnabled": { class: 'workspace', owner: 'midi' },
  "transportBindings": { class: 'content', owner: 'midi' },
  "slotBindings": { class: 'content', owner: 'midi' },
  "parameterBindings": { class: 'content', owner: 'midi' },
} as const satisfies FieldOwnershipMap<ProjectMIDIState>;

export const ProjectModelMaterialSettingsFields = {
  "overrideBaseColor": { class: 'content', owner: 'timeline' },
  "baseColor": { class: 'content', owner: 'timeline' },
  "useEmbeddedTexture": { class: 'content', owner: 'timeline' },
  "shading": { class: 'content', owner: 'timeline' },
  "uvScaleX": { class: 'content', owner: 'timeline' },
  "uvScaleY": { class: 'content', owner: 'timeline' },
  "uvOffsetX": { class: 'content', owner: 'timeline' },
  "uvOffsetY": { class: 'content', owner: 'timeline' },
  "roughness": { class: 'content', owner: 'timeline' },
  "metallic": { class: 'content', owner: 'timeline' },
  "emissionColor": { class: 'content', owner: 'timeline' },
  "emissionStrength": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectModelMaterialSettings>;

export const ProjectModelSequenceDataFields = {
  "fps": { class: 'content', owner: 'timeline' },
  "frameCount": { class: 'content', owner: 'timeline' },
  "playbackMode": { class: 'content', owner: 'timeline' },
  "sequenceName": { class: 'content', owner: 'timeline' },
  "frames": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectModelSequenceData>;

export const ProjectModelSequenceFrameFields = {
  "name": { class: 'content', owner: 'timeline' },
  "projectPath": { class: 'resolver', owner: 'timeline' },
  "sourcePath": { class: 'resolver', owner: 'timeline' },
  "absolutePath": { class: 'resolver', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectModelSequenceFrame>;

export const ProjectMotionShapeItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "primitive": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMotionShapeItem>;

export const ProjectRulerLaneFields = {
  "id": { class: 'content', owner: 'timeline' },
  "format": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectRulerLane>;

export const ProjectSceneCameraSettingsFields = {
  "shakeAmount": { class: 'content', owner: 'timeline' },
  "shakeFrequency": { class: 'content', owner: 'timeline' },
  "shakeSeed": { class: 'content', owner: 'timeline' },
  "fov": { class: 'content', owner: 'timeline' },
  "near": { class: 'content', owner: 'timeline' },
  "far": { class: 'content', owner: 'timeline' },
  "resolutionWidth": { class: 'content', owner: 'timeline' },
  "resolutionHeight": { class: 'content', owner: 'timeline' },
  "exposure": { class: 'content', owner: 'timeline' },
  "toneMapping": { class: 'content', owner: 'timeline' },
  "fStop": { class: 'content', owner: 'timeline' },
  "focusDistance": { class: 'content', owner: 'timeline' },
  "physicalCameraEnabled": { class: 'content', owner: 'timeline' },
  "shutterAngle": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectSceneCameraSettings>;

export const ProjectSceneSegmentFields = {
  "id": { class: 'content', owner: 'timeline' },
  "text": { class: 'content', owner: 'timeline' },
  "start": { class: 'content', owner: 'timeline' },
  "end": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectSceneSegment>;

export const ProjectSettingsFields = {
  "width": { class: 'content', owner: 'project' },
  "height": { class: 'content', owner: 'project' },
  "frameRate": { class: 'content', owner: 'project' },
  "sampleRate": { class: 'content', owner: 'project' },
} as const satisfies FieldOwnershipMap<ProjectSettings>;

export const ProjectSignalAssetItemStateFields = {
  "id": { class: 'content', owner: 'signals' },
  "parentId": { class: 'content', owner: 'signals' },
  "createdAt": { class: 'content', owner: 'signals' },
  "labelColor": { class: 'content', owner: 'signals' },
} as const satisfies FieldOwnershipMap<ProjectSignalAssetItemState>;

export const ProjectSignalStateFields = {
  "schemaVersion": { class: 'content', owner: 'signals' },
  "assets": { class: 'content', owner: 'signals' },
  "artifacts": { class: 'content', owner: 'signals' },
  "graphs": { class: 'content', owner: 'signals' },
  "operators": { class: 'content', owner: 'signals' },
  "assetItems": { class: 'content', owner: 'signals' },
  "updatedAt": { class: 'derived', owner: 'signals' },
} as const satisfies FieldOwnershipMap<ProjectSignalState>;

export const ProjectSolidItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "width": { class: 'content', owner: 'timeline' },
  "height": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectSolidItem>;

export const ProjectSplatEffectorItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "splatEffectorSettings": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectSplatEffectorItem>;

export const ProjectSplatEffectorSettingsFields = {
  "mode": { class: 'content', owner: 'timeline' },
  "strength": { class: 'content', owner: 'timeline' },
  "falloff": { class: 'content', owner: 'timeline' },
  "speed": { class: 'content', owner: 'timeline' },
  "seed": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectSplatEffectorSettings>;

export const ProjectTempoEventFields = {
  "id": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "bpm": { class: 'content', owner: 'timeline' },
  "numerator": { class: 'content', owner: 'timeline' },
  "denominator": { class: 'content', owner: 'timeline' },
  "curve": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTempoEvent>;

export const ProjectTempoMapFields = {
  "events": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTempoMap>;

export const ProjectText3DPropertiesFields = {
  "text": { class: 'content', owner: 'timeline' },
  "fontFamily": { class: 'content', owner: 'timeline' },
  "fontWeight": { class: 'content', owner: 'timeline' },
  "size": { class: 'content', owner: 'timeline' },
  "depth": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "letterSpacing": { class: 'content', owner: 'timeline' },
  "lineHeight": { class: 'content', owner: 'timeline' },
  "textAlign": { class: 'content', owner: 'timeline' },
  "curveSegments": { class: 'content', owner: 'timeline' },
  "bevelEnabled": { class: 'content', owner: 'timeline' },
  "bevelThickness": { class: 'content', owner: 'timeline' },
  "bevelSize": { class: 'content', owner: 'timeline' },
  "bevelSegments": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectText3DProperties>;

export const ProjectTextBoundsPathFields = {
  "id": { class: 'content', owner: 'timeline' },
  "vertices": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "outlineColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTextBoundsPath>;

export const ProjectTextBoundsVertexFields = {
  "id": { class: 'content', owner: 'timeline' },
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
  "handleMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTextBoundsVertex>;

export const ProjectTextClipPropertiesFields = {
  "text": { class: 'content', owner: 'timeline' },
  "fontFamily": { class: 'content', owner: 'timeline' },
  "fontSize": { class: 'content', owner: 'timeline' },
  "fontWeight": { class: 'content', owner: 'timeline' },
  "fontStyle": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "textAlign": { class: 'content', owner: 'timeline' },
  "verticalAlign": { class: 'content', owner: 'timeline' },
  "lineHeight": { class: 'content', owner: 'timeline' },
  "letterSpacing": { class: 'content', owner: 'timeline' },
  "boxEnabled": { class: 'content', owner: 'timeline' },
  "boxX": { class: 'content', owner: 'timeline' },
  "boxY": { class: 'content', owner: 'timeline' },
  "boxWidth": { class: 'content', owner: 'timeline' },
  "boxHeight": { class: 'content', owner: 'timeline' },
  "wrapMode": { class: 'content', owner: 'timeline' },
  "textBounds": { class: 'content', owner: 'timeline' },
  "strokeEnabled": { class: 'content', owner: 'timeline' },
  "strokeColor": { class: 'content', owner: 'timeline' },
  "strokeWidth": { class: 'content', owner: 'timeline' },
  "shadowEnabled": { class: 'content', owner: 'timeline' },
  "shadowColor": { class: 'content', owner: 'timeline' },
  "shadowOffsetX": { class: 'content', owner: 'timeline' },
  "shadowOffsetY": { class: 'content', owner: 'timeline' },
  "shadowBlur": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
  "valueLink": { class: 'content', owner: 'timeline' },
  "reveal": { class: 'content', owner: 'timeline' },
  "revealMode": { class: 'content', owner: 'timeline' },
  "revealSpread": { class: 'content', owner: 'timeline' },
  "revealCursor": { class: 'content', owner: 'timeline' },
  "pathEnabled": { class: 'content', owner: 'timeline' },
  "pathPoints": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTextClipProperties>;

export const ProjectTextItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "text": { class: 'content', owner: 'timeline' },
  "fontFamily": { class: 'content', owner: 'timeline' },
  "fontSize": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTextItem>;

export const ProjectTrackFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "type": { class: 'content', owner: 'timeline' },
  "height": { class: 'workspace', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
  "locked": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "muted": { class: 'content', owner: 'timeline' },
  "solo": { class: 'content', owner: 'timeline' },
  "audioState": { class: 'content', owner: 'timeline' },
  "midiInstrument": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTrack>;

export const ProjectTranscriptWordFields = {
  "id": { class: 'content', owner: 'timeline' },
  "text": { class: 'content', owner: 'timeline' },
  "start": { class: 'content', owner: 'timeline' },
  "end": { class: 'content', owner: 'timeline' },
  "confidence": { class: 'content', owner: 'timeline' },
  "speaker": { class: 'content', owner: 'timeline' },
  "speakerConfidence": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTranscriptWord>;

export const ProjectTransformFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "z": { class: 'content', owner: 'timeline' },
  "scaleAll": { class: 'content', owner: 'timeline' },
  "scaleX": { class: 'content', owner: 'timeline' },
  "scaleY": { class: 'content', owner: 'timeline' },
  "scaleZ": { class: 'content', owner: 'timeline' },
  "rotation": { class: 'content', owner: 'timeline' },
  "rotationX": { class: 'content', owner: 'timeline' },
  "rotationY": { class: 'content', owner: 'timeline' },
  "anchorX": { class: 'content', owner: 'timeline' },
  "anchorY": { class: 'content', owner: 'timeline' },
  "anchorZ": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectTransform>;

export const ProjectUIStateFields = {
  "dockLayout": { class: 'workspace', owner: 'timeline' },
  "compositionViewState": { class: 'workspace', owner: 'timeline' },
  "mediaPanelColumns": { class: 'workspace', owner: 'timeline' },
  "mediaPanelNameWidth": { class: 'workspace', owner: 'timeline' },
  "mediaPanelViewMode": { class: 'workspace', owner: 'timeline' },
  "mediaPanelBoardViewport": { class: 'workspace', owner: 'timeline' },
  "mediaPanelBoardOrder": { class: 'workspace', owner: 'timeline' },
  "mediaPanelBoardGroupOffsets": { class: 'workspace', owner: 'timeline' },
  "mediaPanelBoardLayouts": { class: 'workspace', owner: 'timeline' },
  "transcriptLanguage": { class: 'workspace', owner: 'timeline' },
  "thumbnailsEnabled": { class: 'workspace', owner: 'timeline' },
  "waveformsEnabled": { class: 'workspace', owner: 'timeline' },
  "audioDisplayMode": { class: 'workspace', owner: 'timeline' },
  "audioFocusMode": { class: 'workspace', owner: 'timeline' },
  "trackFocusMode": { class: 'workspace', owner: 'timeline' },
  "trackHeaderWidth": { class: 'workspace', owner: 'timeline' },
  "timelineSplitRatio": { class: 'workspace', owner: 'timeline' },
  "proxyEnabled": { class: 'workspace', owner: 'timeline' },
  "showTranscriptMarkers": { class: 'workspace', owner: 'timeline' },
  "showChangelogOnStartup": { class: 'workspace', owner: 'timeline' },
  "lastSeenChangelogVersion": { class: 'workspace', owner: 'timeline' },
  "midi": { class: 'mixed', owner: 'timeline' },
  "exportState": { class: 'mixed', owner: 'timeline' },
  "history": { class: 'journal', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectUIState>;

export const ProjectVideoBakeRegionFields = {
  "id": { class: 'content', owner: 'timeline' },
  "scope": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "endTime": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "status": { class: 'content', owner: 'timeline' },
  "progress": { class: 'runtime', owner: 'timeline' },
  "bakedAt": { class: 'content', owner: 'timeline' },
  "error": { class: 'content', owner: 'timeline' },
  "clipId": { class: 'content', owner: 'timeline' },
  "trackId": { class: 'content', owner: 'timeline' },
  "sourceInPoint": { class: 'content', owner: 'timeline' },
  "sourceOutPoint": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectVideoBakeRegion>;

export const RadialGradientAppearanceFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "stops": { class: 'content', owner: 'timeline' },
  "center": { class: 'content', owner: 'timeline' },
  "radius": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "blendMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RadialGradientAppearance>;

export const RandomMotionModifierFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "seed": { class: 'content', owner: 'timeline' },
  "distribution": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "order": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "targets": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RandomMotionModifier>;

export const RemoteColorGradeStateFields = {
  "version": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "activeVersionId": { class: 'content', owner: 'timeline' },
  "versions": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RemoteColorGradeState>;

export const RenderSourceActiveCompFields = {
  "type": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RenderSourceActiveComp>;

export const RenderSourceCompositionFields = {
  "type": { class: 'content', owner: 'timeline' },
  "compositionId": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RenderSourceComposition>;

export const RenderSourceLayerIndexFields = {
  "type": { class: 'content', owner: 'timeline' },
  "compositionId": { class: 'content', owner: 'timeline' },
  "layerIndex": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<RenderSourceLayerIndex>;

export const ReplicatorDefinitionFields = {
  "contract": { class: 'content', owner: 'timeline' },
  "version": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "revision": { class: 'content', owner: 'timeline' },
  "layout": { class: 'content', owner: 'timeline' },
  "terminalTransform": { class: 'content', owner: 'timeline' },
  "userLimit": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ReplicatorDefinition>;

export const ReplicatorTerminalTransformFields = {
  "mode": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "rotationDegrees": { class: 'content', owner: 'timeline' },
  "scale": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ReplicatorTerminalTransform>;

export const ReplicatorVector2Fields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ReplicatorVector2>;

export const SceneCutAnalysisFields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "detectorVersion": { class: 'content', owner: 'timeline' },
  "analysisWidth": { class: 'content', owner: 'timeline' },
  "analysisHeight": { class: 'content', owner: 'timeline' },
  "sourceFrameCount": { class: 'content', owner: 'timeline' },
  "expectedSourceFrameCount": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "sourceFingerprint": { class: 'content', owner: 'timeline' },
  "cuts": { class: 'content', owner: 'timeline' },
  "completedAt": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SceneCutAnalysis>;

export const SceneCutPointFields = {
  "timestamp": { class: 'content', owner: 'timeline' },
  "frameNumber": { class: 'content', owner: 'timeline' },
  "score": { class: 'content', owner: 'timeline' },
  "changedRatio": { class: 'content', owner: 'timeline' },
  "meanPixelDifference": { class: 'content', owner: 'timeline' },
  "histogramDifference": { class: 'content', owner: 'timeline' },
  "edgeChangeRatio": { class: 'content', owner: 'timeline' },
  "motionCompensatedDifference": { class: 'content', owner: 'timeline' },
  "confidence": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SceneCutPoint>;

export const SceneGraphOutputFields = {
  "graphId": { class: 'content', owner: 'timeline' },
  "nodeIds": { class: 'content', owner: 'timeline' },
  "groupId": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SceneGraphOutput>;

export const SceneOperatorGraphFields = {
  "graph": { class: 'content', owner: 'timeline' },
  "params": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<SceneOperatorGraph>;

export const ScopesPanelDataFields = {
  "scopeMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ScopesPanelData>;

export const ScreenplayLayoutFields = {
  "pageSize": { class: 'content', owner: 'documents' },
  "titlePage": { class: 'content', owner: 'documents' },
  "header": { class: 'content', owner: 'documents' },
  "footer": { class: 'content', owner: 'documents' },
  "sceneNumbers": { class: 'content', owner: 'documents' },
  "lockedPages": { class: 'content', owner: 'documents' },
  "pageLocks": { class: 'content', owner: 'documents' },
  "scenesLocked": { class: 'content', owner: 'documents' },
  "revisions": { class: 'content', owner: 'documents' },
  "activeRevisionId": { class: 'content', owner: 'documents' },
} as const satisfies FieldOwnershipMap<ScreenplayLayout>;

export const SeedanceAgentRecordFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "id": { class: 'content', owner: 'seedance' },
  "role": { class: 'content', owner: 'seedance' },
  "status": { class: 'content', owner: 'seedance' },
  "conceptId": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "startedAt": { class: 'content', owner: 'seedance' },
  "completedAt": { class: 'content', owner: 'seedance' },
  "closedAt": { class: 'content', owner: 'seedance' },
  "error": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceAgentRecord>;

export const SeedanceAssetNeedFields = {
  "id": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "description": { class: 'content', owner: 'seedance' },
  "cameraDirection": { class: 'content', owner: 'seedance' },
  "sourceKind": { class: 'content', owner: 'seedance' },
  "priority": { class: 'content', owner: 'seedance' },
  "commonsQueries": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceAssetNeed>;

export const SeedanceAssetPlanFields = {
  "schemaVersion": { class: 'content', owner: 'seedance' },
  "kind": { class: 'content', owner: 'seedance' },
  "assetNeeds": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceAssetPlan>;

export const SeedanceKeyframeBriefFields = {
  "id": { class: 'content', owner: 'seedance' },
  "sceneId": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "prompt": { class: 'content', owner: 'seedance' },
  "negativePrompt": { class: 'content', owner: 'seedance' },
  "referenceAssetIds": { class: 'content', owner: 'seedance' },
  "previousKeyframeIds": { class: 'content', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceKeyframeBrief>;

export const SeedanceKeyframeVersionFields = {
  "id": { class: 'content', owner: 'seedance' },
  "briefId": { class: 'content', owner: 'seedance' },
  "createdAt": { class: 'content', owner: 'seedance' },
  "generationRecordId": { class: 'content', owner: 'seedance' },
  "mediaFileId": { class: 'content', owner: 'seedance' },
  "status": { class: 'journal', owner: 'seedance' },
  "error": { class: 'journal', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceKeyframeVersion>;

export const SeedanceMasterLookFields = {
  "id": { class: 'content', owner: 'seedance' },
  "title": { class: 'content', owner: 'seedance' },
  "description": { class: 'content', owner: 'seedance' },
  "prompt": { class: 'content', owner: 'seedance' },
  "negativePrompt": { class: 'content', owner: 'seedance' },
  "generationRecordId": { class: 'content', owner: 'seedance' },
  "mediaFileId": { class: 'content', owner: 'seedance' },
  "status": { class: 'journal', owner: 'seedance' },
  "error": { class: 'journal', owner: 'seedance' },
} as const satisfies FieldOwnershipMap<SeedanceMasterLook>;
