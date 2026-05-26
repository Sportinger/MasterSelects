export type AudioOnlyExportFormat = 'wav' | 'browser';

export type WavBitDepth = 16;

export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export interface WavEncodeOptions {
  bitDepth?: WavBitDepth;
}

export interface Float32PcmChunk {
  channels: readonly Float32Array[];
  frameCount?: number;
}

export interface Float32PcmWavEncodeInput {
  sampleRate: number;
  channelCount: number;
  chunks: readonly Float32PcmChunk[];
  frameCount?: number;
}

const WAV_HEADER_BYTES = 44;
const WAV_FORMAT_PCM = 1;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function floatToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
  return clamped < 0
    ? Math.round(clamped * 0x8000)
    : Math.round(clamped * 0x7fff);
}

function validateWavParams(sampleRate: number, channelCount: number, sampleCount: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Cannot encode WAV with an invalid sample rate');
  }
  if (!Number.isFinite(channelCount) || channelCount < 1) {
    throw new Error('Cannot encode WAV without audio channels');
  }
  if (!Number.isFinite(sampleCount) || sampleCount < 0) {
    throw new Error('Cannot encode WAV with an invalid sample count');
  }
}

function getWavByteSize(sampleCount: number, channelCount: number, bitDepth: WavBitDepth): number {
  const bytesPerSample = bitDepth / 8;
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const fileSize = WAV_HEADER_BYTES + dataSize;
  const riffChunkSize = fileSize - 8;

  if (riffChunkSize > 0xffffffff) {
    throw new Error('WAV export is limited to 4 GB RIFF files');
  }

  return fileSize;
}

function writeWavHeader(
  view: DataView,
  sampleRate: number,
  channelCount: number,
  sampleCount: number,
  bitDepth: WavBitDepth,
): number {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const fileSize = getWavByteSize(sampleCount, channelCount, bitDepth);
  const riffChunkSize = fileSize - 8;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, riffChunkSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAV_FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return bytesPerSample;
}

function getPcmChunkFrameCount(chunk: Float32PcmChunk): number {
  if (chunk.frameCount !== undefined) {
    return Math.max(0, Math.floor(chunk.frameCount));
  }
  return chunk.channels.reduce((frameCount, channel) => Math.max(frameCount, channel.length), 0);
}

export function estimateWavByteSize(buffer: AudioBufferLike, options?: WavEncodeOptions): number {
  const bitDepth = options?.bitDepth ?? 16;
  if (bitDepth !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }
  const channelCount = Math.floor(buffer.numberOfChannels);
  const sampleCount = Math.floor(buffer.length);
  validateWavParams(buffer.sampleRate, channelCount, sampleCount);
  return getWavByteSize(sampleCount, channelCount, bitDepth);
}

export function encodeAudioBufferToWavBytes(buffer: AudioBufferLike, options?: WavEncodeOptions): Uint8Array {
  const bitDepth = options?.bitDepth ?? 16;
  if (bitDepth !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }

  const channelCount = Math.floor(buffer.numberOfChannels);
  const sampleCount = Math.floor(buffer.length);
  validateWavParams(buffer.sampleRate, channelCount, sampleCount);

  const bytesPerSample = bitDepth / 8;
  const fileSize = getWavByteSize(sampleCount, channelCount, bitDepth);
  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);
  writeWavHeader(view, buffer.sampleRate, channelCount, sampleCount, bitDepth);

  const channelData = Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
  let offset = WAV_HEADER_BYTES;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const pcm = floatToPcm16(channelData[channel]?.[sampleIndex] ?? 0);
      view.setInt16(offset, pcm, true);
      offset += bytesPerSample;
    }
  }

  return bytes;
}

export function estimateFloat32PcmWavByteSize(input: Float32PcmWavEncodeInput, options?: WavEncodeOptions): number {
  const bitDepth = options?.bitDepth ?? 16;
  if (bitDepth !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }
  const channelCount = Math.floor(input.channelCount);
  const sampleCount = Math.floor(input.frameCount ?? input.chunks.reduce(
    (total, chunk) => total + getPcmChunkFrameCount(chunk),
    0,
  ));
  validateWavParams(input.sampleRate, channelCount, sampleCount);
  return getWavByteSize(sampleCount, channelCount, bitDepth);
}

export function encodeFloat32PcmChunksToWavBytes(
  input: Float32PcmWavEncodeInput,
  options?: WavEncodeOptions,
): Uint8Array {
  const bitDepth = options?.bitDepth ?? 16;
  if (bitDepth !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }

  const channelCount = Math.floor(input.channelCount);
  const sampleCount = Math.floor(input.frameCount ?? input.chunks.reduce(
    (total, chunk) => total + getPcmChunkFrameCount(chunk),
    0,
  ));
  validateWavParams(input.sampleRate, channelCount, sampleCount);

  const bytesPerSample = bitDepth / 8;
  const bytes = new Uint8Array(getWavByteSize(sampleCount, channelCount, bitDepth));
  const view = new DataView(bytes.buffer);
  writeWavHeader(view, input.sampleRate, channelCount, sampleCount, bitDepth);

  let offset = WAV_HEADER_BYTES;
  let writtenFrames = 0;
  for (const chunk of input.chunks) {
    if (writtenFrames >= sampleCount) break;

    const chunkFrameCount = Math.min(getPcmChunkFrameCount(chunk), sampleCount - writtenFrames);
    for (let frameIndex = 0; frameIndex < chunkFrameCount; frameIndex++) {
      for (let channel = 0; channel < channelCount; channel++) {
        const pcm = floatToPcm16(chunk.channels[channel]?.[frameIndex] ?? 0);
        view.setInt16(offset, pcm, true);
        offset += bytesPerSample;
      }
    }
    writtenFrames += chunkFrameCount;
  }

  return bytes;
}

export function encodeAudioBufferToWavBlob(buffer: AudioBufferLike, options?: WavEncodeOptions): Blob {
  const bytes = encodeAudioBufferToWavBytes(buffer, options);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function encodeFloat32PcmChunksToWavBlob(
  input: Float32PcmWavEncodeInput,
  options?: WavEncodeOptions,
): Blob {
  const bytes = encodeFloat32PcmChunksToWavBytes(input, options);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
