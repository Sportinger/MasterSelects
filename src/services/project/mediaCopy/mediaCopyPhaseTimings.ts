// Sub-phases of one media copy into the project (hash, write, manifest, publish, open the copy), reported
// to whoever watches that exact File: the import timing report (window.__MS_MEDIA_IMPORT__) shows them as
// copy_hash, copy_write, ... so a slow phone import says which step of the copy waited. The File object
// itself is the key (it travels unchanged from the import into project storage), so parallel imports of
// different files never mix their phases. Watching is optional; unwatched copies cost one WeakMap lookup.

type PhaseSink = (phase: string, ms: number) => void;

const sinks = new WeakMap<Blob, PhaseSink>();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Reports every timed copy phase of `blob` to `sink` until the returned function is called. */
export function watchMediaCopyPhases(blob: Blob, sink: PhaseSink): () => void {
  sinks.set(blob, sink);
  return () => { if (sinks.get(blob) === sink) sinks.delete(blob); };
}

/** Times `work` as `phase` of the copy of `blob` (any other value: untimed); returns its result. */
export async function timeMediaCopyPhase<T>(blob: unknown, phase: string, work: Promise<T>): Promise<T> {
  const sink = blob instanceof Blob ? sinks.get(blob) : undefined;
  if (!sink) return work;
  const started = now();
  try { return await work; } finally { sink(phase, now() - started); }
}
