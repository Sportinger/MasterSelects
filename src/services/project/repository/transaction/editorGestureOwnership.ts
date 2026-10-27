import type { TransactionToken } from './ProjectTransactionCoordinator';
import { beginEditorTransaction, commitEditorTransaction, cancelEditorTransaction, getEditorRepositorySession,
  ownsEditorTransaction, runEditorTransaction, getEditorTransactionToken } from './editorMutationRuntime';
interface Gesture { id: number; token: TransactionToken; label: string; owner: string; automatic: boolean; }
const completions = new Map<number, ReturnType<typeof setTimeout>>();
const frames = new Map<number, number>();
const eventListeners = new Map<string, EventListener>();
const bubbleListeners = new Map<string, EventListener>();
const gestures = new Map<string, Gesture>();
const elementIds = new WeakMap<object, number>();
let nextElement = 1, nextGesture = 1, currentInputOwner: string | null = null, installed = false, boundOwnerDepth = 0;
function ownerOf(event: Event): string {
  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) return `pointer:${event.pointerId}`;
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent && ['mousedown', 'mousemove', 'mouseup'].includes(event.type)) return 'pointer:mouse';
  const target = event.target ?? event;
  if (!elementIds.has(target)) elementIds.set(target, nextElement++);
  return `control:${elementIds.get(target)}`;
}
/**
 * Dispatch-scoped owner identity. An owner lives while its event is being dispatched: a browser runs
 * microtasks between the listeners of one native event (after this capture listener, before React's
 * root listener), so the owner must outlast them and end only when the dispatch is over (eventPhase
 * NONE). That is checked after the window bubble phase, on every read and at the next task, because a
 * listener may stop propagation before the event reaches window again.
 */
interface InputDispatch { event: Event; owner: string; type: string; }
const dispatches: InputDispatch[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;
function settleDispatch(dispatch: InputDispatch): void {
  const gesture = gestures.get(dispatch.owner);
  if (!gesture?.automatic) return;
  if (dispatch.type === 'pointercancel') finishEditorGesture(gesture.id, true);
  else if (['pointerup', 'mouseup', 'focusout', 'keyup', 'change'].includes(dispatch.type)) completeAfterFrame(gesture.id);
  else if (!dispatch.owner.startsWith('pointer:')) scheduleAutomaticCompletion(gesture.id);
}
function syncInputOwner(): void { currentInputOwner = dispatches.at(-1)?.owner ?? null; }
/** Settles every dispatch that is over. */
function settleFinishedDispatches(): void {
  let changed = false;
  for (let index = dispatches.length - 1; index >= 0; index -= 1) {
    const dispatch = dispatches[index];
    if (dispatch.event.eventPhase !== Event.NONE) continue;
    dispatches.splice(index, 1); changed = true; settleDispatch(dispatch);
  }
  if (changed && boundOwnerDepth === 0) syncInputOwner();
}
function armSettleTimer(): void {
  settleTimer ??= setTimeout(() => { settleTimer = null; settleFinishedDispatches(); if (dispatches.length !== 0) armSettleTimer(); }, 0);
}
function inputOwner(): string | null {
  if (dispatches.length !== 0 && boundOwnerDepth === 0) settleFinishedDispatches();
  return currentInputOwner;
}
export function installEditorGestureEvents(): void {
  if (installed || typeof window === 'undefined') return; installed = true;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'input', 'change', 'keydown', 'keyup', 'focusin', 'focusout', 'click', 'wheel', 'blur']) {
    const listener: EventListener = event => {
      if (type === 'blur' && !(event.target instanceof Element)) {
        // A lost window ends input gestures (their pointer/key release may never arrive). Explicit owners
        // hold their token and finish it themselves: a phone sheet's session must survive a file picker
        // or an app switch instead of silently losing the user's edits.
        for (const gesture of [...gestures.values()]) if (!gesture.owner.startsWith('explicit:')) finishEditorGesture(gesture.id, true);
        dispatches.length = 0; currentInputOwner = null; return;
      }
      settleFinishedDispatches();
      const owner = ownerOf(event); dispatches.push({ event, owner, type }); currentInputOwner = owner;
      armSettleTimer();
    };
    // Synthetic dispatches end before this microtask; native ones still run their later listeners.
    const bubbleListener: EventListener = event => queueMicrotask(() => { if (event.eventPhase === Event.NONE) settleFinishedDispatches(); });
    eventListeners.set(type, listener); window.addEventListener(type, listener, { capture: true });
    bubbleListeners.set(type, bubbleListener); window.addEventListener(type, bubbleListener);
  }
}
export function ensureEditorInputGesture(label: string): void {
  const owner = inputOwner();
  if (owner && getEditorRepositorySession() && !getEditorTransactionToken()) {
    beginEditorGesture(label); const gesture = gestures.get(owner); if (gesture) { gesture.automatic = true; if (!gesture.owner.startsWith('pointer:')) scheduleAutomaticCompletion(gesture.id); }
  }
}
export function getCurrentEditorGestureId(): number | null { const owner = inputOwner(); return owner ? gestures.get(owner)?.id ?? null : null; }
/** Capture at scheduling time; delayed callbacks re-enter the original explicit owner only. */
export function bindEditorGestureCallback(action: () => void): () => void;
export function bindEditorGestureCallback(action: (time: number) => void): (time: number) => void;
export function bindEditorGestureCallback<T extends unknown[]>(action: (...args: T) => void): (...args: T) => void;
export function bindEditorGestureCallback<T extends unknown[]>(action: (...args: T) => void): (...args: T) => void {
  ensureEditorInputGesture('Edit gesture');
  const token = getEditorTransactionToken(), boundOwner = inputOwner(), session = getEditorRepositorySession();
  return (...args) => {
    if (session !== getEditorRepositorySession() || (token && !ownsEditorTransaction(token))) return;
    const previousOwner = currentInputOwner; currentInputOwner = boundOwner; boundOwnerDepth += 1;
    try { if (token) runEditorTransaction(token, () => action(...args)); else action(...args); }
    finally { boundOwnerDepth -= 1; currentInputOwner = previousOwner; }
  };
}
export function getEditorGestureToken(): TransactionToken | null {
  const owner = inputOwner(), gesture = owner ? gestures.get(owner) : undefined;
  return gesture && ownsEditorTransaction(gesture.token) ? gesture.token : null;
}
/**
 * `explicit: true` always opens a programmatic owner, even during an input dispatch. Such a gesture is never
 * found through the current input (getCurrentEditorGestureId / getEditorGestureToken), so an inner
 * startBatch/endBatch pair or an automatic input gesture cannot finish it; its holder runs with the token
 * (runEditorGesture) and finishes it itself.
 */
