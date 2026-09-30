// Budget for decoding a whole audio source into Float32 PCM (decodeAudioData,
// AudioBuffer caches, waveform analysis). Hour-long stems and camera files
// exceed it by far: they play through media elements and are analysed from
// streamed reads instead.

/** ~20 minutes of stereo at 48 kHz. */
export const MAX_DECODED_SOURCE_AUDIO_BYTES = 448 * 1024 * 1024;

/** Decoded Float32 size of a full-source decode (stereo assumed when the layout is unknown). */
export function estimateDecodedSourceAudioBytes(
  durationSeconds: number | undefined,
  sampleRate: number,
  channels = 2,
): number {
  if (!Number.isFinite(durationSeconds) || !durationSeconds || durationSeconds <= 0) return 0;
  return durationSeconds * sampleRate * Math.max(1, channels) * Float32Array.BYTES_PER_ELEMENT;
}
