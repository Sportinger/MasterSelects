import type { useTimelineStore } from '../../../stores/timeline';
import type { CallerContext } from '../policy';
import type { ToolResult } from '../types';
import {
  handleGetTimelineRangeSelection,
  handleGetTimelineState,
  handleSetInOutPoints,
  handleSetPlayhead,
} from './timeline';
import {
  handleClearSelection,
  handleCutRangesFromClip,
  handleDeleteClip,
  handleDeleteClips,
  handleGetClipDetails,
  handleGetClipsInTimeRange,
  handleMoveClip,
  handleReorderClips,
  handleSelectClips,
  handleSplitClip,
  handleSplitClipAtTimes,
  handleSplitClipEvenly,
  handleTrimClip,
} from './clips';
import {
  handleCreateTrack,
  handleDeleteTrack,
  handleSetTrackMuted,
  handleSetTrackVisibility,
} from './tracks';
import {
  handleFindLowQualitySections,
  handleGetClipAnalysis,
  handleGetClipFaceAnalysis,
  handleGetClipTranscript,
} from './analysis';
import { handleFindSilentSections } from './clipSilence';
import {
  handleStartClipAnalysis,
  handleStartClipAudioIntelligence,
  handleStartClipFaceAnalysis,
  handleStartClipTranscription,
} from './analysisStarters';
import { handleGetSpeechMarkers } from './speechMarkers';
import { handleRepairClipTranscript } from './repairTranscript';
import {
  handleAssignClipFaceReviewCandidate,
  handleMergeClipFacePeople,
  handleMoveClipFaceAppearance,
} from './faceAnalysisCorrections';
import {
  handleCaptureFrame,
  handleGetCutPreviewQuad,
  handleGetFramesAtTimes,
} from './preview';
import { handleRunPixelParticleDisintegrateQa } from './pixelParticleDisintegrateQa';
import { handleSetTransform } from './transform';
import {
  handleAddEffect,
  handleRemoveEffect,
  handleUpdateEffect,
} from './effects';
import {
  handleAddKeyframe,
  handleGetKeyframes,
} from './keyframes';
import {
  handleAddTextBoundsKeyframe,
  handleCreateTextClip,
  handleGetTextProperties,
  handleSetTextBox,
  handleUpdateTextProperties,
} from './text';
import {
  handleCreateCaptionClip,
  handleGetCaptionProperties,
  handleUpdateCaptionProperties,
} from './captions';
import { handleCreateEditableTitleStack } from './editableTitleStack';
import { handleManageEditableHook, handleRefineEditableHook } from './editableHook';
import {
  handleConfigureMotionReplicator,
  handleEditMotionModifier,
  handleSetMotionExpression,
  handleCreateMotionNull,
  handleCreateMotionNullAndParent,
  handleCreateMotionShapeClip,
  handleEditMotionAdjustment,
  handleGetMotionCapabilities,
  handleGetMotionDesign,
  handleSetMotionParent,
  handleUpdateMotionAppearances,
  handleSaveMotionAppearancePreset,
  handleListMotionAppearancePresets,
  handleApplyMotionAppearancePreset,
  handleSaveMotionTemplate,
  handleListMotionTemplates,
  handleApplyMotionTemplate,
  handleUpdateMotionProperties,
} from './motionDesign';
import {
  handleAddMarker,
  handleGetMarkers,
  handleMonitorManualPause,
  handlePause,
  handlePlay,
  handleRemoveMarker,
  handleSetClipSpeed,
  handleSimulateFrameKeypresses,
  handleSimulatePlayback,
  handleSimulatePlaybackPath,
  handleSimulatePlaybackPulses,
  handleSimulateScrub,
} from './playback';
import {
  handleAddTransition,
  handleRemoveTransition,
} from './transitions';
import {
  handleAddEllipseMask,
  handleAddMask,
  handleAddMaskPathKeyframe,
  handleAddRectangleMask,
  handleAddVertex,
  handleGetMasks,
  handleRemoveMask,
  handleRemoveVertex,
  handleUpdateMask,
  handleUpdateVertex,
} from './masks';
import {
  handleAddStoryboardScene,
  handleListStoryboardScenes,
  handleUpdateStoryboardScene,
} from './storyboard';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;
type TimelineHandler = (
  args: Record<string, unknown>,
  store: TimelineStore,
  callerContext?: CallerContext,
) => Promise<ToolResult>;

