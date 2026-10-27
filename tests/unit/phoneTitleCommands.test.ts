import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })),
  endBatch: vi.fn(),
  cancelHistoryBatch: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/stores/historyStore')>()),
  ...history,
}));

import {
  choosePhoneTitleTrack,
  createPhoneTitleSession,
  getSelectedPhoneTextClip,
} from '../../src/components/mobileSkin/text/usePhoneTitleCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const originalState = useTimelineStore.getState();
const tracks = [
  createMockTrack({ id: 'video-2', type: 'video' }),
  createMockTrack({ id: 'video-1', type: 'video' }),
  createMockTrack({ id: 'audio-1', type: 'audio' }),
];

function textClip(id: string, trackId: string, text: string): TimelineClip {
  return createMockClip({
    id, trackId, startTime: 0, duration: 5,
    source: { type: 'text' },
    textProperties: { text } as TimelineClip['textProperties'],
  });
}

describe('choosePhoneTitleTrack', () => {
  it('picks the nearest free unlocked track above the main picture', () => {
    const many = [createMockTrack({ id: 'v3' }), createMockTrack({ id: 'v2' }), createMockTrack({ id: 'v1' })];
    expect(choosePhoneTitleTrack(many, [], 1, 5)).toEqual({ trackId: 'v2' });
    expect(choosePhoneTitleTrack(many, [{ trackId: 'v2', startTime: 0, duration: 3 }], 1, 5)).toEqual({ trackId: 'v3' });
    expect(choosePhoneTitleTrack(many, [{ trackId: 'v2', startTime: 6, duration: 3 }], 1, 5)).toEqual({ trackId: 'v2' });
  });

  it('asks for a new track when only the main track exists or the others are locked or busy', () => {
    expect(choosePhoneTitleTrack([createMockTrack({ id: 'v1' })], [], 0, 5)).toEqual({ createTrack: true });
    expect(choosePhoneTitleTrack([createMockTrack({ id: 'v2', locked: true }), createMockTrack({ id: 'v1' })], [], 0, 5))
      .toEqual({ createTrack: true });
  });
});

describe('phone title session', () => {
  let created = 0;
  const addTextClip = vi.fn(async (trackId: string, startTime: number, duration?: number) => {
    created += 1;
    const id = `text-${created}`;
    useTimelineStore.setState((state) => ({
      clips: [...state.clips, { ...textClip(id, trackId, 'Text'), startTime, duration: duration ?? 5 }],
    }));
    return id;
  });
  const updateTextProperties = vi.fn((clipId: string, props: { text?: string }) => {
    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => (clip.id === clipId ? { ...clip, textProperties: { ...clip.textProperties!, ...props } } : clip)),
    }));
  });
  const addTrack = vi.fn(() => 'video-new');

  beforeEach(() => {
    created = 0;
    vi.clearAllMocks();
    useTimelineStore.setState({
      tracks,
      clips: [createMockClip({ id: 'main', trackId: 'video-1', startTime: 0, duration: 10 })],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 3,
      isPlaying: false,
      addTextClip,
      updateTextProperties,
      addTrack,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({
      addTextClip: originalState.addTextClip,
      updateTextProperties: originalState.updateTextProperties,
      addTrack: originalState.addTrack,
      clips: [],
      selectedClipIds: new Set(),
    });
  });

  it('previews while typing and commits a new title at the playhead as one batch', async () => {
    const session = createPhoneTitleSession();
    expect(session.mode).toBe('create');

    await session.preview('');
    expect(addTextClip).not.toHaveBeenCalled();
    await session.preview('Op');
    await session.preview('Opening');
    const result = await session.commit('Opening night');

    expect(result).toEqual({ ok: true });
    expect(addTextClip).toHaveBeenCalledTimes(1);
    expect(addTextClip).toHaveBeenCalledWith('video-2', 3, 5, true);
    expect(updateTextProperties).toHaveBeenLastCalledWith('text-1', { text: 'Opening night' });
    expect(history.startBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelHistoryBatch).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().primarySelectedClipId).toBe('text-1');
  });

  it('creates the title on commit when nothing was previewed', async () => {
    const result = await createPhoneTitleSession().commit('Hello');

    expect(result).toEqual({ ok: true });
    expect(addTextClip).toHaveBeenCalledTimes(1);
    expect(history.startBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it('creates a video track through the store when no free track is above the main picture', async () => {
    useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video-1', type: 'video' })] });
    addTrack.mockImplementationOnce(() => {
      useTimelineStore.setState((state) => ({ tracks: [createMockTrack({ id: 'video-new', type: 'video' }), ...state.tracks] }));
      return 'video-new';
    });

    await createPhoneTitleSession().commit('Hello');

    expect(addTrack).toHaveBeenCalledWith('video');
    expect(addTextClip).toHaveBeenCalledWith('video-new', 3, 5, true);
  });

  it('cancel rolls the live preview back without committing', async () => {
    const session = createPhoneTitleSession();
    await session.preview('Draft');
    session.cancel();
    await session.preview('ignored');

    expect(history.cancelHistoryBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
    expect(updateTextProperties).toHaveBeenCalledTimes(1);
    expect(session.closed).toBe(true);
  });

  it('cancel before typing leaves nothing open and keeps the session usable', async () => {
    const session = createPhoneTitleSession();
    session.cancel();

    expect(session.closed).toBe(false);
    expect(history.startBatch).not.toHaveBeenCalled();
    expect(await session.commit('Later')).toEqual({ ok: true });
  });

  it('edits the selected text clip instead of creating one', async () => {
    useTimelineStore.setState((state) => ({
      clips: [...state.clips, textClip('title', 'video-2', 'Old')],
      selectedClipIds: new Set(['title']),
      primarySelectedClipId: 'title',
    }));
    expect(getSelectedPhoneTextClip()?.id).toBe('title');

    const session = createPhoneTitleSession();
    expect(session.mode).toBe('edit');
    expect(session.originalText).toBe('Old');
    expect(await session.commit('New')).toEqual({ ok: true });

    expect(addTextClip).not.toHaveBeenCalled();
    expect(updateTextProperties).toHaveBeenCalledWith('title', { text: 'New' });
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty title and reports a failed create', async () => {
    expect(await createPhoneTitleSession().commit('   ')).toEqual({ ok: false, message: 'Type a title first.' });

    addTextClip.mockImplementationOnce(async () => null);
    const result = await createPhoneTitleSession().commit('Hi');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/No video track is available/);
    expect(history.cancelHistoryBatch).toHaveBeenCalledTimes(1);
  });
});
