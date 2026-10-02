import type { ProjectFile } from '../../types/project.types';
import { createDefaultRulerLaneState } from '../../../../timeline/tempo/rulerDefaults';
export function createRepositoryProject(name: string): ProjectFile {
  const id = 'comp-' + crypto.randomUUID(); const now = new Date().toISOString();
  return { version: 1, name, createdAt: now, updatedAt: now,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 }, media: [], folders: [],
    compositions: [{ id, name: 'Main Comp', width: 1920, height: 1080, frameRate: 30, duration: 60,
      backgroundColor: '#000000', folderId: null, tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', height: 40, locked: false, visible: true, muted: false, solo: false },
      ], clips: [], markers: [], ...createDefaultRulerLaneState() }], activeCompositionId: id, openCompositionIds: [id], expandedFolderIds: [] };
}
