// LayerBuilder Module - Exports for the refactored layer builder
// Maintains backward compatibility with the old API

import { LayerBuilderService } from './LayerBuilderService';

// Re-export types
export type {
  FrameContext,
  ClipTimeInfo,
  AudioSyncState,
  AudioSyncTarget,
  CachedTransform,
  NativeDecoderState,
} from './types';

export { LAYER_BUILDER_CONSTANTS } from './types';

// Re-export PlayheadState (used by Timeline.tsx)
export {
  playheadState,
  getPlayheadPosition,
  setMasterAudio,
  clearMasterAudio,
  startInternalPosition,
  stopInternalPosition,
  updateInternalPosition,
} from './PlayheadState';

// Re-export FrameContext utilities
export {
  createFrameContext,
  getMediaFileForClip,
  isVideoTrackVisible,
  isAudioTrackMuted,
  getClipForTrack,
  getClipTimeInfo,
} from './FrameContext';

// Re-export sub-modules for advanced usage
export { LayerCache } from './LayerCache';
export { TransformCache } from './TransformCache';
export { AudioSyncHandler, createAudioSyncState, finalizeAudioSync } from './AudioSyncHandler';
export { VideoSyncManager } from './VideoSyncManager';
export { AudioTrackSyncManager } from './AudioTrackSyncManager';
export { LayerBuilderService } from './LayerBuilderService';

// Singleton instance (backward compatible)
export const layerBuilder = new LayerBuilderService();

// Default export for convenience
export default layerBuilder;
