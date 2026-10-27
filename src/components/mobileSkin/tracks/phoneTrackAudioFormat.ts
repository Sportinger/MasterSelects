// Ranges and readouts of the tracks sheet's level and pan rows (pure, unit tested).

/** Range of the phone slider; the store accepts up to +18 dB (typed values reach it). */
export const PHONE_TRACK_VOLUME_MIN_DB = -60;
export const PHONE_TRACK_VOLUME_MAX_DB = 12;
export const PHONE_TRACK_VOLUME_FIELD_MAX_DB = 18;

/** "C", "L 30" or "R 30" for a pan of -1..1. */
export function formatPhoneTrackPan(pan: number): string {
  const percent = Math.round(Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0)) * 100);
  if (percent === 0) return 'C';
  return percent < 0 ? `L ${-percent}` : `R ${percent}`;
}

export function formatPhoneTrackVolume(volumeDb: number): string {
  if (volumeDb <= PHONE_TRACK_VOLUME_MIN_DB) return '-inf dB';
  return `${volumeDb > 0 ? '+' : ''}${volumeDb.toFixed(1)} dB`;
}
