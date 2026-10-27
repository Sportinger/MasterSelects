// F2 phone sheet session defects: a rescued recording survives the sheet's Cancel, the transform
// gizmo settles a drag whose handles vanished, Adjust names node-driven controls it left alone,
// Remove silence never finishes into a closed session, a failed cache reset lifts the autosave
// pause, and closing a project refreshes the phone's project state at once.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rescuePhoneRecording } from '../../src/components/mobileSkin/audio/phoneRecordingRescue';
import { createPhoneAudioFxCommands } from '../../src/components/mobileSkin/audiofx/phoneAudioFxCommands';
import { phoneAdjustDrivenSkips, phoneAdjustProperty, setPhoneAdjustValues } from '../../src/components/mobileSkin/effects/phoneAdjustControls';
import { usePhoneGizmoAbandonGuard } from '../../src/components/mobileSkin/preview/usePhoneGizmoAbandonGuard';
import { notifyPhoneProjectStateChanged, subscribePhoneProjectStateChanges } from '../../src/components/mobileSkin/runtime/phoneProjectStateEvents';
import { createPhoneEditSession } from '../../src/components/mobileSkin/sheets/phoneEditSession';
import { clearAllCacheAndReloadConfirmed } from '../../src/components/common/toolbar/cacheActions';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function seedAudio() {
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
    clips: [createMockClip({ id: 'tone', trackId: 'audio-1', startTime: 0, duration: 4, file: new File([], 'tone.wav', { type: 'audio/wav' }), effects: [] })],
    clipKeyframes: new Map(),
    selectedClipIds: new Set(),
    isExporting: false,
  });
}

afterEach(() => {
  useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map() });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function initLegacyHistory() {
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: {
      getState: () => ({
        files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [],
        mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [],
      }),
      setState: () => undefined,
    },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  } as never);
  useHistoryStore.setState({ batchId: null, batchLabel: null });
  getHistoryStateView().clearHistory();
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('rescuing a kept recording from the Audio sheet', () => {
  beforeEach(() => { seedAudio(); initLegacyHistory(); });

  const rescuedClip = () => createMockClip({ id: 'rescued', trackId: 'audio-1', startTime: 1, duration: 1.2, effects: [] });
  const addRescuedClip = vi.fn(async () => {
    useTimelineStore.setState({ clips: [...useTimelineStore.getState().clips, rescuedClip()] });
    return { clips: [{}] };
  });

  it('is its own committed step: a later sheet change and Cancel keep the rescued take', async () => {
    const session = createPhoneEditSession('Add audio');
    const outcome = await rescuePhoneRecording(session, 'take-1', { commit: addRescuedClip });
    expect(outcome).toEqual({ kind: 'rescued', clips: 1 });
    expect(session.changed, 'the rescue did not run inside the cancellable session').toBe(false);

    await session.apply(() => { useTimelineStore.getState().updateClip('tone', { name: 'Edited in the sheet' }); });
    session.cancel();
    await drain();
    const clips = useTimelineStore.getState().clips;
    expect(clips.map((clip) => clip.id), 'Cancel rolled back the sheet edit but not the rescue').toContain('rescued');
    expect(clips.find((clip) => clip.id === 'tone')?.name).not.toBe('Edited in the sheet');
  });

  it('control: the same take added inside the session (the old path) is lost on Cancel', async () => {
    const session = createPhoneEditSession('Add audio');
    await session.apply(async () => { await addRescuedClip(); });
    session.cancel();
    await drain();
    expect(useTimelineStore.getState().clips.map((clip) => clip.id)).not.toContain('rescued');
  });

  it('refuses while the sheet holds uncommitted changes instead of risking the take', async () => {
    const commit = vi.fn(async () => ({ clips: [{}] }));
    const outcome = await rescuePhoneRecording({ changed: true, closed: false }, 'take-1', { commit });
    expect(outcome.kind).toBe('needs-done');
    expect(commit).not.toHaveBeenCalled();
  });

  it('runs inside one editor batch with a repository and reports failures and repeats', async () => {
    const runBatch = vi.fn(async <T,>(_label: string, action: () => Promise<T>) => action());
    const repeat = await rescuePhoneRecording({ changed: false, closed: false }, 'take-1', {
      repository: () => true, runBatch, commit: async () => ({ clips: [] }),
    });
    expect(runBatch).toHaveBeenCalledWith('Rescue recording', expect.any(Function));
    expect(repeat.kind).toBe('already-added');
    const failed = await rescuePhoneRecording({ changed: false, closed: false }, 'take-1', {
      commit: async () => { throw new Error('assets missing'); },
    });
    expect(failed).toEqual({ kind: 'failed', message: 'assets missing' });
  });
});

