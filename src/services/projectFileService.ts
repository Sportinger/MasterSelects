// Backward compatibility shim
// Re-exports from the refactored project module
// All existing imports continue to work unchanged

export {
  projectFileService,
  type ProjectFile,
  type ProjectSettings,
  type ProjectYouTubeVideo,
  type ProjectMediaFile,
  type ProjectComposition,
  type ProjectTrack,
  type ProjectClip,
  type ProjectEffect,
  type ProjectMask,
  type ProjectKeyframe,
  type ProjectMarker,
  type ProjectFolder,
} from './project';
