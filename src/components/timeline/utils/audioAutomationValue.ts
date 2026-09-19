/** Display linear audio gain without changing the stored automation values. */
export function formatAudioAutomationGain(gain: number): string {
  if (!Number.isFinite(gain)) return '—';
  if (gain <= 0) return '-∞ dB';
  const decibels = Number((20 * Math.log10(gain)).toFixed(1));
  return `${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`;
}
