import type { useTimelineStore } from '../../../stores/timeline';
import type { CallerContext } from '../policy';
import type { ToolResult } from '../types';
import {
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
  handleFindSilentSections,
  handleGetClipAnalysis,
  handleGetClipFaceAnalysis,
  handleGetClipTranscript,
  handleStartClipAnalysis,
  handleStartClipFaceAnalysis,
  handleStartClipTranscription,
} from './analysis';
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

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;
type TimelineHandler = (
  args: Record<string, unknown>,
  store: TimelineStore,
  callerContext?: CallerContext,
) => Promise<ToolResult>;

/** Handlers that operate on the caller's single fresh timeline-store snapshot. */
export const timelineHandlers: Readonly<Record<string, TimelineHandler>> = {
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
  findSilentSections: handleFindSilentSections,
  findLowQualitySections: handleFindLowQualitySections,
  startClipAnalysis: handleStartClipAnalysis,
  startClipFaceAnalysis: handleStartClipFaceAnalysis,
  startClipTranscription: handleStartClipTranscription,
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
};
