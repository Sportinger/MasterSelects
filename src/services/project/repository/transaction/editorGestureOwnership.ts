import type { TransactionToken } from './ProjectTransactionCoordinator';
import { beginEditorTransaction, commitEditorTransaction, cancelEditorTransaction, getEditorRepositorySession,
  ownsEditorTransaction, runEditorTransaction, getEditorTransactionToken } from './editorMutationRuntime';
interface Gesture { id: number; token: TransactionToken; label: string; owner: string; automatic: boolean; }
const completions = new Map<number, ReturnType<typeof setTimeout>>();
const frames = new Map<number, number>();
const eventListeners = new Map<string, EventListener>();
const gestures = new Map<string, Gesture>();
const elementIds = new WeakMap<object, number>();
let nextElement = 1, nextGesture = 1, currentInputOwner: string | null = null, installed = false;
function ownerOf(event: Event): string {
  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) return `pointer:${event.pointerId}`;
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent && ['mousedown', 'mousemove', 'mouseup'].includes(event.type)) return 'pointer:mouse';
  const target = event.target ?? event;
  if (!elementIds.has(target)) elementIds.set(target, nextElement++);
  return `control:${elementIds.get(target)}`;
}
/** Dispatch-scoped owner identity, cleared before unrelated callbacks can run. */
export function installEditorGestureEvents(): void {
  if (installed || typeof window === 'undefined') return; installed = true;
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'input', 'change', 'keydown', 'keyup', 'focusin', 'focusout', 'click', 'wheel', 'blur']) {
    const listener: EventListener = event => {
      if (type === 'blur' && !(event.target instanceof Element)) {
        for (const gesture of [...gestures.values()]) finishEditorGesture(gesture.id, true);
        currentInputOwner = null; return;
      }
      const owner = ownerOf(event); currentInputOwner = owner;
      queueMicrotask(() => {
        const gesture = gestures.get(owner);
        if (gesture?.automatic) {
          if (type === 'pointercancel') finishEditorGesture(gesture.id, true);
          else if (['pointerup', 'mouseup', 'focusout', 'keyup', 'change'].includes(type)) completeAfterFrame(gesture.id);
          else if (!owner.startsWith('pointer:')) scheduleAutomaticCompletion(gesture.id);
        }
        if (currentInputOwner === owner) currentInputOwner = null;
      });
    };
    eventListeners.set(type, listener); window.addEventListener(type, listener, { capture: true });
  }
}
export function ensureEditorInputGesture(label: string): void {
  if (currentInputOwner && getEditorRepositorySession() && !getEditorTransactionToken()) {
    beginEditorGesture(label); const gesture = gestures.get(currentInputOwner); if (gesture) { gesture.automatic = true; if (!gesture.owner.startsWith('pointer:')) scheduleAutomaticCompletion(gesture.id); }
  }
}
export function getCurrentEditorGestureId(): number | null { return currentInputOwner ? gestures.get(currentInputOwner)?.id ?? null : null; }
/** Capture at scheduling time; delayed callbacks re-enter the original explicit owner only. */
export function bindEditorGestureCallback(action: () => void): () => void;
export function bindEditorGestureCallback(action: (time: number) => void): (time: number) => void;
export function bindEditorGestureCallback<T extends unknown[]>(action: (...args: T) => void): (...args: T) => void;
export function bindEditorGestureCallback<T extends unknown[]>(action: (...args: T) => void): (...args: T) => void {
  ensureEditorInputGesture('Edit gesture');
  const token = getEditorTransactionToken(), inputOwner = currentInputOwner, session = getEditorRepositorySession();
  return (...args) => {
    if (session !== getEditorRepositorySession() || (token && !ownsEditorTransaction(token))) return;
    const previousOwner = currentInputOwner; currentInputOwner = inputOwner;
    try { if (token) runEditorTransaction(token, () => action(...args)); else action(...args); }
    finally { currentInputOwner = previousOwner; }
  };
}
export function getEditorGestureToken(): TransactionToken | null {
  const gesture = currentInputOwner ? gestures.get(currentInputOwner) : undefined;
  return gesture && ownsEditorTransaction(gesture.token) ? gesture.token : null;
}
export function beginEditorGesture(label: string): { opened: boolean; batchId: number | null; token?: TransactionToken } {
  installEditorGestureEvents();
  // Programmatic callers receive a token and must explicitly run with it.
  const owner = currentInputOwner ?? `explicit:${nextGesture}`;
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
    eventListeners.clear(); installed = false; currentInputOwner = null;
  });
  import.meta.hot.accept();
}