export function beginEditorGesture(label: string, options: { explicit?: boolean } = {}): { opened: boolean; batchId: number | null; token?: TransactionToken } {
  installEditorGestureEvents();
  // Programmatic callers receive a token and must explicitly run with it.
  const owner = (options.explicit ? null : inputOwner()) ?? `explicit:${nextGesture}`;
  const existing = gestures.get(owner);
  if (existing) return { opened: false, batchId: existing.id, token: existing.token };
  const gesture = { id: nextGesture++, token: beginEditorTransaction(label, 'gesture'), label, owner, automatic: false };
  gestures.set(owner, gesture); return { opened: true, batchId: gesture.id, token: gesture.token };
}
export function runEditorGesture<T>(id: number, action: () => T): T {
  const gesture = [...gestures.values()].find(value => value.id === id);
  if (!gesture) throw new Error('Editor gesture ownership was lost');
  return runEditorTransaction(gesture.token, action);
}
export function finishEditorGesture(id: number, cancel = false): void {
  const gesture = [...gestures.values()].find(value => value.id === id);
  if (!gesture) return;
  const timer = completions.get(id); if (timer) clearTimeout(timer); completions.delete(id);
  const frame = frames.get(id); if (frame !== undefined) cancelAnimationFrame(frame); frames.delete(id);
  if (!ownsEditorTransaction(gesture.token)) { gestures.delete(gesture.owner); return; }
  try { if (cancel) cancelEditorTransaction(gesture.token); else commitEditorTransaction(gesture.token); }
  catch (error) { if (ownsEditorTransaction(gesture.token)) cancelEditorTransaction(gesture.token); throw error; }
  finally { gestures.delete(gesture.owner); }
}
export function hasOpenEditorGestures(): boolean { return gestures.size !== 0; }

function scheduleAutomaticCompletion(id: number): void {
  const queuedFrame = frames.get(id); if (queuedFrame !== undefined) { cancelAnimationFrame(queuedFrame); frames.delete(id); }
  const previous = completions.get(id); if (previous) clearTimeout(previous);
  completions.set(id, setTimeout(() => { completions.delete(id); completeAfterFrame(id); }, 200));
}
/** Existing authored animation callbacks drain before their gesture is committed. */
function completeAfterFrame(id: number): void {
  if (frames.has(id)) return;
  if (typeof document !== 'undefined' && document.hidden) { finishEditorGesture(id); return; }
  const frame = requestAnimationFrame(() => {
    frames.delete(id); queueMicrotask(() => finishEditorGesture(id));
  });
  frames.set(id, frame);
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const gesture of [...gestures.values()]) finishEditorGesture(gesture.id, true);
    if (typeof window !== 'undefined') for (const [type, listener] of eventListeners) window.removeEventListener(type, listener, { capture: true });
    if (typeof window !== 'undefined') for (const [type, listener] of bubbleListeners) window.removeEventListener(type, listener);
    if (settleTimer) clearTimeout(settleTimer);
    eventListeners.clear(); bubbleListeners.clear(); dispatches.length = 0; settleTimer = null; installed = false; currentInputOwner = null;
  });
  import.meta.hot.accept();
}
