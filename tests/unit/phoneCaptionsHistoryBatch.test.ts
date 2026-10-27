import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The phone Captions sheet runs the desktop word cut (deleteCaptionTimelineRange, which calls
// startBatch/endBatch) inside its own explicit editor gesture. A batch started inside a running
// editor transaction must join it; before the fix it opened a second gesture whose transaction was
// never committed, and Undo stayed blocked ("Cut word" left open).
const runtime = vi.hoisted(() => ({
  session: {} as object | null,
  live: new Set<object>(),
  running: null as object | null,
  begin: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => runtime.session,
  getEditorTransactionToken: () => runtime.running,
  beginEditorTransaction: () => { const token = {}; runtime.live.add(token); runtime.begin(token); return token; },
  ownsEditorTransaction: (token: object) => runtime.live.has(token),
  commitEditorTransaction: (token: object) => { runtime.commit(token); runtime.live.delete(token); },
  cancelEditorTransaction: (token: object) => { runtime.live.delete(token); },
  runEditorTransaction: (token: object, action: () => unknown) => {
    const previous = runtime.running; runtime.running = token;
    try { return action(); } finally { runtime.running = previous; }
  },
}));

type History = typeof import('../../src/stores/historyStore');
type Gestures = typeof import('../../src/services/project/repository/transaction/editorGestureOwnership');
let startBatch: History['startBatch'];
let endBatch: History['endBatch'];
let beginEditorGesture: Gestures['beginEditorGesture'];
let finishEditorGesture: Gestures['finishEditorGesture'];
let hasOpenEditorGestures: Gestures['hasOpenEditorGestures'];
let runEditorGesture: Gestures['runEditorGesture'];

beforeAll(async () => {
  // The global test setup may already hold the real modules; load fresh ones against the mock.
  vi.resetModules();
  ({ startBatch, endBatch } = await import('../../src/stores/historyStore'));
  ({ beginEditorGesture, finishEditorGesture, hasOpenEditorGestures, runEditorGesture } = await import('../../src/services/project/repository/transaction/editorGestureOwnership'));
}, 120_000);

beforeEach(() => {
  runtime.session = {}; runtime.live.clear(); runtime.running = null; runtime.begin.mockClear(); runtime.commit.mockClear();
});
afterEach(() => { runtime.session = null; });

describe('history batches inside a running editor transaction', () => {
  it('join the running transaction instead of opening a second gesture', () => {
    const outer = beginEditorGesture('Captions');
    expect(outer.opened).toBe(true);
    let nested: ReturnType<typeof startBatch> | null = null;
    runEditorGesture(outer.batchId!, () => {
      nested = startBatch('Cut word');
      if (nested.opened) endBatch();
    });
    expect(nested).toEqual({ opened: false, batchId: null });
    expect(runtime.begin).toHaveBeenCalledOnce();
    finishEditorGesture(outer.batchId!);
    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(hasOpenEditorGestures()).toBe(false);
    expect(runtime.live.size, 'no transaction is left open').toBe(0);
  });

  it('still open their own gesture when no transaction runs', () => {
    const batch = startBatch('Standalone');
    expect(batch.opened).toBe(true);
    endBatch();
    expect(runtime.begin).toHaveBeenCalledOnce();
    expect(runtime.commit).toHaveBeenCalledOnce();
    expect(runtime.live.size).toBe(0);
  });
});
