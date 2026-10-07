import type { FieldOwnershipMap } from './fieldOwnership';
import type { ProjectFlashBoardChatToolResult } from '../../types/flashboard.types';
import type { ProjectFlashBoardComposerModelSettings } from '../../types/flashboard.types';
import type { ProjectFlashBoardComposerState } from '../../types/flashboard.types';
import type { ProjectFlashBoardGenerationMetadata } from '../../types/flashboard.types';
import type { ProjectFlashBoardGenerationOutput } from '../../types/flashboard.types';
import type { ProjectFlashBoardGenerationRecord } from '../../types/flashboard.types';
import type { ProjectFlashBoardGenerationRequest } from '../../types/flashboard.types';
import type { ProjectFlashBoardJobState } from '../../types/flashboard.types';
import type { ProjectFlashBoardMultiShotPrompt } from '../../types/flashboard.types';
import type { ProjectFlashBoardPromptHistoryEntry } from '../../types/flashboard.types';
import type { ProjectFlashBoardResult } from '../../types/flashboard.types';
import type { ProjectFlashBoardState } from '../../types/flashboard.types';
import type { ProjectFlashBoardVoiceSettings } from '../../types/flashboard.types';
import type { ProjectFolder } from '../../types/folder.types';
import type { ProjectFrameAnalysisData } from '../../types/clip-payload.types';
import type { ProjectGaussianSplatBounds } from '../../types/schema.types';
import type { ProjectGaussianSplatParticleSettings } from '../../types/schema.types';
import type { ProjectGaussianSplatRenderSettings } from '../../types/schema.types';
import type { ProjectGaussianSplatSequenceData } from '../../types/schema.types';
import type { ProjectGaussianSplatSequenceFrame } from '../../types/schema.types';
import type { ProjectGaussianSplatSettings } from '../../types/schema.types';
import type { ProjectGaussianSplatTemporalSettings } from '../../types/schema.types';
import type { ProjectHistoryBranchState } from '../../../../types/history';
import type { ProjectHistoryNodeState } from '../../../../types/history';
import type { ProjectHistoryStateV1 } from '../../../../types/history';
import type { ProjectHistoryStateV2 } from '../../../../types/history';
import type { ProjectKeyframe } from '../../types/timeline.types';
import type { ProjectLightItem } from '../../types/schema.types';
import type { ProjectLightSettings } from '../../types/schema.types';
import type { ProjectMarker } from '../../types/timeline.types';
import type { ProjectMask } from '../../types/timeline.types';
import type { ProjectMaskPathKeyframeValue } from '../../types/timeline.types';
import type { ProjectMaskPathVertex } from '../../types/timeline.types';
import type { ProjectMaskVertex } from '../../types/timeline.types';
import type { ProjectMathFunctionObject } from '../../types/clip-payload.types';
import type { ProjectMathLabelObject } from '../../types/clip-payload.types';
import type { ProjectMathObjectAnimation } from '../../types/clip-payload.types';
import type { ProjectMathParameter } from '../../types/clip-payload.types';
import type { ProjectMathParameterAnimation } from '../../types/clip-payload.types';
import type { ProjectMathPointObject } from '../../types/clip-payload.types';
import type { ProjectMathSceneDefinition } from '../../types/clip-payload.types';
import type { ProjectMathSceneItem } from '../../types/schema.types';
import type { ProjectMathSceneStyle } from '../../types/clip-payload.types';
import type { ProjectMathSceneViewport } from '../../types/clip-payload.types';
import type { ProjectMathTangentObject } from '../../types/clip-payload.types';
import type { ProjectMediaBoardNodeLayout } from '../../types/schema.types';
import type { ProjectMediaBoardViewport } from '../../types/schema.types';

