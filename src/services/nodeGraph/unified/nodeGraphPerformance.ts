/** DEV-only User Timing. Call sites guard start/end so production does no timing work. */
let sequence = 0;
export function startNodeMeasure(name: string): string | undefined {
  if (typeof performance.mark !== 'function' || typeof performance.measure !== 'function') return;
  const mark = `ms-node:${name}:start:${sequence++}`;
  performance.mark(mark);
  return mark;
}

export function endNodeMeasure(name: string, start: string | undefined, detail?: unknown): void {
  if (!start || typeof performance.measure !== 'function') return;
  performance.measure(`ms-node:${name}`, { start, detail });
  performance.clearMarks(start);
}

/** Numeric diagnostics use measure.detail; duration is deliberately zero. */
export function nodeCountMeasure(name: string, detail: unknown): void {
  if (typeof performance.measure !== 'function') return;
  const now = performance.now();
  performance.measure(`ms-node:${name}`, { start: now, end: now, detail });
}

/** Relay worker durations to the window timeline read by browser diagnostics. */
export function nodeDurationMeasure(name: string, duration: number, detail?: unknown): void {
  if (typeof performance.measure !== 'function') return;
  const end = performance.now();
  performance.measure(`ms-node:${name}`, { start: Math.max(0, end - duration), end, detail });
}
