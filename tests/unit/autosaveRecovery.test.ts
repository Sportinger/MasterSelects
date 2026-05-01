import { describe, expect, it } from 'vitest';
import {
  shouldPreferAutosave,
  shouldSkipEmptyProjectSave,
} from '../../src/services/project/core/autosaveRecovery';
import type { ProjectFile } from '../../src/services/project/types';

function createComposition(id = 'comp-1', clips: ProjectFile['compositions'][number]['clips'] = []): ProjectFile['compositions'][number] {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 60,
    backgroundColor: '#000000',
    folderId: null,
    tracks: [],
    clips,
    markers: [],
  };
}

function createProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    version: 1,
    name: 'Recovery Test',
    createdAt: '2026-04-30T12:00:00.000Z',
    updatedAt: '2026-04-30T12:00:00.000Z',
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
    },
    media: [],
    compositions: [createComposition()],
    folders: [],
    activeCompositionId: 'comp-1',
    openCompositionIds: ['comp-1'],
    expandedFolderIds: [],
    ...overrides,
  };
}

describe('autosave recovery', () => {
  it('prefers a newer autosave', () => {
    const project = createProject({ updatedAt: '2026-04-30T12:00:00.000Z' });
    const autosave = createProject({ updatedAt: '2026-04-30T12:01:00.000Z' });

    expect(shouldPreferAutosave(project, autosave)).toBe(true);
  });

  it('prefers a meaningful autosave over a freshly overwritten empty project', () => {
    const project = createProject({ updatedAt: '2026-05-01T12:55:38.332Z' });
    const autosave = createProject({
      updatedAt: '2026-04-30T14:45:20.310Z',
      folders: [{ id: 'folder-1', name: 'Shots', parentId: null }],
    });

    expect(shouldPreferAutosave(project, autosave)).toBe(true);
  });

  it('keeps a non-empty project when the autosave is older', () => {
    const project = createProject({
      updatedAt: '2026-05-01T12:55:38.332Z',
      folders: [{ id: 'folder-1', name: 'Current', parentId: null }],
    });
    const autosave = createProject({
      updatedAt: '2026-04-30T14:45:20.310Z',
      folders: [{ id: 'folder-2', name: 'Older', parentId: null }],
    });

    expect(shouldPreferAutosave(project, autosave)).toBe(false);
  });

  it('blocks saving an empty project over a meaningful autosave', () => {
    const project = createProject({ updatedAt: '2026-05-01T13:11:48.000Z' });
    const autosave = createProject({
      updatedAt: '2026-04-30T14:45:20.310Z',
      media: [{ id: 'media-1', name: 'clip.mp4' } as ProjectFile['media'][number]],
    });

    expect(shouldSkipEmptyProjectSave(project, autosave)).toBe(true);
  });
});
