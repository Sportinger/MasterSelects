import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computePinchView, PINCH_DEADBAND, type PinchLimits, type PinchStart } from '../../src/components/pianoRoll/usePianoRollTouch';

const historyMocks = vi.hoisted(() => ({
  startBatch: vi.fn(() => ({ opened: true, batchId: 7 })),
  endBatch: vi.fn(),
  cancelHistoryBatch: vi.fn(),
  finishEditorGesture: vi.fn(),
  runEditorGesture: vi.fn((_id: number, action: () => unknown) => action()),
  session: { current: {} as object | null },
}));
vi.mock('../../src/stores/historyStore', () => ({
  startBatch: historyMocks.startBatch, endBatch: historyMocks.endBatch, cancelHistoryBatch: historyMocks.cancelHistoryBatch,
}));
vi.mock('../../src/services/project/repository/transaction/editorGestureOwnership', () => ({
  finishEditorGesture: historyMocks.finishEditorGesture, runEditorGesture: historyMocks.runEditorGesture,
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => historyMocks.session.current,
}));

const { beginPianoRollDragHistory } = await import('../../src/components/pianoRoll/pianoRollDragHistory');

const LIMITS: PinchLimits = { minPxPerSec: 12, maxPxPerSec: 1200, minRowH: 5, maxRowH: 48, keyboardWidth: 48 };
const START: PinchStart = { midX: 300, midY: 100, dx: 100, dy: 0, pxPerSec: 120, rowH: 16, scrollLeft: 200, scrollTop: 800 };

describe('piano roll pinch view (phone touch)', () => {
  it('a horizontal spread zooms time only and keeps the second under the fingers', () => {
    const view = computePinchView(START, { midX: 300, midY: 100, dx: 200, dy: 0 }, LIMITS);
    expect(view.pxPerSec).toBe(240);
    expect(view.rowH).toBe(16);
    const before = (START.midX + START.scrollLeft - LIMITS.keyboardWidth) / START.pxPerSec;
    const after = (300 + view.scrollLeft - LIMITS.keyboardWidth) / view.pxPerSec;
    expect(after).toBeCloseTo(before, 9);
    expect(view.scrollTop).toBe(START.scrollTop);
  });

  it('a vertical spread zooms pitch only, anchored on the row under the fingers', () => {
    const start = { ...START, dx: 0, dy: 60 };
    const view = computePinchView(start, { midX: 300, midY: 100, dx: 0, dy: 120 }, LIMITS);
    expect(view.pxPerSec).toBe(120);
    expect(view.rowH).toBe(32);
    expect((100 + view.scrollTop) / view.rowH).toBeCloseTo((100 + START.scrollTop) / START.rowH, 9);
  });

  it('a two-finger drag with a wobbling distance pans without zooming', () => {
    const wobble = 1 + PINCH_DEADBAND / 2;
    const view = computePinchView(START, { midX: 240, midY: 50, dx: 100 * wobble, dy: 3 }, LIMITS);
    expect(view.pxPerSec).toBe(120);
    expect(view.rowH).toBe(16);
    expect(view.scrollLeft).toBe(START.scrollLeft + 60);
    expect(view.scrollTop).toBe(START.scrollTop + 50);
  });

  it('zoom stays inside the limits and scroll never goes negative', () => {
    const view = computePinchView(START, { midX: 900, midY: 900, dx: 100000, dy: 0 }, LIMITS);
    expect(view.pxPerSec).toBe(1200);
    const out = computePinchView(START, { midX: 2000, midY: 2000, dx: 1, dy: 0 }, LIMITS);
    expect(out.pxPerSec).toBe(12);
    expect(out.scrollLeft).toBe(0);
    expect(out.scrollTop).toBe(0);
  });
});

describe('piano roll drag history (one undo step per drag)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyMocks.session.current = {};
  });

  it('runs every change of a drag inside one editor gesture and commits it once', () => {
    const history = beginPianoRollDragHistory('Edit MIDI notes');
    const changes: number[] = [];
    history.run(() => changes.push(1));
    history.run(() => changes.push(2));
    history.commit();
    history.commit();
    expect(changes).toEqual([1, 2]);
    expect(historyMocks.runEditorGesture).toHaveBeenCalledTimes(2);
    expect(historyMocks.runEditorGesture.mock.calls.every(([id]) => id === 7)).toBe(true);
    expect(historyMocks.finishEditorGesture).toHaveBeenCalledTimes(1);
    expect(historyMocks.finishEditorGesture).toHaveBeenCalledWith(7, false);
    expect(historyMocks.endBatch).toHaveBeenCalledTimes(1);
    expect(historyMocks.cancelHistoryBatch).not.toHaveBeenCalled();
  });

  it('a cancelled drag (pinch interrupting it) cancels the gesture instead of committing', () => {
    const history = beginPianoRollDragHistory('Edit MIDI notes');
    history.run(() => undefined);
    history.cancel();
    expect(historyMocks.finishEditorGesture).toHaveBeenCalledWith(7, true);
    expect(historyMocks.cancelHistoryBatch).toHaveBeenCalledTimes(1);
    expect(historyMocks.endBatch).not.toHaveBeenCalled();
  });

  it('without a project repository the legacy batch alone groups the drag', () => {
    historyMocks.session.current = null;
    const history = beginPianoRollDragHistory('Edit MIDI notes');
    let ran = false;
    history.run(() => { ran = true; });
    history.commit();
    expect(ran).toBe(true);
    expect(historyMocks.runEditorGesture).not.toHaveBeenCalled();
    expect(historyMocks.finishEditorGesture).not.toHaveBeenCalled();
    expect(historyMocks.endBatch).toHaveBeenCalledTimes(1);
  });
});
