/** Logical video slices are tiled into array pages to avoid treating the device's
 * array-layer limit as a temporal sample limit. Every tile keeps source resolution. */
export function residentTemporalLayout(width: number, height: number, wanted: number, desired: number,
  budget: number, fixedBytes: number, maxDimension: number, maxLayers: number) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= maxDimension)) {
    throw new Error('GPU history: source dimensions exceed the device texture limit.');
  }
  const frameBytes = width * height * 4;
  const capacityLimit = Math.floor((budget - fixedBytes) / frameBytes);
  const capacity = Math.min(Math.max(1, desired), capacityLimit);
  if (capacity < Math.max(1, wanted)) {
    const requiredMiB = Math.ceil((Math.max(1, wanted) * frameBytes + fixedBytes) / 1024 / 1024);
    throw new ResidentTemporalCapacityError(`GPU history needs at least ${requiredMiB} MiB for ${wanted} distinct source frames.`);
  }
  const maxColumns = Math.floor(maxDimension / width), maxRows = Math.floor(maxDimension / height);
  // Find a layout that stays within the budget, including partly filled pages.
  let best: { columns: number; rows: number; layers: number; capacity: number; bytes: number } | undefined;
  for (let columns = 1; columns <= Math.min(maxColumns, Math.ceil(capacity / maxLayers) + 1); columns++) {
    const rows = Math.max(1, Math.ceil(capacity / (columns * maxLayers)));
    if (rows > maxRows) continue;
    const page = columns * rows;
    const layers = Math.min(maxLayers, Math.floor(capacityLimit / page), Math.ceil(capacity / page));
    const slots = Math.min(capacity, layers * page);
    if (slots < Math.max(1, wanted)) continue;
    const candidate = { columns, rows, layers, capacity: slots, bytes: layers * page * frameBytes + fixedBytes };
    if (!best || slots > best.capacity || (slots === best.capacity && candidate.bytes < best.bytes)) best = candidate;
  }
  if (!best) throw new ResidentTemporalCapacityError('GPU history exceeds the texture layout or memory limit.');
  return best;
}

export class ResidentTemporalCapacityError extends Error {}

/** Row 0: grid age, lower/upper slot, PTS blend. Row 1: graph-delay offsets from
 * each grid age to its lower/upper decoded PTS; the last column holds the tile grid. */
export function residentTemporalMetadata(metadata: Float32Array, times: readonly number[], slots: ReadonlyMap<number, number>,
  columns: number, rows: number, offsets: readonly (readonly number[])[] = []) {
  const width = metadata.length / 4;
  const result = new Float32Array(metadata.length * 2); result.set(metadata);
  for (let i = 0; i < width - 1; i++) for (const offset of [1, 2]) {
    const group = metadata[i * 4 + offset];
    const slot = group === 0 ? -1 : slots.get(times[group - 1]);
    if (slot === undefined) throw new Error('GPU history metadata refers to a missing source frame.');
    result[i * 4 + offset] = slot;
  }
  offsets.forEach(([lower = 0, upper = lower], i) => { if (i < width - 1) result.set([lower, upper], (width + i) * 4); });
  result[(width - 1) * 4 + 2] = 4;
  result.set([columns, rows, 0, 0], (2 * width - 1) * 4);
  return result;
}
