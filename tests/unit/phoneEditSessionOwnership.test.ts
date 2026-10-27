import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone edit session against the real gesture ownership and history facade; only the repository
// transaction runtime is simulated (tokens, commit, cancel, the ambient running token).
const runtime = vi.hoisted(() => ({ session: {} as object | null, live: new Set<object>(), explicit: null as object | null,
  reader: (() => null) as () => object | null, begin: vi.fn(), commit: vi.fn(), cancel: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => runtime.session,
  getEditorTransactionToken: () => runtime.explicit ?? runtime.reader(),
  beginEditorTransaction: (label: string) => { const token = { label }; runtime.live.add(token); runtime.begin(label); return token; },
  ownsEditorTransaction: (token: object) => runtime.live.has(token),
  commitEditorTransaction: (token: object) => { runtime.commit(token); runtime.live.delete(token); },
  cancelEditorTransaction: (token: object) => { runtime.cancel(token); runtime.live.delete(token); },
  runEditorTransaction: (token: object, action: () => unknown) => {
    if (!runtime.live.has(token)) throw new Error('Lost owner');
    const previous = runtime.explicit; runtime.explicit = token;
    try { return action(); } finally { runtime.explicit = previous; }
  },
  captureEditorTransactionAcrossAwaits: async (_token: object, action: () => Promise<unknown>) => action(),
  runEditorBatch: async (_label: string, action: () => Promise<unknown>) => action(),
}));

import { createPhoneEditSession } from '../../src/components/mobileSkin/sheets/phoneEditSession';
import { getEditorGestureToken, hasOpenEditorGestures, installEditorGestureEvents } from '../../src/services/project/repository/transaction/editorGestureOwnership';
import { endBatch, startBatch } from '../../src/stores/historyStore';

let target: HTMLButtonElement;
let dispatching = false;
/** jsdom ends a dispatch before microtasks run; a browser keeps a native event in dispatch across them. */
class HeldPointerEvent extends MouseEvent { override get eventPhase() { return dispatching ? Event.BUBBLING_PHASE : Event.NONE; } }
const settle = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };

beforeEach(() => {
  runtime.session = {}; runtime.live.clear(); runtime.explicit = null; runtime.reader = getEditorGestureToken;
  runtime.begin.mockClear(); runtime.commit.mockClear(); runtime.cancel.mockClear();
  target = document.createElement('button'); document.body.append(target); installEditorGestureEvents();
});
afterEach(() => { dispatching = false; target.remove(); });

describe('phone edit session owns one transaction until Done', () => {
  it('a nested startBatch/endBatch (applying a Look) during the tap does not end the session: Done is one undo step', async () => {
    const session = createPhoneEditSession('Filter', { onError: vi.fn() });
    // The tap that picks a filter is still being dispatched when the session's change runs.
    dispatching = true;
    target.dispatchEvent(new HeldPointerEvent('mousedown', { bubbles: true }));
    const applied = session.apply(() => { startBatch('Apply look'); try { /* addClipEffect … */ } finally { endBatch(); } });
    await applied;
    dispatching = false; await settle();
    expect(runtime.commit, 'the Look batch must not commit the open sheet session').not.toHaveBeenCalled();
    // The Strength drag lands in the same session.
    await session.apply(() => {});
    const result = await session.commit(() => {});
    expect(result).toEqual({ ok: true });
    expect(runtime.begin).toHaveBeenCalledTimes(1);
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(hasOpenEditorGestures()).toBe(false);
  });

  it('a window blur (file picker, app switch) keeps the open session and its changes', async () => {
    const onError = vi.fn();
    const session = createPhoneEditSession('Audio', { onError });
    await session.apply(() => {});
    window.dispatchEvent(new Event('blur'));
    expect(runtime.cancel, 'blur must not roll back the session').not.toHaveBeenCalled();
    await session.apply(() => {});
    expect(await session.commit()).toEqual({ ok: true });
    expect(runtime.begin).toHaveBeenCalledTimes(1);
    expect(runtime.commit).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('a lost transaction is reported instead of a silent Done', async () => {
    const onError = vi.fn();
    const session = createPhoneEditSession('Edits', { onError });
    await session.apply(() => {});
    runtime.live.clear(); // e.g. the project was switched under the open sheet
    const result = await session.commit();
    expect(result.ok).toBe(false);
    await session.apply(() => {}); // closed: no further work
    const reopened = createPhoneEditSession('Edits', { onError });
    await reopened.apply(() => {});
    runtime.live.clear();
    await reopened.apply(() => {});
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/discarded/u));
  });

  it('a live change that throws is shown to the user', async () => {
    const onError = vi.fn();
    const session = createPhoneEditSession('Effects', { onError });
    await session.apply(() => { throw new Error('track is locked'); });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('track is locked'));
    session.cancel();
  });
});