export const ProjectFlashBoardChatToolResultFields = {
  "success": { class: 'journal', owner: 'flashboard' },
  "data": { class: 'journal', owner: 'flashboard' },
  "error": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardChatToolResult>;

export const ProjectFlashBoardComposerModelSettingsFields = {
  "version": { class: 'content', owner: 'flashboard' },
  "mode": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
  "aspectRatio": { class: 'content', owner: 'flashboard' },
  "imageSize": { class: 'content', owner: 'flashboard' },
  "generateAudio": { class: 'content', owner: 'flashboard' },
  "multiShots": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardComposerModelSettings>;

export const ProjectFlashBoardComposerStateFields = {
  "isOpen": { class: 'content', owner: 'flashboard' },
  "draftPrompt": { class: 'content', owner: 'flashboard' },
  "service": { class: 'content', owner: 'flashboard' },
  "providerId": { class: 'content', owner: 'flashboard' },
  "version": { class: 'content', owner: 'flashboard' },
  "outputType": { class: 'content', owner: 'flashboard' },
  "mode": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
  "aspectRatio": { class: 'content', owner: 'flashboard' },
  "imageSize": { class: 'content', owner: 'flashboard' },
  "generateAudio": { class: 'content', owner: 'flashboard' },
  "multiShots": { class: 'content', owner: 'flashboard' },
  "multiPrompt": { class: 'content', owner: 'flashboard' },
  "voiceId": { class: 'content', owner: 'flashboard' },
  "voiceName": { class: 'content', owner: 'flashboard' },
  "languageOverride": { class: 'content', owner: 'flashboard' },
  "languageCode": { class: 'content', owner: 'flashboard' },
  "outputFormat": { class: 'content', owner: 'flashboard' },
  "videoOutputFormat": { class: 'content', owner: 'flashboard' },
  "webSearch": { class: 'content', owner: 'flashboard' },
  "returnLastFrame": { class: 'content', owner: 'flashboard' },
  "voiceSettings": { class: 'content', owner: 'flashboard' },
  "sunoCustomMode": { class: 'content', owner: 'flashboard' },
  "sunoInstrumental": { class: 'content', owner: 'flashboard' },
  "sunoStyle": { class: 'content', owner: 'flashboard' },
  "sunoTitle": { class: 'content', owner: 'flashboard' },
  "sunoNegativeTags": { class: 'content', owner: 'flashboard' },
  "sunoVocalGender": { class: 'content', owner: 'flashboard' },
  "sunoStyleWeight": { class: 'content', owner: 'flashboard' },
  "sunoWeirdnessConstraint": { class: 'content', owner: 'flashboard' },
  "sunoAudioWeight": { class: 'content', owner: 'flashboard' },
  "startMediaFileId": { class: 'content', owner: 'flashboard' },
  "endMediaFileId": { class: 'content', owner: 'flashboard' },
  "referenceMediaFileIds": { class: 'content', owner: 'flashboard' },
  "modelSettingsByKey": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardComposerState>;

export const ProjectFlashBoardGenerationMetadataFields = {
  "mediaFileId": { class: 'content', owner: 'flashboard' },
  "workspaceId": { class: 'content', owner: 'flashboard' },
  "generationElapsedMs": { class: 'content', owner: 'flashboard' },
  "service": { class: 'content', owner: 'flashboard' },
  "providerId": { class: 'content', owner: 'flashboard' },
  "version": { class: 'content', owner: 'flashboard' },
  "outputType": { class: 'content', owner: 'flashboard' },
  "mediaType": { class: 'content', owner: 'flashboard' },
  "mode": { class: 'content', owner: 'flashboard' },
  "originalPrompt": { class: 'content', owner: 'flashboard' },
  "prompt": { class: 'content', owner: 'flashboard' },
  "negativePrompt": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
  "aspectRatio": { class: 'content', owner: 'flashboard' },
  "imageSize": { class: 'content', owner: 'flashboard' },
  "generateAudio": { class: 'content', owner: 'flashboard' },
  "multiShots": { class: 'content', owner: 'flashboard' },
  "multiPrompt": { class: 'content', owner: 'flashboard' },
  "voiceId": { class: 'content', owner: 'flashboard' },
  "voiceName": { class: 'content', owner: 'flashboard' },
  "languageOverride": { class: 'content', owner: 'flashboard' },
  "languageCode": { class: 'content', owner: 'flashboard' },
  "outputFormat": { class: 'content', owner: 'flashboard' },
  "voiceSettings": { class: 'content', owner: 'flashboard' },
  "sunoCustomMode": { class: 'content', owner: 'flashboard' },
  "sunoInstrumental": { class: 'content', owner: 'flashboard' },
  "sunoStyle": { class: 'content', owner: 'flashboard' },
  "sunoTitle": { class: 'content', owner: 'flashboard' },
  "sunoNegativeTags": { class: 'content', owner: 'flashboard' },
  "sunoVocalGender": { class: 'content', owner: 'flashboard' },
  "sunoStyleWeight": { class: 'content', owner: 'flashboard' },
  "sunoWeirdnessConstraint": { class: 'content', owner: 'flashboard' },
  "sunoAudioWeight": { class: 'content', owner: 'flashboard' },
  "startMediaFileId": { class: 'content', owner: 'flashboard' },
  "endMediaFileId": { class: 'content', owner: 'flashboard' },
  "referenceMediaFileIds": { class: 'content', owner: 'flashboard' },
  "createdAt": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardGenerationMetadata>;

export const ProjectFlashBoardGenerationOutputFields = {
  "id": { class: 'content', owner: 'flashboard' },
  "mediaType": { class: 'content', owner: 'flashboard' },
  "availability": { class: 'content', owner: 'flashboard' },
  "importStatus": { class: 'content', owner: 'flashboard' },
  "importError": { class: 'content', owner: 'flashboard' },
  "artworkUrl": { class: 'content', owner: 'flashboard' },
  "downloadUrl": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
  "mediaFileId": { class: 'content', owner: 'flashboard' },
  "previewUrl": { class: 'content', owner: 'flashboard' },
  "title": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardGenerationOutput>;

export const ProjectFlashBoardGenerationRecordFields = {
  "id": { class: 'journal', owner: 'flashboard' },
  "workspaceId": { class: 'journal', owner: 'flashboard' },
  "createdAt": { class: 'journal', owner: 'flashboard' },
  "updatedAt": { class: 'journal', owner: 'flashboard' },
  "request": { class: 'journal', owner: 'flashboard' },
  "job": { class: 'journal', owner: 'flashboard' },
  "outputs": { class: 'journal', owner: 'flashboard' },
  "result": { class: 'journal', owner: 'flashboard' },
  "results": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardGenerationRecord>;

export const ProjectFlashBoardGenerationRequestFields = {
  "service": { class: 'journal', owner: 'flashboard' },
  "providerId": { class: 'journal', owner: 'flashboard' },
  "version": { class: 'journal', owner: 'flashboard' },
  "idempotencyKey": { class: 'journal', owner: 'flashboard' },
  "outputType": { class: 'journal', owner: 'flashboard' },
  "mode": { class: 'journal', owner: 'flashboard' },
  "originalPrompt": { class: 'journal', owner: 'flashboard' },
  "prompt": { class: 'journal', owner: 'flashboard' },
  "negativePrompt": { class: 'journal', owner: 'flashboard' },
  "duration": { class: 'journal', owner: 'flashboard' },
  "aspectRatio": { class: 'journal', owner: 'flashboard' },
  "imageSize": { class: 'journal', owner: 'flashboard' },
  "generateAudio": { class: 'journal', owner: 'flashboard' },
  "multiShots": { class: 'journal', owner: 'flashboard' },
  "multiPrompt": { class: 'journal', owner: 'flashboard' },
  "voiceId": { class: 'journal', owner: 'flashboard' },
  "voiceName": { class: 'journal', owner: 'flashboard' },
  "languageOverride": { class: 'journal', owner: 'flashboard' },
  "languageCode": { class: 'journal', owner: 'flashboard' },
  "outputFormat": { class: 'journal', owner: 'flashboard' },
  "voiceSettings": { class: 'journal', owner: 'flashboard' },
  "sunoCustomMode": { class: 'journal', owner: 'flashboard' },
  "sunoInstrumental": { class: 'journal', owner: 'flashboard' },
  "sunoStyle": { class: 'journal', owner: 'flashboard' },
  "sunoTitle": { class: 'journal', owner: 'flashboard' },
  "sunoNegativeTags": { class: 'journal', owner: 'flashboard' },
  "sunoVocalGender": { class: 'journal', owner: 'flashboard' },
  "sunoStyleWeight": { class: 'journal', owner: 'flashboard' },
  "sunoWeirdnessConstraint": { class: 'journal', owner: 'flashboard' },
  "sunoAudioWeight": { class: 'journal', owner: 'flashboard' },
  "startMediaFileId": { class: 'journal', owner: 'flashboard' },
  "endMediaFileId": { class: 'journal', owner: 'flashboard' },
  "referenceMediaFileIds": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardGenerationRequest>;

export const ProjectFlashBoardJobStateFields = {
  "status": { class: 'journal', owner: 'flashboard' },
  "remoteTaskId": { class: 'journal', owner: 'flashboard' },
  "progress": { class: 'runtime', owner: 'flashboard' },
  "startedAt": { class: 'journal', owner: 'flashboard' },
  "completedAt": { class: 'journal', owner: 'flashboard' },
  "error": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardJobState>;

export const ProjectFlashBoardMultiShotPromptFields = {
  "index": { class: 'content', owner: 'flashboard' },
  "prompt": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardMultiShotPrompt>;

export const ProjectFlashBoardPromptHistoryEntryFields = {
  "id": { class: 'journal', owner: 'flashboard' },
  "kind": { class: 'journal', owner: 'flashboard' },
  "prompt": { class: 'journal', owner: 'flashboard' },
  "createdAt": { class: 'journal', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardPromptHistoryEntry>;

export const ProjectFlashBoardResultFields = {
  "mediaFileId": { class: 'content', owner: 'flashboard' },
  "mediaType": { class: 'content', owner: 'flashboard' },
  "outputId": { class: 'content', owner: 'flashboard' },
  "duration": { class: 'content', owner: 'flashboard' },
  "width": { class: 'content', owner: 'flashboard' },
  "height": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardResult>;

export const ProjectFlashBoardStateFields = {
  "version": { class: 'container', owner: 'flashboard' },
  "composer": { class: 'workspace', owner: 'flashboard' },
  "promptHistory": { class: 'journal', owner: 'flashboard' },
  "chatMessages": { class: 'journal', owner: 'flashboard' },
  "workspaces": { class: 'mixed', owner: 'flashboard' },
  "activeWorkspaceId": { class: 'workspace', owner: 'flashboard' },
  "generationRecords": { class: 'journal', owner: 'flashboard' },
  "generationMetadataByMediaId": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardState>;

export const ProjectFlashBoardVoiceSettingsFields = {
  "speed": { class: 'content', owner: 'flashboard' },
  "stability": { class: 'content', owner: 'flashboard' },
  "similarityBoost": { class: 'content', owner: 'flashboard' },
  "style": { class: 'content', owner: 'flashboard' },
  "useSpeakerBoost": { class: 'content', owner: 'flashboard' },
} as const satisfies FieldOwnershipMap<ProjectFlashBoardVoiceSettings>;

export const ProjectFolderFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFolder>;

export const ProjectFrameAnalysisDataFields = {
  "timestamp": { class: 'content', owner: 'timeline' },
  "motion": { class: 'content', owner: 'timeline' },
  "globalMotion": { class: 'content', owner: 'timeline' },
  "localMotion": { class: 'content', owner: 'timeline' },
  "focus": { class: 'content', owner: 'timeline' },
  "brightness": { class: 'content', owner: 'timeline' },
  "faceCount": { class: 'content', owner: 'timeline' },
  "faces": { class: 'content', owner: 'timeline' },
  "faceModelVersion": { class: 'content', owner: 'timeline' },
  "isSceneCut": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectFrameAnalysisData>;

export const ProjectGaussianSplatBoundsFields = {
  "min": { class: 'content', owner: 'timeline' },
  "max": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatBounds>;

export const ProjectGaussianSplatParticleSettingsFields = {
  "enabled": { class: 'content', owner: 'timeline' },
  "effectType": { class: 'content', owner: 'timeline' },
  "intensity": { class: 'content', owner: 'timeline' },
  "speed": { class: 'content', owner: 'timeline' },
  "seed": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatParticleSettings>;

export const ProjectGaussianSplatRenderSettingsFields = {
  "useNativeRenderer": { class: 'content', owner: 'timeline' },
  "maxSplats": { class: 'content', owner: 'timeline' },
  "splatScale": { class: 'content', owner: 'timeline' },
  "orientationPreset": { class: 'content', owner: 'timeline' },
  "nearPlane": { class: 'content', owner: 'timeline' },
  "farPlane": { class: 'content', owner: 'timeline' },
  "backgroundColor": { class: 'content', owner: 'timeline' },
  "sortFrequency": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatRenderSettings>;

export const ProjectGaussianSplatSequenceDataFields = {
  "fps": { class: 'content', owner: 'timeline' },
  "frameCount": { class: 'content', owner: 'timeline' },
  "playbackMode": { class: 'content', owner: 'timeline' },
  "sequenceName": { class: 'content', owner: 'timeline' },
  "sharedBounds": { class: 'content', owner: 'timeline' },
  "totalSplatCount": { class: 'content', owner: 'timeline' },
  "minSplatCount": { class: 'content', owner: 'timeline' },
  "maxSplatCount": { class: 'content', owner: 'timeline' },
  "totalFileSize": { class: 'content', owner: 'timeline' },
  "container": { class: 'content', owner: 'timeline' },
  "codec": { class: 'content', owner: 'timeline' },
  "frames": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatSequenceData>;

export const ProjectGaussianSplatSequenceFrameFields = {
  "name": { class: 'content', owner: 'timeline' },
  "projectPath": { class: 'resolver', owner: 'timeline' },
  "sourcePath": { class: 'resolver', owner: 'timeline' },
  "absolutePath": { class: 'resolver', owner: 'timeline' },
  "splatCount": { class: 'content', owner: 'timeline' },
  "fileSize": { class: 'content', owner: 'timeline' },
  "container": { class: 'content', owner: 'timeline' },
  "codec": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatSequenceFrame>;

export const ProjectGaussianSplatSettingsFields = {
  "render": { class: 'content', owner: 'timeline' },
  "temporal": { class: 'content', owner: 'timeline' },
  "particle": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatSettings>;

export const ProjectGaussianSplatTemporalSettingsFields = {
  "enabled": { class: 'content', owner: 'timeline' },
  "playbackMode": { class: 'content', owner: 'timeline' },
  "sequenceFps": { class: 'content', owner: 'timeline' },
  "frameBlend": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectGaussianSplatTemporalSettings>;

export const ProjectHistoryBranchStateFields = {
  "id": { class: 'content', owner: 'timeline' },
  "label": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "baseSnapshot": { class: 'content', owner: 'timeline' },
  "baseUndoStack": { class: 'content', owner: 'timeline' },
  "snapshots": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectHistoryBranchState>;

export const ProjectHistoryNodeStateFields = {
  "id": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "snapshot": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectHistoryNodeState>;

export const ProjectHistoryStateV1Fields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "undoStack": { class: 'content', owner: 'timeline' },
  "redoStack": { class: 'content', owner: 'timeline' },
  "currentSnapshot": { class: 'content', owner: 'timeline' },
  "eventLog": { class: 'content', owner: 'timeline' },
  "visibleEntries": { class: 'content', owner: 'timeline' },
  "branches": { class: 'content', owner: 'timeline' },
  "maxHistorySize": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectHistoryStateV1>;

export const ProjectHistoryStateV2Fields = {
  "schemaVersion": { class: 'content', owner: 'timeline' },
  "nodes": { class: 'content', owner: 'timeline' },
  "activeNodeId": { class: 'content', owner: 'timeline' },
  "lastVisitedChildByNodeId": { class: 'content', owner: 'timeline' },
  "eventLog": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectHistoryStateV2>;

export const ProjectKeyframeFields = {
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
  "hold": { class: 'content', owner: 'timeline' },
  "animationSource": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "property": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
  "pathValue": { class: 'content', owner: 'timeline' },
  "easing": { class: 'content', owner: 'timeline' },
  "cameraOrbitPivot": { class: 'content', owner: 'timeline' },
  "rotationInterpolation": { class: 'content', owner: 'timeline' },
  "bezierHandles": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectKeyframe>;

export const ProjectLightItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "lightSettings": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectLightItem>;

export const ProjectLightSettingsFields = {
  "kind": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "intensity": { class: 'content', owner: 'timeline' },
  "diameter": { class: 'content', owner: 'timeline' },
  "castsShadows": { class: 'content', owner: 'timeline' },
  "shadowStrength": { class: 'content', owner: 'timeline' },
  "environmentMapMediaFileId": { class: 'content', owner: 'timeline' },
  "environmentMapUrl": { class: 'resolver', owner: 'timeline' },
  "environmentMapFileName": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectLightSettings>;

export const ProjectMarkerFields = {
  "id": { class: 'content', owner: 'timeline' },
  "time": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "stopPlayback": { class: 'content', owner: 'timeline' },
  "midiBindings": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMarker>;

export const ProjectMaskFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "purpose": { class: 'content', owner: 'timeline' },
  "compositeEnabled": { class: 'content', owner: 'timeline' },
  "mode": { class: 'content', owner: 'timeline' },
  "inverted": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "feather": { class: 'content', owner: 'timeline' },
  "edgeFeathers": { class: 'content', owner: 'timeline' },
  "featherQuality": { class: 'content', owner: 'timeline' },
  "featherOffset": { class: 'content', owner: 'timeline' },
  "featherBalance": { class: 'content', owner: 'timeline' },
  "enabled": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "outlineColor": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
  "vertices": { class: 'content', owner: 'timeline' },
  "position": { class: 'content', owner: 'timeline' },
  "rotation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMask>;

export const ProjectMaskPathKeyframeValueFields = {
  "vertices": { class: 'content', owner: 'timeline' },
  "closed": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMaskPathKeyframeValue>;

export const ProjectMaskPathVertexFields = {
  "id": { class: 'content', owner: 'timeline' },
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "handleIn": { class: 'content', owner: 'timeline' },
  "handleOut": { class: 'content', owner: 'timeline' },
  "handleMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMaskPathVertex>;

export const ProjectMaskVertexFields = {
  "x": { class: 'content', owner: 'timeline' },
  "y": { class: 'content', owner: 'timeline' },
  "inTangent": { class: 'content', owner: 'timeline' },
  "outTangent": { class: 'content', owner: 'timeline' },
  "handleMode": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMaskVertex>;

export const ProjectMathFunctionObjectFields = {
  "type": { class: 'content', owner: 'timeline' },
  "expression": { class: 'content', owner: 'timeline' },
  "domain": { class: 'content', owner: 'timeline' },
  "samples": { class: 'content', owner: 'timeline' },
  "stroke": { class: 'content', owner: 'timeline' },
  "strokeWidth": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathFunctionObject>;

export const ProjectMathLabelObjectFields = {
  "type": { class: 'content', owner: 'timeline' },
  "text": { class: 'content', owner: 'timeline' },
  "xExpression": { class: 'content', owner: 'timeline' },
  "yExpression": { class: 'content', owner: 'timeline' },
  "fontSize": { class: 'content', owner: 'timeline' },
  "color": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathLabelObject>;

export const ProjectMathObjectAnimationFields = {
  "reveal": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathObjectAnimation>;

export const ProjectMathParameterFields = {
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "value": { class: 'content', owner: 'timeline' },
  "min": { class: 'content', owner: 'timeline' },
  "max": { class: 'content', owner: 'timeline' },
  "step": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathParameter>;

export const ProjectMathParameterAnimationFields = {
  "enabled": { class: 'content', owner: 'timeline' },
  "from": { class: 'content', owner: 'timeline' },
  "to": { class: 'content', owner: 'timeline' },
  "startTime": { class: 'content', owner: 'timeline' },
  "endTime": { class: 'content', owner: 'timeline' },
  "easing": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathParameterAnimation>;

export const ProjectMathPointObjectFields = {
  "type": { class: 'content', owner: 'timeline' },
  "xExpression": { class: 'content', owner: 'timeline' },
  "yExpression": { class: 'content', owner: 'timeline' },
  "radius": { class: 'content', owner: 'timeline' },
  "fill": { class: 'content', owner: 'timeline' },
  "stroke": { class: 'content', owner: 'timeline' },
  "labelVisible": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathPointObject>;

export const ProjectMathSceneDefinitionFields = {
  "version": { class: 'content', owner: 'timeline' },
  "viewport": { class: 'content', owner: 'timeline' },
  "style": { class: 'content', owner: 'timeline' },
  "parameters": { class: 'content', owner: 'timeline' },
  "objects": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathSceneDefinition>;

export const ProjectMathSceneItemFields = {
  "type": { class: 'content', owner: 'timeline' },
  "duration": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "parentId": { class: 'content', owner: 'timeline' },
  "createdAt": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathSceneItem>;

export const ProjectMathSceneStyleFields = {
  "backgroundColor": { class: 'content', owner: 'timeline' },
  "axisColor": { class: 'content', owner: 'timeline' },
  "gridColor": { class: 'content', owner: 'timeline' },
  "labelColor": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathSceneStyle>;

export const ProjectMathSceneViewportFields = {
  "xMin": { class: 'content', owner: 'timeline' },
  "xMax": { class: 'content', owner: 'timeline' },
  "yMin": { class: 'content', owner: 'timeline' },
  "yMax": { class: 'content', owner: 'timeline' },
  "showGrid": { class: 'content', owner: 'timeline' },
  "showAxes": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathSceneViewport>;

export const ProjectMathTangentObjectFields = {
  "type": { class: 'content', owner: 'timeline' },
  "functionId": { class: 'content', owner: 'timeline' },
  "atExpression": { class: 'content', owner: 'timeline' },
  "length": { class: 'content', owner: 'timeline' },
  "stroke": { class: 'content', owner: 'timeline' },
  "strokeWidth": { class: 'content', owner: 'timeline' },
  "id": { class: 'content', owner: 'timeline' },
  "name": { class: 'content', owner: 'timeline' },
  "visible": { class: 'content', owner: 'timeline' },
  "opacity": { class: 'content', owner: 'timeline' },
  "animation": { class: 'content', owner: 'timeline' },
} as const satisfies FieldOwnershipMap<ProjectMathTangentObject>;

export const ProjectMediaBoardNodeLayoutFields = {
  "x": { class: 'content', owner: 'media' },
  "y": { class: 'content', owner: 'media' },
  "width": { class: 'content', owner: 'media' },
  "height": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<ProjectMediaBoardNodeLayout>;

export const ProjectMediaBoardViewportFields = {
  "zoom": { class: 'content', owner: 'media' },
  "panX": { class: 'content', owner: 'media' },
  "panY": { class: 'content', owner: 'media' },
} as const satisfies FieldOwnershipMap<ProjectMediaBoardViewport>;
