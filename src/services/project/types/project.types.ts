// Project-level types

import type { ProjectMediaFile } from './media.types';
import type { ProjectComposition } from './composition.types';
import type { ProjectFolder } from './folder.types';

export interface ProjectYouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: string;
}

export interface ProjectYouTubeState {
  videos: ProjectYouTubeVideo[];
  lastQuery: string;
}

export interface ProjectSettings {
  width: number;
  height: number;
  frameRate: number;
  sampleRate: number;
}

export interface ProjectFile {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;

  // Project settings
  settings: ProjectSettings;

  // Media references (paths relative to project folder or absolute)
  media: ProjectMediaFile[];

  // Compositions (timelines)
  compositions: ProjectComposition[];

  // Folders for organization
  folders: ProjectFolder[];

  // Active state
  activeCompositionId: string | null;
  openCompositionIds: string[];
  expandedFolderIds: string[];

  // Media source folders (for relinking after cache clear)
  mediaSourceFolders?: string[];

  // YouTube panel state
  youtube?: ProjectYouTubeState;
}
