import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionToken } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { TimelineClip } from '../../src/types/timeline';

// A phone sheet imports a sound inside its own edit session; the waveform finishes after Done
// committed that session. The late runtime result must still land (in its own import transaction),
// otherwise the clip keeps `waveformGenerating` forever and every audio analysis of it is skipped.
const mock = vi.hoisted(() => {
  const state = { session: null as { id: string } | null, token: null as TransactionToken | null,
    listeners: new Set<() => void>(), owned: new Set<symbol>() };
  const calls = { begin: vi.fn(), commit: vi.fn(), run: vi.fn() };
  return { state, calls };
});
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => mock.state.session,
  getEditorTransactionToken: () => mock.state.token,
  subscribeEditorRepositorySession: (listener: () => void) => { mock.state.listeners.add(listener); return () => mock.state.listeners.delete(listener); },
  ownsEditorTransaction: (token: TransactionToken) => mock.state.owned.has(token.owner) && token.sessionEpoch === mock.state.session?.id,
  beginEditorTransaction: (label: string) => {
    mock.calls.begin(label); const token = { transactionId: 'local', owner: Symbol(label), sessionEpoch: mock.state.session!.id };
    mock.state.owned.add(token.owner); return token;
  },
  runEditorTransaction: <T>(token: TransactionToken, action: () => T): T => { mock.calls.run(token); return action(); },
  commitEditorTransaction: (token: TransactionToken) => { mock.calls.commit(token); mock.state.owned.delete(token.owner); },
  cancelEditorTransaction: (token: TransactionToken) => { mock.state.owned.delete(token.owner); },
}));
import { createClipRuntimeUpdateActions } from '../../src/stores/timeline/clip/clipRuntimeUpdateActions';

function world(clips: Partial<TimelineClip>[]) {
  let state = { timelineSessionId: 't1', clips: clips as TimelineClip[], selectedClipIds: new Set<string>() };
  const get = () => ({ ...state, updateDuration: vi.fn() });
  const set = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; };
  return { context: { get, set } as never, read: () => state, replace: (next: Partial<TimelineClip>[]) => { state = { ...state, clips: next as TimelineClip[] }; } };
}

describe('late runtime clip updates after the importing transaction ended', () => {
  beforeEach(() => {
    mock.state.session = { id: 'project' };
    for (const listener of mock.state.listeners) listener();
    mock.state.owned.clear();
    for (const call of Object.values(mock.calls)) call.mockClear();
    // The phone sheet's edit session is open while the clip is added.
    const token = { owner: Symbol('sheet'), transactionId: 'sheet', sessionEpoch: 'project' };
    mock.state.token = token;
    mock.state.owned.add(token.owner);
  });

  it('applies the finished waveform in its own import transaction once the sheet committed', () => {
    const w = world([{ id: 'tone', waveformGenerating: true }]);
    const { updateClip } = createClipRuntimeUpdateActions(w.context);
    updateClip('tone', { waveformProgress: 20 });
    expect(mock.calls.begin).not.toHaveBeenCalled();
    // Done: the sheet's transaction ends; the waveform finishes afterwards.
    mock.state.owned.clear();
    mock.state.token = null;
    updateClip('tone', { waveformGenerating: false, waveformProgress: 100 });
    expect(w.read().clips[0]).toMatchObject({ waveformGenerating: false, waveformProgress: 100 });
    expect(mock.calls.begin).toHaveBeenCalledWith('Complete clip import');
    expect(mock.calls.commit).toHaveBeenCalledTimes(1);
  });

  it('drops the late result when Cancel removed the clip', () => {
    const w = world([{ id: 'tone', waveformGenerating: true }]);
    const { updateClip } = createClipRuntimeUpdateActions(w.context);
    mock.state.owned.clear();
    w.replace([]);
    updateClip('tone', { waveformGenerating: false });
    expect(w.read().clips).toEqual([]);
    expect(mock.calls.begin).not.toHaveBeenCalled();
  });

  it('drops the late result when another project opened meanwhile', () => {
    const w = world([{ id: 'tone', waveformGenerating: true }]);
    const { updateClip } = createClipRuntimeUpdateActions(w.context);
    mock.state.owned.clear();
    mock.state.session = { id: 'other' };
    for (const listener of mock.state.listeners) listener();
    updateClip('tone', { waveformGenerating: false });
    expect(w.read().clips[0].waveformGenerating).toBe(true);
  });
});
