import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  session: {} as object | null, media: {} as any, timeline: {} as any,
  workspace: {} as Record<string, unknown>, stage: vi.fn(), activate: vi.fn(), project: vi.fn(), abandon: vi.fn(),
  queue: vi.fn(), stop: vi.fn(), sync: vi.fn(), clear: vi.fn(), render: vi.fn(),
  publication: { generation: 4, revisionId: 'revision', blocked: false },
  clock: { isUsingInternalPosition: false, position: 42 },
}));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', () => ({
  withRepositoryHydration: (action: () => unknown) => action(),
  getRepositoryStore: (domain: string) => ({
    getState: () => domain === 'media' ? fixture.media : fixture.timeline,
    setState: (patch: object) => { if (domain === 'media') fixture.media = { ...fixture.media, ...patch };
      else fixture.timeline = { ...fixture.timeline, ...patch }; },
  }),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => fixture.session,
  getEditorRepositoryWorkspace: () => fixture.workspace,
  queueEditorRepositoryView: (key: string, value: unknown) => { fixture.queue(key, value); fixture.workspace[key] = value; },
}));
vi.mock('../../src/services/project/repository/transaction/editorPublication', () => ({
  readEditorContentPublication: () => fixture.publication,
  blockEditorContentPublication: () => { fixture.publication = { ...fixture.publication, blocked: true }; },
  publishEditorContentProjection: (value: typeof fixture.publication) => { fixture.publication = { ...value, blocked: false }; },
}));
vi.mock('../../src/services/project/repository/transaction/editorTimelineRestore', () => ({ stageEditorTimeline: fixture.stage }));
vi.mock('../../src/stores/timeline/exclusiveMutationLease', () => ({ isExclusiveTimelineMutationLeaseActive: () => false }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({
  playheadState: fixture.clock, stopInternalPosition: fixture.stop, updateInternalPosition: vi.fn(),
}));
vi.mock('../../src/services/audio/timelineAudioPlaybackStopper', () => ({ stopTimelineAudioPlayback: vi.fn() }));
vi.mock('../../src/services/timeline/historyRuntimeRehydration', () => ({ syncHistoryRehydratedTimelineRuntimeResources: fixture.sync }));
vi.mock('../../src/services/layerBuilder', () => ({ layerBuilder: { invalidateCache: vi.fn() } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { clearCaches: fixture.clear, requestNewFrameRender: fixture.render } }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ info: vi.fn() }) } }));
vi.mock('../../src/services/mediaArtifacts/mediaSourceArtifacts', () => ({ scheduleMediaSourceArtifactProjectionForClips: fixture.project }));

import { navigateEditorComposition } from '../../src/services/project/repository/transaction/editorCompositionNavigation';

beforeEach(() => {
  vi.clearAllMocks(); fixture.session = {}; fixture.workspace = {};
  fixture.publication = { generation: 4, revisionId: 'revision', blocked: false };
  fixture.media = { activeCompositionId: 'a', compositions: [{ id: 'a' }, { id: 'b', timelineData: { tracks: [{ id: 'target' }] } }],
    files: [{ id: 'media', file: {} }], folders: [], openCompositionIds: ['a', 'b'] };
  fixture.timeline = { playheadPosition: 12, zoom: 30, scrollX: 200, timelineSessionId: 1, clips: [{ id: 'old' }],
    tracks: [{ id: 'old-track' }], clipAnimationPhase: 'idle', isDraggingPlayhead: false,
    compositionSwitchSourceTracks: null, compositionSwitchTargetTracks: null };
  fixture.clock.isUsingInternalPosition = false;
  fixture.stage.mockResolvedValue({ state: { timelineSessionId: 2, clips: [{ id: 'new' }], tracks: [{ id: 'target' }] },
    activate: fixture.activate, abandon: fixture.abandon });
});

describe('repository composition tab navigation', () => {
  it('stages only the target timeline, retains connected media, and restores independent tab views', async () => {
    const files = fixture.media.files, compositions = fixture.media.compositions;
    fixture.workspace = { 'timeline/b/playheadPosition': 90, 'timeline/b/zoom': 5, 'timeline/b/scrollX': 300 };
    fixture.clock.isUsingInternalPosition = true;
    await navigateEditorComposition('b');
    expect(fixture.media.files).toBe(files); expect(fixture.media.compositions).toBe(compositions);
    expect(fixture.stage.mock.calls[0][2]).toBe(compositions[1]);
    expect(fixture.queue).toHaveBeenCalledWith('timeline/a/playheadPosition', 42);
    expect(fixture.timeline).toMatchObject({ playheadPosition: 90, zoom: 5, scrollX: 300, timelineSessionId: 2, clipAnimationPhase: 'idle' });
    expect(fixture.media.activeCompositionId).toBe('b');
    expect(fixture.publication).toMatchObject({ generation: 4, revisionId: 'revision', blocked: false });
    expect(fixture.activate).toHaveBeenCalledOnce();
  });
  it('keeps the old content usable after failed staging', async () => {
    const clips = fixture.timeline.clips;
    fixture.stage.mockRejectedValueOnce(new Error('restore failed'));
    await expect(navigateEditorComposition('b')).rejects.toThrow('restore failed');
    expect(fixture.media.activeCompositionId).toBe('a'); expect(fixture.timeline.clips).toBe(clips);
    expect(fixture.publication.blocked).toBe(false); expect(fixture.render).toHaveBeenCalled();
  });
  it('does not overwrite a replacement project when staging completes late', async () => {
    fixture.stage.mockImplementationOnce(async () => { fixture.session = {}; fixture.media = { activeCompositionId: 'replacement' };
      return { state: {}, activate: fixture.activate, abandon: fixture.abandon }; });
    await expect(navigateEditorComposition('b')).rejects.toThrow('Project session changed');
    expect(fixture.media.activeCompositionId).toBe('replacement'); expect(fixture.abandon).toHaveBeenCalledOnce();
    expect(fixture.activate).not.toHaveBeenCalled();
  });
  it('rolls back both stores and releases staged bindings when activation fails after swapping', async () => {
    const oldTimeline = fixture.timeline, oldMedia = fixture.media;
    fixture.activate.mockImplementationOnce(() => { throw new Error('activation failed'); });
    await expect(navigateEditorComposition('b')).rejects.toThrow('activation failed');
    expect(fixture.media).toEqual(oldMedia); expect(fixture.timeline).toEqual(oldTimeline);
    expect(fixture.abandon).toHaveBeenCalledOnce(); expect(fixture.publication.blocked).toBe(false);
    expect(fixture.queue).not.toHaveBeenCalledWith('media/activeCompositionId', 'b');
  });
  it('rejects navigation during activation and skips already active tabs', async () => {
    await navigateEditorComposition('a'); expect(fixture.stage).not.toHaveBeenCalled();
    fixture.publication.blocked = true;
    await expect(navigateEditorComposition('b')).rejects.toThrow('Cannot switch');
    expect(fixture.stage).not.toHaveBeenCalled();
  });
});
