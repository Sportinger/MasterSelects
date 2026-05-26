export function formatEqualizerFrequency(frequencyHz: number): string {
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return Number.isInteger(khz) ? `${khz}k` : `${khz.toFixed(1)}k`;
  }
  return String(frequencyHz);
}
