import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { installCanvas2DMock } from '../helpers/mockCanvas2d';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { captureTextNumberGesture, editTextNumber, editTextSelection, getTextEditTargets } from '../../src/components/panels/properties/textSelectionEditing';
import { startBatch, endBatch } from '../../src/stores/historyStore';

vi.mock('../../src/stores/historyStore', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/stores/historyStore')>(),
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })), endBatch: vi.fn(),
}));
const text = (id: string, size: number, startTime = 0) => createMockClip({ id, trackId: 'video-1', startTime, duration: 10,
  source: { type: 'text', textCanvas: document.createElement('canvas') },
  textProperties: { ...DEFAULT_TEXT_PROPERTIES, text: id, fontSize: size } });
const makeStore = () => createTestTimelineStore({ clips: [text('a', 40), text('b', 60), text('c', 80)],
  selectedClipIds: new Set(['a', 'b', 'c']), primarySelectedClipId: 'a' });
beforeEach(() => { installCanvas2DMock(); vi.clearAllMocks(); vi.mocked(startBatch).mockReturnValue({ opened: true, batchId: 1 }); });

describe('text inspector selection editing', () => {
  it('adds the same delta, including successive input events, and groups the selection for undo', () => {
    const store = makeStore();
    editTextNumber(store.getState(), 'a', true, 'fontSize', 50, true);
    expect(store.getState().clips.map(clip => clip.textProperties?.fontSize)).toEqual([50, 70, 90]);
    editTextNumber(store.getState(), 'a', true, 'fontSize', 55, true);
    expect(store.getState().clips.map(clip => clip.textProperties?.fontSize)).toEqual([55, 75, 95]);
    expect(store.getState().clips.map(clip => clip.textProperties?.text)).toEqual(['a', 'b', 'c']);
    expect(startBatch).toHaveBeenCalledTimes(2);
    expect(endBatch).toHaveBeenCalledTimes(2);
  });
  it('keeps drag baselines through limits and does not end an existing gesture batch', () => {
    const store = makeStore();
    store.getState().updateTextProperties('b', { fontSize: 499 });
    const gesture = captureTextNumberGesture(store.getState(), 'a', true, 'fontSize', true);
    vi.mocked(startBatch).mockReturnValue({ opened: false, batchId: 10 });
    editTextNumber(store.getState(), 'a', true, 'fontSize', 50, true, gesture);
    expect(store.getState().clips[1].textProperties?.fontSize).toBe(500);
    editTextNumber(store.getState(), 'a', true, 'fontSize', 40, true, gesture);
    expect(store.getState().clips[1].textProperties?.fontSize).toBe(499);
    expect(endBatch).not.toHaveBeenCalled();
  });
  it('samples keyframed clips at their own local playhead times and preserves base values', () => {
    const a = text('a', 40), b = text('b', 60, 2);
    const keys = (id: string, from: number, to: number) => [
      createMockKeyframe({ clipId: id, property: 'text.fontSize', time: 0, value: from }),
      createMockKeyframe({ clipId: id, property: 'text.fontSize', time: 4, value: to }),
    ];
    const store = createTestTimelineStore({ clips: [a, b], selectedClipIds: new Set(['a', 'b']), playheadPosition: 3,
      clipKeyframes: new Map([['a', keys('a', 40, 80)], ['b', keys('b', 60, 100)]]) });
    editTextNumber(store.getState(), 'a', true, 'fontSize', 80, true);
    expect(store.getState().clipKeyframes.get('a')).toContainEqual(expect.objectContaining({ time: 3, value: 80 }));
    expect(store.getState().clipKeyframes.get('b')).toContainEqual(expect.objectContaining({ time: 1, value: 80 }));
    expect(store.getState().clips.map(clip => clip.textProperties?.fontSize)).toEqual([40, 60]);
  });
  it('excludes other media, unselected and locked clips; blocks export and a locked primary', () => {
    const store = makeStore();
    store.setState({ clips: [...store.getState().clips, { ...text('locked', 90), trackId: 'locked-track' }, createMockClip({ id: 'video' })],
      selectedClipIds: new Set(['a', 'b', 'locked', 'video']),
      tracks: [createMockTrack({ id: 'video-1' }), createMockTrack({ id: 'locked-track', locked: true })] });
    expect(getTextEditTargets(store.getState(), 'a', true).map(clip => clip.id)).toEqual(['a', 'b']);
    editTextNumber(store.getState(), 'a', true, 'fontSize', 50, true);
    expect(store.getState().clips.slice(0, 4).map(clip => clip.textProperties?.fontSize)).toEqual([50, 70, 80, 90]);
    expect(getTextEditTargets(store.getState(), 'locked', true)).toEqual([]);
    store.setState({ isExporting: true });
    expect(getTextEditTargets(store.getState(), 'a', true)).toEqual([]);
  });
  it('keeps explicit single-clip inspectors and unselected pinned inspectors independent', () => {
    const store = makeStore();
    editTextNumber(store.getState(), 'a', false, 'fontSize', 50, true);
    store.setState({ selectedClipIds: new Set(['b', 'c']) });
    editTextNumber(store.getState(), 'a', true, 'fontSize', 55, true);
    expect(store.getState().clips.map(clip => clip.textProperties?.fontSize)).toEqual([55, 60, 80]);
    expect(startBatch).not.toHaveBeenCalled();
  });
  it('applies nonnumeric choices absolutely without replacing other text settings', () => {
    const store = makeStore();
    editTextSelection(store.getState(), 'a', true, clip => store.getState().updateTextProperties(clip.id,
      { color: '#ff0000', fontStyle: 'italic', textAlign: 'right', strokeEnabled: true }));
    for (const clip of store.getState().clips) expect(clip.textProperties).toMatchObject({
      text: clip.id, color: '#ff0000', fontStyle: 'italic', textAlign: 'right', strokeEnabled: true });
  });
});
