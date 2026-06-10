const AUDIO_VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'];

export function isAudioBearingFile(file: File): boolean {
  const mimeType = file.type || '';
  const fileName = file.name || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return mimeType.startsWith('video/') || mimeType.startsWith('audio/') || AUDIO_VIDEO_EXTS.includes(ext);
}

/**
 * Extract audio buffer from a media file, optionally slicing to a time range.
 */
export async function extractAudioBuffer(
  file: File,
  startTime?: number,
  endTime?: number,
): Promise<AudioBuffer> {
  const audioContext = new AudioContext();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const fullBuffer = await audioContext.decodeAudioData(arrayBuffer);

    if (startTime === undefined && endTime === undefined) {
      return fullBuffer;
    }

    const sampleRate = fullBuffer.sampleRate;
    const startSample = Math.floor((startTime || 0) * sampleRate);
    const endSample = Math.min(
      Math.ceil((endTime || fullBuffer.duration) * sampleRate),
      fullBuffer.length,
    );
    const sliceLength = endSample - startSample;

    const slicedBuffer = audioContext.createBuffer(
      fullBuffer.numberOfChannels,
      sliceLength,
      sampleRate,
    );

    for (let channel = 0; channel < fullBuffer.numberOfChannels; channel++) {
      const sourceData = fullBuffer.getChannelData(channel);
      const destData = slicedBuffer.getChannelData(channel);
      for (let i = 0; i < sliceLength; i++) {
        destData[i] = sourceData[startSample + i];
      }
    }

    return slicedBuffer;
  } finally {
    if (audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined);
    }
  }
}

/**
 * Decode an audio blob through AudioContext and always release the context.
 */
export async function decodeAudioBlob(audioBlob: Blob): Promise<AudioBuffer> {
  const audioContext = new AudioContext();

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    if (audioContext.state !== 'closed') {
      await audioContext.close().catch(() => undefined);
    }
  }
}

/**
 * Resample audio to target sample rate (e.g., 16kHz for Whisper).
 */
export async function resampleAudio(
  audioBuffer: AudioBuffer,
  targetSampleRate: number,
): Promise<Float32Array> {
  const channelData = audioBuffer.getChannelData(0);
  const originalSampleRate = audioBuffer.sampleRate;

  if (originalSampleRate === targetSampleRate) {
    return channelData;
  }

  const ratio = originalSampleRate / targetSampleRate;
  const newLength = Math.floor(channelData.length / ratio);
  const resampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, channelData.length - 1);
    const t = srcIndex - srcIndexFloor;
    resampled[i] = channelData[srcIndexFloor] * (1 - t) + channelData[srcIndexCeil] * t;
  }

  return resampled;
}

/**
 * Convert AudioBuffer to WAV Blob for API upload.
 */
export async function audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
  const numChannels = 1;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const channelData = audioBuffer.getChannelData(0);
  const samples = new Int16Array(channelData.length);

  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const dataView = new Int16Array(buffer, 44);
  dataView.set(samples);

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Split an AudioBuffer into chunks that produce WAV files under the size limit.
 */
export function splitAudioBuffer(audioBuffer: AudioBuffer, maxWavBytes: number): AudioBuffer[] {
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const headerSize = 44;
  const maxSamples = Math.floor((maxWavBytes - headerSize) / bytesPerSample);
  const totalSamples = audioBuffer.length;

  if (totalSamples <= maxSamples) {
    return [audioBuffer];
  }

  const chunks: AudioBuffer[] = [];
  const numChannels = audioBuffer.numberOfChannels;
  let offset = 0;

  while (offset < totalSamples) {
    const chunkLength = Math.min(maxSamples, totalSamples - offset);
    const ctx = new OfflineAudioContext(numChannels, chunkLength, sampleRate);
    const chunkBuffer = ctx.createBuffer(numChannels, chunkLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const src = audioBuffer.getChannelData(ch);
      const dst = chunkBuffer.getChannelData(ch);
      for (let i = 0; i < chunkLength; i++) {
        dst[i] = src[offset + i];
      }
    }

    chunks.push(chunkBuffer);
    offset += chunkLength;
  }

  return chunks;
}
