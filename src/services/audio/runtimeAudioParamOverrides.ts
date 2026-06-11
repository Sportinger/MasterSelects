const trackVolumeDbOverrides = new Map<string, number>();
let masterVolumeDbOverride: number | null = null;

function clampVolumeDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-60, Math.min(18, value));
}

export function setRuntimeTrackVolumeDbOverride(trackId: string, volumeDb: number): void {
  if (!trackId) return;
  trackVolumeDbOverrides.set(trackId, clampVolumeDb(volumeDb));
}

export function clearRuntimeTrackVolumeDbOverride(trackId: string): void {
  if (!trackId) return;
  trackVolumeDbOverrides.delete(trackId);
}

export function getRuntimeTrackVolumeDbOverride(trackId: string): number | undefined {
  return trackVolumeDbOverrides.get(trackId);
}

export function setRuntimeMasterVolumeDbOverride(volumeDb: number): void {
  masterVolumeDbOverride = clampVolumeDb(volumeDb);
}

export function clearRuntimeMasterVolumeDbOverride(): void {
  masterVolumeDbOverride = null;
}

export function getRuntimeMasterVolumeDbOverride(): number | undefined {
  return masterVolumeDbOverride ?? undefined;
}

export function getRuntimeAudioParamOverrideSnapshot() {
  return {
    trackVolumeDb: Object.fromEntries(trackVolumeDbOverrides.entries()),
    masterVolumeDb: masterVolumeDbOverride,
  };
}