describe('transform gizmo abandon guard', () => {
  it('settles an open gesture when the handles lose the clip and on unmount, never without a gesture', () => {
    const settle = vi.fn();
    const gestureRef: { current: { clipId: string } | null } = { current: null };
    const { rerender, unmount } = renderHook(({ clipId }) => usePhoneGizmoAbandonGuard(clipId, gestureRef, settle), {
      initialProps: { clipId: 'a' as string | null },
    });
    gestureRef.current = { clipId: 'a' };
    rerender({ clipId: 'a' });
    expect(settle).not.toHaveBeenCalled();
    rerender({ clipId: null });
    expect(settle).toHaveBeenCalledWith('clip-left');
    settle.mockClear();
    gestureRef.current = { clipId: 'a' };
    unmount();
    expect(settle).toHaveBeenCalledWith('unmount');
  });
});

describe('Adjust and node-driven controls', () => {
  it('leaves node-driven controls alone and returns them instead of skipping silently', () => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'v1', type: 'video' })],
      clips: [createMockClip({ id: 'a', trackId: 'v1', effects: [] }), createMockClip({ id: 'b', trackId: 'v1', effects: [] })],
      clipKeyframes: new Map(),
    });
    useTimelineStore.getState().ensureColorCorrection('a');
    useTimelineStore.getState().ensureColorCorrection('b');
    const b = useTimelineStore.getState().clips.find((clip) => clip.id === 'b')!;
    const property = phoneAdjustProperty(b, 'saturation')!;
    useTimelineStore.setState({
      clips: useTimelineStore.getState().clips.map((clip) => (clip.id === 'b'
        ? { ...clip, nodeGraph: { parameterSources: { targets: { [property]: { source: { nodeId: 'n', port: 'out' } } } } } } as unknown as TimelineClip
        : clip)),
    });
    expect(phoneAdjustDrivenSkips(['a', 'b'], ['saturation', 'contrast'])).toEqual([{ clipId: 'b', key: 'saturation' }]);
    expect(setPhoneAdjustValues(['a', 'b'], { saturation: 1.5 })).toEqual([{ clipId: 'b', key: 'saturation' }]);
  });
});

describe('Remove silence and the sheet session', () => {
  beforeEach(() => seedAudio());

  function controlledDetection() {
    let resolve!: (ranges: Array<{ start: number; end: number; duration: number }>) => void;
    const detection = new Promise<Array<{ start: number; end: number; duration: number }>>((done) => { resolve = done; });
    const remove = vi.fn(async () => ['op-1']);
    useTimelineStore.setState({
      detectClipSilenceRanges: vi.fn(() => detection),
      applyDetectedSilenceRemoval: remove,
    } as never);
    return { resolve, remove };
  }

  it('Done waits for a running detection, so the requested cut lands in the committed step', async () => {
    const { resolve, remove } = controlledDetection();
    const commands = createPhoneAudioFxCommands('tone');
    const running = commands.removeSilence({ thresholdDb: -50, minSilenceSeconds: 0.3, ripple: false });
    const committed = commands.commit();
    resolve([{ start: 1, end: 2, duration: 1 }]);
    expect(await running).toMatchObject({ kind: 'removed', count: 1 });
    expect((await committed).ok).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a session closed during detection says so instead of blaming a locked track', async () => {
    const { resolve, remove } = controlledDetection();
    const commands = createPhoneAudioFxCommands('tone');
    const running = commands.removeSilence({ thresholdDb: -50, minSilenceSeconds: 0.3, ripple: false });
    commands.cancel();
    resolve([{ start: 1, end: 2, duration: 1 }]);
    const outcome = await running;
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind === 'failed' && outcome.message).toContain('closed before the silence was removed');
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('cache reset', () => {
  it('a failed step lifts the autosave pause again and throws, after running the other steps', async () => {
    const deleteDatabase = vi.fn();
    const unregister = vi.fn(async () => true);
    vi.stubGlobal('indexedDB', { deleteDatabase });
    vi.stubGlobal('caches', { keys: vi.fn(async () => { throw new DOMException('blocked', 'SecurityError'); }), delete: vi.fn() });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistrations: async () => [{ unregister }] } });
    const timeout = vi.spyOn(window, 'setTimeout');
    const reloads = () => timeout.mock.calls.filter((call) => call[1] === 100);
    await expect(clearAllCacheAndReloadConfirmed()).rejects.toThrow(/did not finish.*caches/);
    expect((window as Window & { __CLEARING_CACHE__?: boolean }).__CLEARING_CACHE__).toBe(false);
    expect(deleteDatabase).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
    expect(reloads(), 'no reload was scheduled').toHaveLength(0);
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});

describe('phone project state notices', () => {
  it('reach every subscriber at once and stop after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePhoneProjectStateChanges(listener);
    act(() => notifyPhoneProjectStateChanged());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifyPhoneProjectStateChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
