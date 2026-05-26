export type AudioTrackHeaderDensity = 'full' | 'compact' | 'condensed';

export function getAudioTrackHeaderDensity(baseHeight: number): AudioTrackHeaderDensity {
  if (!Number.isFinite(baseHeight) || baseHeight < 36) {
    return 'condensed';
  }
  if (baseHeight < 72) {
    return 'compact';
  }
  return 'full';
}

export function formatAudioTrackVolumeDb(volumeDb: number): string {
  if (!Number.isFinite(volumeDb)) return '0.0';
  if (volumeDb <= -59.95) return '-inf';
  return volumeDb >= 0 ? `+${volumeDb.toFixed(1)}` : volumeDb.toFixed(1);
}

export function formatAudioTrackPan(pan: number): string {
  if (!Number.isFinite(pan) || Math.abs(pan) < 0.005) return 'C';
  const clamped = Math.max(-1, Math.min(1, pan));
  const value = Math.round(Math.abs(clamped) * 100);
  return clamped < 0 ? `L${value}` : `R${value}`;
}
