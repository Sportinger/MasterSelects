// Shared linear-interpolation resampler used by transcription (Whisper prep)
// and audio-intelligence analysis (Silero VAD prep).

export function resamplePcm(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0) {
    throw new Error('resamplePcm inputRate must be a positive finite number.');
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('resamplePcm targetRate must be a positive finite number.');
  }

  if (inputRate === targetRate) {
    return input;
  }

  const ratio = inputRate / targetRate;
  const newLength = Math.floor(input.length / ratio);
  const resampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const t = srcIndex - srcIndexFloor;
    resampled[i] = input[srcIndexFloor] * (1 - t) + input[srcIndexCeil] * t;
  }

  return resampled;
}

// Resamples channel 0 of an AudioBuffer. When the rates already match this
// returns the live channel data array (no copy), matching the historical
// transcription behavior; callers that transfer the buffer to a worker must
// copy first.
export function resampleAudioBuffer(
  buffer: AudioBuffer,
  targetRate: number,
): Float32Array {
  return resamplePcm(buffer.getChannelData(0), buffer.sampleRate, targetRate);
}
