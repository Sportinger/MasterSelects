import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/services/project/types/project.types';

const mocks = vi.hoisted(() => ({
  project: null as { createdAt: string } | null,
  compositionId: 'comp-1' as string | null,
  syncing: false,
  timeline: {
    clips: [{ id: 'video' }, { id: 'audio' }],
    selectedClipIds: new Set<string>(),
    primarySelectedClipId: null as string | null,
    propertiesSelection: null as { kind: 'clip'; clipId: string } | null,
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: { getProjectData: () => mocks.project },
}));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ activeCompositionId: mocks.compositionId }) },
}));
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => mocks.timeline,
    setState: (patch: Partial<typeof mocks.timeline>) => Object.assign(mocks.timeline, patch),
  },
}));
vi.mock('../../src/services/project/projectStoreSyncGuard', () => ({
  isProjectStoreSyncInProgress: () => mocks.syncing,
}));

import {
  readTimelineSelectionRecovery,
  restoreTimelineSelectionRecovery,
  setupTimelineSelectionReloadRecovery,
} from '../../src/services/project/timelineSelectionRecovery';

const project = {
  createdAt: '2026-09-21T09:00:00.000Z',
  activeCompositionId: 'comp-1',
  compositions: [{ id: 'comp-1' }, { id: 'comp-2' }],
} as ProjectFile;
let dispose: () => void;

function selectClips(ids: string[], primary = ids[0] ?? null) {
  mocks.timeline.selectedClipIds = new Set(ids);
  mocks.timeline.primarySelectedClipId = primary;
  mocks.timeline.propertiesSelection = primary ? { kind: 'clip', clipId: primary } : null;
}

function reloadSelection(event = 'beforeunload') {
  window.dispatchEvent(new Event(event));
  selectClips([]); // Timeline hydration clears transient selection.
  const recovery = readTimelineSelectionRecovery(project);
  restoreTimelineSelectionRecovery(recovery);
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.project = project;
  mocks.compositionId = 'comp-1';
  mocks.syncing = false;
  mocks.timeline.clips = [{ id: 'video' }, { id: 'audio' }];
  selectClips([]);
  dispose = setupTimelineSelectionReloadRecovery();
});

afterEach(() => {
  dispose();
  vi.restoreAllMocks();
});

describe('timeline selection after refresh', () => {
  it('restores the latest selection immediately without saving the project', () => {
    selectClips(['video']);
    selectClips(['audio']);
    reloadSelection();
    expect([...mocks.timeline.selectedClipIds]).toEqual(['audio']);
    expect(mocks.timeline.primarySelectedClipId).toBe('audio');
    expect(mocks.timeline.propertiesSelection).toEqual({ kind: 'clip', clipId: 'audio' });
    expect(readTimelineSelectionRecovery(project)).toBeNull();
  });

  it('preserves multiple selected clips and the focused Properties clip on pagehide', () => {
    selectClips(['video', 'audio'], 'audio');
    reloadSelection('pagehide');
    expect([...mocks.timeline.selectedClipIds]).toEqual(['video', 'audio']);
    expect(mocks.timeline.propertiesSelection).toEqual({ kind: 'clip', clipId: 'audio' });
  });

  it('remembers the current composition even when the saved active composition differs', () => {
    mocks.compositionId = 'comp-2';
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    expect(readTimelineSelectionRecovery(project)?.compositionId).toBe('comp-2');
    expect(project.activeCompositionId).toBe('comp-1');
  });

  it('keeps an explicitly cleared selection empty', () => {
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    selectClips([]);
    reloadSelection();
    expect(mocks.timeline.selectedClipIds.size).toBe(0);
    expect(mocks.timeline.primarySelectedClipId).toBeNull();
    expect(mocks.timeline.propertiesSelection).toBeNull();
  });

  it('filters clips absent after loading and falls back to a surviving selected clip', () => {
    selectClips(['video', 'audio', 'unsaved'], 'unsaved');
    mocks.timeline.clips = [{ id: 'audio' }];
    reloadSelection();
    expect([...mocks.timeline.selectedClipIds]).toEqual(['audio']);
    expect(mocks.timeline.propertiesSelection).toEqual({ kind: 'clip', clipId: 'audio' });
  });

  it('does not restore an invalid primary clip left over from a shift-toggle', () => {
    selectClips(['video'], 'audio');
    mocks.timeline.propertiesSelection = { kind: 'clip', clipId: 'video' };
    reloadSelection();
    expect(mocks.timeline.primarySelectedClipId).toBe('video');
  });

  it('does not carry selection into another project or a missing composition', () => {
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    expect(readTimelineSelectionRecovery({ ...project, createdAt: 'other-project' })).toBeNull();
    expect(readTimelineSelectionRecovery({ ...project, compositions: [] })).toBeNull();
  });

  it('does not apply clip IDs to a different active composition', () => {
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    const recovery = readTimelineSelectionRecovery(project);
    mocks.compositionId = 'comp-2';
    selectClips([]);
    restoreTimelineSelectionRecovery(recovery);
    expect(mocks.timeline.selectedClipIds.size).toBe(0);
  });

  it('retains the snapshot when reloading again during hydration', () => {
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    const recovery = readTimelineSelectionRecovery(project);
    mocks.syncing = true;
    selectClips([]);
    window.dispatchEvent(new Event('beforeunload'));
    expect(readTimelineSelectionRecovery(project)).toEqual(recovery);
    mocks.syncing = false;
    restoreTimelineSelectionRecovery(recovery);
    expect([...mocks.timeline.selectedClipIds]).toEqual(['video']);
  });

  it('clears old recovery when unloading with no open project', () => {
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    mocks.project = null;
    window.dispatchEvent(new Event('pagehide'));
    expect(readTimelineSelectionRecovery(project)).toBeNull();
  });

  it.each(['null', '{', '{"selectedClipIds":5}'])(
    'ignores malformed recovery %s', raw => {
      window.sessionStorage.setItem('masterselects.timelineSelectionReload', raw);
      expect(readTimelineSelectionRecovery(project)).toBeNull();
      expect(() => restoreTimelineSelectionRecovery(null)).not.toThrow();
    },
  );

  it('tolerates unavailable browser storage', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => reloadSelection()).not.toThrow();
    expect(readTimelineSelectionRecovery(project)).toBeNull();
  });

  it('unregisters both unload listeners on teardown', () => {
    dispose();
    selectClips(['video']);
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    expect(readTimelineSelectionRecovery(project)).toBeNull();
  });
});
