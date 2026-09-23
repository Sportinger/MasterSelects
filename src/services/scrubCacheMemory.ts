/** Browser RAM is rounded/capped, never a measurement of currently free memory. */
export const GIB = 1024 ** 3;
export function getReportedMemoryGB(): number | null {
  const value = typeof navigator === 'undefined' ? undefined
    : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function getMaxScrubRamGB(reported = getReportedMemoryGB()): number {
  return reported === null ? 1 : Math.min(4, Math.floor(reported) / 4);
}

export function normalizeScrubRamGB(value: unknown, reported = getReportedMemoryGB()): number {
  const max = getMaxScrubRamGB(reported);
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value * 4) / 4))
    : Math.min(0.5, max);
}
