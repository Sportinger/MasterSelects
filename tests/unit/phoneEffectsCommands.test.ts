import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })),
  endBatch: vi.fn(),
  cancelHistoryBatch: vi.fn(),
  captureSnapshot: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/stores/historyStore')>()),
  ...history,
}));

import { STARTER_LOOKS } from '../../src/effects/looks/starterLooks';
import { setPhoneAdjustValues } from '../../src/components/mobileSkin/effects/phoneAdjustControls';
import { readPhoneVisualSelection } from '../../src/components/mobileSkin/effects/phoneEffectTargets';
import { applyPhoneFilter, detectPhoneFilter, removePhoneFilter, setPhoneFilterStrength } from '../../src/components/mobileSkin/effects/phoneLookFilters';
import { createPhoneEffectsCommands } from '../../src/components/mobileSkin/effects/usePhoneEffectsCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const tracks = [createMockTrack({ id: 'video-2', type: 'video' }), createMockTrack({ id: 'video-1', type: 'video' })];
const clipEffects = (id: string) => useTimelineStore.getState().clips.find((clip) => clip.id === id)?.effects ?? [];

describe('phone effects commands on the editor store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimelineStore.setState({
      tracks,
      clips: [
        createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 4, effects: [] }),
        createMockClip({ id: 'b', trackId: 'video-1', startTime: 4, duration: 4, effects: [] }),
      ],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(['a', 'b']),
      primarySelectedClipId: 'a',
      playheadPosition: 1,
      isPlaying: false,
    });
  });

  afterEach(() => {
    useTimelineStore.setState({ clips: [], selectedClipIds: new Set(), primarySelectedClipId: null });
  });

  it('adds an effect to every selected clip and edits the primary one inside one batch', async () => {
    const commands = createPhoneEffectsCommands(readPhoneVisualSelection());
    const id = await commands.add('brightness');
    expect(id).toBeTruthy();
    expect(clipEffects('a').map((effect) => effect.type)).toEqual(['brightness']);
    expect(clipEffects('b').map((effect) => effect.type)).toEqual(['brightness']);
    await commands.setParam(id!, 'amount', 0.4);
    expect(clipEffects('a')[0].params.amount).toBeCloseTo(0.4, 6);
    expect(clipEffects('b')[0].params.amount).not.toBeCloseTo(0.4, 6);
    await commands.setEnabled(id!, false);
    expect(clipEffects('a')[0].enabled).toBe(false);
    expect(history.startBatch).toHaveBeenCalledTimes(1);
    expect(await commands.commit()).toEqual({ ok: true });
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelHistoryBatch).not.toHaveBeenCalled();
  });

  it('reorders and removes on the primary clip, and Cancel rolls the batch back', async () => {
    const commands = createPhoneEffectsCommands(readPhoneVisualSelection());
    const first = await commands.add('brightness');
    const second = await commands.add('invert');
    await commands.move(second!, -1);
    expect(clipEffects('a').map((effect) => effect.id)).toEqual([second, first]);
    await commands.remove(first!);
    expect(clipEffects('a').map((effect) => effect.id)).toEqual([second]);
    commands.cancel();
    await commands.session.apply(() => undefined);
    expect(history.cancelHistoryBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it('adds an adjustment layer at the playhead when nothing is selected and selects it on Done', async () => {
    useTimelineStore.setState({ selectedClipIds: new Set(), primarySelectedClipId: null });
    const commands = createPhoneEffectsCommands(readPhoneVisualSelection());
    expect(commands.targetClipId()).toBeNull();
    const id = await commands.add('invert');
    const layerId = commands.targetClipId();
    const layer = useTimelineStore.getState().clips.find((clip) => clip.id === layerId);
    expect(id).toBeTruthy();
    expect(layer).toMatchObject({ trackId: 'video-2', startTime: 1, duration: 5, source: { type: 'motion-adjustment' } });
    expect(layer?.effects.map((effect) => effect.type)).toEqual(['invert']);
    expect(clipEffects('a')).toEqual([]);
    await commands.add('brightness');
    expect(useTimelineStore.getState().clips.filter((clip) => clip.source?.type === 'motion-adjustment')).toHaveLength(1);
    await commands.commit();
    expect(useTimelineStore.getState().selectedClipIds).toEqual(new Set([layerId]));
  });
});

describe('phone filters and adjust on the editor store', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks,
      clips: [createMockClip({ id: 'a', trackId: 'video-1', startTime: 0, duration: 4, effects: [] })],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(['a']),
      primarySelectedClipId: 'a',
      playheadPosition: 1,
    });
  });

  it('applies a Look as its effect stack, scales its strength and removes it again', () => {
    const noir = STARTER_LOOKS.find((look) => look.id === 'digital-noir')!;
    const { filter } = applyPhoneFilter(noir, 'a');
    expect(clipEffects('a').map((effect) => effect.type)).toEqual(['dither-studio', 'vignette']);
    expect(filter.effects.map((effect) => effect.full)).toEqual([0.82, 0.48]);
    setPhoneFilterStrength(filter, 0.5);
    expect(clipEffects('a').map((effect) => effect.params.amount)).toEqual([0.41, 0.24]);
    setPhoneFilterStrength(filter, 1);
    expect(clipEffects('a').map((effect) => effect.params.amount)).toEqual([0.82, 0.48]);
    removePhoneFilter(filter);
    expect(clipEffects('a')).toEqual([]);
  });

  it('finds every built-in Look again after applying it, at full and at a lower strength', () => {
    for (const look of STARTER_LOOKS) {
      const { filter } = applyPhoneFilter(look, 'a');
      expect(detectPhoneFilter('a', clipEffects('a'), STARTER_LOOKS)?.filter.lookId, look.id).toBe(look.id);
      if (filter.effects.some((effect) => effect.control && Math.abs(effect.full - effect.control.neutral) > 1e-9)) {
        setPhoneFilterStrength(filter, 0.3);
        const found = detectPhoneFilter('a', clipEffects('a'), STARTER_LOOKS);
        expect(found?.filter.lookId, `${look.id} at 30 %`).toBe(look.id);
        expect(found?.strength, `${look.id} strength`).toBeCloseTo(0.3, 4);
      }
      removePhoneFilter(filter);
      expect(clipEffects('a'), look.id).toEqual([]);
    }
  });

  it('creates the default colour grade and sets values through the grade property', () => {
    setPhoneAdjustValues(['a'], { offset: 0.2, exposure: 1 });
    const grade = useTimelineStore.getState().clips[0].colorCorrection!;
    const node = grade.versions[0].nodes.find((candidate) => candidate.type === 'primary')!;
    expect(node.params.offset).toBeCloseTo(0.2, 6);
    expect(node.params.exposure).toBe(1);
    expect(node.params.contrast).toBe(1);
  });
});
