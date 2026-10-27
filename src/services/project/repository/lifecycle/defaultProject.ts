import type { ProjectFile } from '../../types/project.types';
import { createDefaultRulerLaneState } from '../../../../timeline/tempo/rulerDefaults';
/** Size and frame rate of the first composition of a new project (default 1920x1080 at 30 fps). */
export interface NewProjectComposition { width: number; height: number; frameRate: number }
const DEFAULT_NEW_PROJECT_COMPOSITION: NewProjectComposition = { width: 1920, height: 1080, frameRate: 30 };
// The initial size is part of the first revision, so Undo can never fall back to the default size.
export function createRepositoryProject(name: string, composition: NewProjectComposition = DEFAULT_NEW_PROJECT_COMPOSITION): ProjectFile {
  const id = 'comp-' + crypto.randomUUID(); const now = new Date().toISOString(); const { width, height, frameRate } = composition;
  return { version: 1, name, createdAt: now, updatedAt: now,
    settings: { width, height, frameRate, sampleRate: 48000 }, media: [], folders: [],
    compositions: [{ id, name: 'Main Comp', width, height, frameRate, duration: 60,
      backgroundColor: '#000000', folderId: null, tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', height: 40, locked: false, visible: true, muted: false, solo: false },
      ], clips: [], markers: [], ...createDefaultRulerLaneState() }], activeCompositionId: id, openCompositionIds: [id], expandedFolderIds: [] };
}
