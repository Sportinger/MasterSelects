import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ session: {} as object | null, live: new Set<object>(),
  explicit: null as object | null, reader: (() => null) as () => object | null,
  begin: vi.fn(), commit: vi.fn(), cancel: vi.fn(),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => runtime.session,
  getEditorTransactionToken: () => runtime.explicit ?? runtime.reader(),
  beginEditorTransaction: () => { const token = {}; runtime.live.add(token); runtime.begin(token); return token; },
  ownsEditorTransaction: (token: object) => runtime.live.has(token),
  commitEditorTransaction: (token: object) => { runtime.commit(token); runtime.live.delete(token); },
  cancelEditorTransaction: (token: object) => { runtime.cancel(token); runtime.live.delete(token); },
  runEditorTransaction: (token: object, action: () => unknown) => {
    if (!runtime.live.has(token)) throw new Error('Lost owner');
    const previous = runtime.explicit; runtime.explicit = token;
    try { return action(); } finally { runtime.explicit = previous; }
  },
}));
import { bindEditorGestureCallback, getEditorGestureToken, installEditorGestureEvents, hasOpenEditorGestures }
  from '../../src/services/project/repository/transaction/editorGestureOwnership';

let frames: Map<number, FrameRequestCallback>, nextFrame: number, target: HTMLDivElement;
async function flushFrame() {
  const queued = [...frames.values()]; frames.clear();
  for (const callback of queued) callback(performance.now());
  await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers(); runtime.session = {}; runtime.live.clear(); runtime.explicit = null; runtime.reader = getEditorGestureToken;
  runtime.begin.mockClear(); runtime.commit.mockClear(); runtime.cancel.mockClear(); frames = new Map(); nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  target = document.createElement('div'); document.body.append(target); installEditorGestureEvents();
});
afterEach(() => {
  window.dispatchEvent(new Event('blur')); target.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
describe('editor input gesture lifetime', () => {
  it('finishes one wheel burst after a bounded idle interval without requiring focus', async () => {
    const edit = vi.fn();
    target.addEventListener('wheel', () => requestAnimationFrame(bindEditorGestureCallback(edit)));
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); await Promise.resolve(); await flushFrame();
    await vi.advanceTimersByTimeAsync(100);
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); await Promise.resolve(); await flushFrame();
    expect(runtime.begin).toHaveBeenCalledTimes(1); expect(runtime.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); await flushFrame();
    expect(edit).toHaveBeenCalledTimes(2); expect(runtime.commit).toHaveBeenCalledTimes(1); expect(hasOpenEditorGestures()).toBe(false);
  });
  it('drains the authored final frame before pointer release commits its owner', async () => {
    const edit = vi.fn(() => expect(runtime.commit).not.toHaveBeenCalled());
    target.addEventListener('mousedown', () => requestAnimationFrame(bindEditorGestureCallback(edit)));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await Promise.resolve();
    expect(runtime.commit).not.toHaveBeenCalled(); await flushFrame();
    expect(edit).toHaveBeenCalledOnce(); expect(runtime.commit).toHaveBeenCalledOnce(); expect(hasOpenEditorGestures()).toBe(false);
  });
  it('ends a keyboard gesture on keyup and cancels an unfinished owner on window blur', async () => {
    target.addEventListener('keydown', () => bindEditorGestureCallback(() => {})());
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' })); await Promise.resolve(); await flushFrame();
    expect(runtime.commit).toHaveBeenCalledOnce();
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    await Promise.resolve(); expect(runtime.begin).toHaveBeenCalledTimes(2); expect(hasOpenEditorGestures()).toBe(true);
    window.dispatchEvent(new Event('blur')); expect(runtime.cancel).toHaveBeenCalledOnce(); expect(hasOpenEditorGestures()).toBe(false);
  });
  it('does not apply an old scheduled edit after the project session changes', async () => {
    const edit = vi.fn(); target.addEventListener('mousedown', () => requestAnimationFrame(bindEditorGestureCallback(edit)));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); runtime.session = {};
    await flushFrame(); expect(edit).not.toHaveBeenCalled();
  });
});
