// Canvas rendering is GPU-only on every platform. Keep this gate centralized
// so callers cannot silently reintroduce platform- or boot-history fallbacks.
export function prefersSoftwareTimelineCanvas(): boolean {
  return false;
}

export function resetCanvasPlatformPreferenceForTests(): void {
  // Kept for consumers that reset platform policy between tests.
}