/** Handlers that operate on the caller's single fresh timeline-store snapshot. */
export const timelineHandlers: Readonly<Record<string, TimelineHandler>> = {
  getTimelineRangeSelection: handleGetTimelineRangeSelection,
  getTimelineState: handleGetTimelineState,
  setPlayhead: handleSetPlayhead,
  setInOutPoints: handleSetInOutPoints,
  getClipDetails: handleGetClipDetails,
  getClipsInTimeRange: handleGetClipsInTimeRange,
  splitClip: handleSplitClip,
  deleteClip: handleDeleteClip,
  deleteClips: handleDeleteClips,
  cutRangesFromClip: handleCutRangesFromClip,
  moveClip: handleMoveClip,
  trimClip: handleTrimClip,
  splitClipEvenly: handleSplitClipEvenly,
  splitClipAtTimes: handleSplitClipAtTimes,
  reorderClips: handleReorderClips,
  selectClips: handleSelectClips,
  clearSelection: handleClearSelection,
  createTrack: handleCreateTrack,
  deleteTrack: handleDeleteTrack,
  setTrackVisibility: handleSetTrackVisibility,
  setTrackMuted: handleSetTrackMuted,
  getClipAnalysis: handleGetClipAnalysis,
  getClipFaceAnalysis: handleGetClipFaceAnalysis,
  mergeClipFacePeople: handleMergeClipFacePeople,
  moveClipFaceAppearance: handleMoveClipFaceAppearance,
  assignClipFaceReviewCandidate: handleAssignClipFaceReviewCandidate,
  getClipTranscript: handleGetClipTranscript,
  getSpeechMarkers: handleGetSpeechMarkers,
  findSilentSections: handleFindSilentSections,
  findLowQualitySections: handleFindLowQualitySections,
  startClipAnalysis: handleStartClipAnalysis,
  startClipAudioIntelligence: handleStartClipAudioIntelligence,
  startClipFaceAnalysis: handleStartClipFaceAnalysis,
  startClipTranscription: handleStartClipTranscription,
  repairClipTranscript: handleRepairClipTranscript,
  captureFrame: handleCaptureFrame,
  getCutPreviewQuad: handleGetCutPreviewQuad,
  getFramesAtTimes: handleGetFramesAtTimes,
  runPixelParticleDisintegrateQa: async (args) => handleRunPixelParticleDisintegrateQa(args),
  setTransform: handleSetTransform,
  addEffect: handleAddEffect,
  removeEffect: handleRemoveEffect,
  updateEffect: handleUpdateEffect,
  getKeyframes: handleGetKeyframes,
  addKeyframe: handleAddKeyframe,
  getTextProperties: handleGetTextProperties,
  createEditableTitleStack: handleCreateEditableTitleStack,
  manageEditableHook: handleManageEditableHook,
  refineEditableHook: handleRefineEditableHook,
  createTextClip: handleCreateTextClip,
  updateTextProperties: handleUpdateTextProperties,
  setTextBox: handleSetTextBox,
  addTextBoundsKeyframe: handleAddTextBoundsKeyframe,
  getCaptionProperties: handleGetCaptionProperties,
  createCaptionClip: handleCreateCaptionClip,
  updateCaptionProperties: handleUpdateCaptionProperties,
  getMotionCapabilities: handleGetMotionCapabilities,
  getMotionDesign: handleGetMotionDesign,
  createMotionShapeClip: handleCreateMotionShapeClip,
  updateMotionProperties: handleUpdateMotionProperties,
  updateMotionAppearances: handleUpdateMotionAppearances,
  saveMotionAppearancePreset: handleSaveMotionAppearancePreset,
  listMotionAppearancePresets: handleListMotionAppearancePresets,
  applyMotionAppearancePreset: handleApplyMotionAppearancePreset,
  saveMotionTemplate: handleSaveMotionTemplate,
  listMotionTemplates: handleListMotionTemplates,
  applyMotionTemplate: handleApplyMotionTemplate,
  setMotionParent: handleSetMotionParent,
  createMotionNull: handleCreateMotionNull,
  createMotionNullAndParent: handleCreateMotionNullAndParent,
  editMotionAdjustment: handleEditMotionAdjustment,
  configureMotionReplicator: handleConfigureMotionReplicator,
  editMotionModifier: handleEditMotionModifier,
  setMotionExpression: handleSetMotionExpression,
  play: handlePlay,
  pause: handlePause,
  monitorManualPause: handleMonitorManualPause,
  simulateFrameKeypresses: handleSimulateFrameKeypresses,
  simulateScrub: handleSimulateScrub,
  simulatePlayback: handleSimulatePlayback,
  simulatePlaybackPulses: handleSimulatePlaybackPulses,
  simulatePlaybackPath: handleSimulatePlaybackPath,
  setClipSpeed: handleSetClipSpeed,
  addMarker: handleAddMarker,
  getMarkers: handleGetMarkers,
  removeMarker: handleRemoveMarker,
  addTransition: handleAddTransition,
  removeTransition: handleRemoveTransition,
  getMasks: handleGetMasks,
  addRectangleMask: handleAddRectangleMask,
  addEllipseMask: handleAddEllipseMask,
  addMask: handleAddMask,
  removeMask: handleRemoveMask,
  updateMask: handleUpdateMask,
  addVertex: handleAddVertex,
  removeVertex: handleRemoveVertex,
  updateVertex: handleUpdateVertex,
  addMaskPathKeyframe: handleAddMaskPathKeyframe,
  addStoryboardScene: handleAddStoryboardScene,
  updateStoryboardScene: handleUpdateStoryboardScene,
  listStoryboardScenes: handleListStoryboardScenes,
};
