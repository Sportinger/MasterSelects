import { beginEditorTransaction, cancelEditorTransaction, commitEditorTransaction, getEditorRepositorySession,
  getEditorTransactionToken, ownsEditorTransaction, runEditorTransaction, subscribeEditorRepositorySession } from './editorMutationRuntime';
import { collectMediaFileObjectUrls } from '../../mediaObjectUrlManager';
import type { MediaFile } from '../../../../stores/mediaStore/types';

const ownership = import.meta.hot?.data?.editorAsyncOwnership ?? { epoch: 0 };
let unsubscribe: (() => void) | null = null;
function ensureOwnershipSubscription(): void {
  unsubscribe ??= subscribeEditorRepositorySession(() => { ownership.epoch++; });
}
export interface EditorAsyncMutation {
  isCurrent(): boolean;
  assertCurrent(): void;
  run<T>(action: () => T): T;
  invoke<T>(action: () => T): T;
}
/** Capture once, before the first await. Only synchronous mutation phases enter the token. */
export function captureEditorAsyncMutation(label: string, targetIsCurrent: () => boolean = () => true,
  options: { joinTransaction?: boolean } = {}): EditorAsyncMutation {
  ensureOwnershipSubscription();
  const session = getEditorRepositorySession(), epoch = ownership.epoch;
  const token = options.joinTransaction === false ? null : getEditorTransactionToken();
  let depth = 0;
  const isCurrent = () => getEditorRepositorySession() === session && ownership.epoch === epoch &&
    (!token || ownsEditorTransaction(token)) && targetIsCurrent();
  const assertCurrent = () => { if (!isCurrent()) throw new DOMException(`${label} belongs to an obsolete project or source`, 'AbortError'); };
  return { isCurrent, assertCurrent, invoke(action) { assertCurrent(); return token ? runEditorTransaction(token, action) : action(); }, run(action) {
    assertCurrent();
    if (depth) return action();
    depth++;
    try {
      if (token) return runEditorTransaction(token, action);
      if (!session) return action();
      const local = beginEditorTransaction(label, 'import');
      try { const value = runEditorTransaction(local, action); commitEditorTransaction(local); return value; }
      catch (error) { if (ownsEditorTransaction(local)) cancelEditorTransaction(local); throw error; }
    } finally { depth--; }
  } };
}
export function bindEditorAsyncStore<T extends object>(set: (patch: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T, binding: EditorAsyncMutation): { set: typeof set; get: typeof get } {
  let last = get();
  return { set(patch) { if (binding.isCurrent()) binding.run(() => set(patch)); }, get() {
    if (binding.isCurrent()) last = get();
    return new Proxy(last, { get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? (...args: unknown[]) => binding.invoke(() => value.apply(target, args)) : value;
    } });
  } };
}
/** Revoke only new URLs from a rejected result; source Files and existing URLs remain untouched. */
export function discardUnpublishedMedia(file: MediaFile, baseline?: MediaFile): void {
  const retained = baseline ? collectMediaFileObjectUrls(baseline) : new Set<string>();
  for (const url of collectMediaFileObjectUrls(file)) if (!retained.has(url)) URL.revokeObjectURL(url);
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { unsubscribe?.(); data.editorAsyncOwnership = ownership; }); import.meta.hot.accept();
}
