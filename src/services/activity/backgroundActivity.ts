/**
 * Counts background work that keeps the editor busy after a project opens (decoders starting,
 * thumbnails being built), so the toolbar can say that something is still loading instead of
 * leaving the user in front of a black preview without a hint.
 */
export type BackgroundActivityKind = 'decoders' | 'thumbnails';

export type BackgroundActivitySnapshot = Readonly<Record<BackgroundActivityKind, number>>;

const IDLE: BackgroundActivitySnapshot = Object.freeze({ decoders: 0, thumbnails: 0 });
let snapshot: BackgroundActivitySnapshot = IDLE;
const listeners = new Set<() => void>();

function change(kind: BackgroundActivityKind, delta: number): void {
  const next = { ...snapshot, [kind]: Math.max(0, snapshot[kind] + delta) };
  snapshot = next.decoders === 0 && next.thumbnails === 0 ? IDLE : Object.freeze(next);
  for (const listener of listeners) listener();
}

/** Marks one running job; call the returned function once when it ends (extra calls are ignored). */
export function beginBackgroundActivity(kind: BackgroundActivityKind): () => void {
  change(kind, 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    change(kind, -1);
  };
}

export function getBackgroundActivity(): BackgroundActivitySnapshot { return snapshot; }
export function subscribeBackgroundActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
