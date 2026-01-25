// Project module re-exports for backward compatibility
// All existing imports continue to work unchanged

// Main service
export { projectFileService } from './ProjectFileService';

// All types
export type {
  ProjectFile,
  ProjectSettings,
  ProjectYouTubeVideo,
  ProjectYouTubeState,
  ProjectMediaFile,
  ProjectComposition,
  ProjectTrack,
  ProjectClip,
  ProjectTransform,
  ProjectEffect,
  ProjectMask,
  ProjectMaskVertex,
  ProjectKeyframe,
  ProjectMarker,
  ProjectFolder,
} from './types';

// Core services (for advanced usage)
export { FileStorageService, fileStorageService } from './core/FileStorageService';
export { ProjectCoreService } from './core/ProjectCoreService';
export { PROJECT_FOLDERS, MAX_BACKUPS, PROJECT_FOLDER_PATHS } from './core/constants';
export type { ProjectFolderKey } from './core/constants';

// Domain services (for advanced usage)
export { AnalysisService } from './domains/AnalysisService';
export { TranscriptService } from './domains/TranscriptService';
export { CacheService } from './domains/CacheService';
export { ProxyStorageService } from './domains/ProxyStorageService';
export { RawMediaService } from './domains/RawMediaService';
