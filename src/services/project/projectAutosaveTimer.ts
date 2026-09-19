/** A timer, never an edit debounce. Busy imports/gestures postpone an already due save. */
export function startProjectAutosaveTimer(options: {
  intervalMs: number;
  isBusy: () => boolean;
  save: () => Promise<void>;
}): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => { timer = setTimeout(() => { void tick(); }, delay); };
  const tick = async () => {
    if (disposed) return;
    if (options.isBusy()) { schedule(5000); return; }
    try { await options.save(); }
    finally { if (!disposed) schedule(options.intervalMs); }
  };
  schedule(options.intervalMs);
  return () => { disposed = true; clearTimeout(timer); };
}
