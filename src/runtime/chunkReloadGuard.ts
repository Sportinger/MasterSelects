// Keep the boot recovery graph independent from editor stores and lazy chunks.
const BEFORE_CHUNK_RELOAD = 'masterselects:before-chunk-reload';

export function canReloadAfterChunkFailure(): boolean {
  return window.dispatchEvent(new Event(BEFORE_CHUNK_RELOAD, { cancelable: true }));
}

export function preserveUnsavedProjectOnChunkFailure(hasUnsavedProject: () => boolean): () => void {
  const guard = (event: Event) => {
    if (hasUnsavedProject()) event.preventDefault();
  };
  window.addEventListener(BEFORE_CHUNK_RELOAD, guard);
  return () => window.removeEventListener(BEFORE_CHUNK_RELOAD, guard);
}
