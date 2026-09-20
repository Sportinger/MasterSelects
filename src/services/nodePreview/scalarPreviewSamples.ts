type Sample = [number, number, number, number];
type State = { samples: Map<string, Sample>; listeners: Set<() => void> };
const state: State = import.meta.hot?.data?.scalarSamples ?? { samples: new Map(), listeners: new Set() };
if (import.meta.hot) import.meta.hot.dispose(data => { data.scalarSamples = state; });

/** Last GPU sample, separate from the arithmetic values. Editing an operand can
 * reevaluate the whole field immediately while its source sample refreshes. */
export const scalarPreviewSamples = {
  key: (clipId: string, stage: string, uv: number[], columns: number, native: boolean) => JSON.stringify([clipId, stage, uv, columns, native]),
  read: (key: string) => state.samples.get(key),
  publish(key: string, sample: Sample | undefined) {
    if (!sample) return;
    const before = state.samples.get(key);
    if (before?.every((value, index) => value === sample[index])) return;
    state.samples.delete(key); state.samples.set(key, sample);
    while (state.samples.size > 64) state.samples.delete(state.samples.keys().next().value!);
    state.listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
  cancelClip(clipId: string) { for (const key of state.samples.keys()) if (JSON.parse(key)[0] === clipId) state.samples.delete(key); },
};
