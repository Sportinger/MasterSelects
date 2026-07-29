import { createBuffer } from '../audioBufferFactory';

const HEADER_READ_BYTES = 64 * 1024;
const MAX_HEADER_READ_BYTES = 1024 * 1024;

export interface AudioByteRangeSource {
  size?: number;
  read(start: number, endExclusive: number): Promise<ArrayBuffer>;
}

interface WavPcmMetadata {
  audioFormat: number;
  channelCount: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

export class WavPcmRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavPcmRangeError';
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index++) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

function parseContentRange(value: string | null): { start: number; end: number; size?: number } | null {
  const match = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    size: match[3] === '*' ? undefined : Number(match[3]),
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: the important part is that arrayBuffer() is never called.
  }
}

export function createFileAudioByteRangeSource(file: Blob): AudioByteRangeSource {
  return {
    size: file.size,
    async read(start, endExclusive) {
      const safeStart = Math.max(0, Math.floor(start));
      const safeEnd = Math.min(file.size, Math.max(safeStart, Math.ceil(endExclusive)));
      return file.slice(safeStart, safeEnd).arrayBuffer();
    },
  };
}

export function createUrlAudioByteRangeSource(url: string): AudioByteRangeSource {
  let knownSize: number | undefined;

  return {
    get size() {
      return knownSize;
    },
    async read(start, endExclusive) {
      const safeStart = Math.max(0, Math.floor(start));
      const safeEnd = Math.max(safeStart + 1, Math.ceil(endExclusive));
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${safeStart}-${safeEnd - 1}`,
        },
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new WavPcmRangeError(`Audio proxy range request failed (${response.status})`);
      }

      const contentRange = parseContentRange(response.headers.get('content-range'));
      if (response.status === 206 && contentRange) {
        knownSize = contentRange.size ?? knownSize;
        if (contentRange.start !== safeStart) {
          await cancelResponseBody(response);
          throw new WavPcmRangeError('Audio proxy returned the wrong byte range');
        }
        return response.arrayBuffer();
      }

      // Never turn an ignored Range request into a full multi-hundred-MB
      // allocation. A complete response is accepted only when it is no larger
      // than the requested header window (mainly useful for small test/assets).
      const contentLength = Number(response.headers.get('content-length'));
      const requestedLength = safeEnd - safeStart;
      if (
        safeStart !== 0
        || !Number.isFinite(contentLength)
        || contentLength > requestedLength
        || contentLength > MAX_HEADER_READ_BYTES
      ) {
        await cancelResponseBody(response);
        throw new WavPcmRangeError('Audio proxy server does not support safe byte-range reads');
      }

      knownSize = contentLength;
      return response.arrayBuffer();
    },
  };
}

function parseWavMetadata(header: ArrayBuffer): WavPcmMetadata {
  const view = new DataView(header);
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new WavPcmRangeError('Audio proxy is not a RIFF/WAVE file');
  }

  let offset = 12;
  let format: Omit<WavPcmMetadata, 'dataOffset' | 'dataSize'> | null = null;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkDataOffset + Math.min(chunkSize, 16) <= view.byteLength) {
      if (chunkSize < 16) {
        throw new WavPcmRangeError('Audio proxy contains an invalid WAV format chunk');
      }
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channelCount: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        blockAlign: view.getUint16(chunkDataOffset + 12, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
      };
    }

    if (chunkId === 'data') {
      if (!format) {
        throw new WavPcmRangeError('Audio proxy WAV data precedes its format chunk');
      }
      return {
        ...format,
        dataOffset: chunkDataOffset,
        dataSize: chunkSize,
      };
    }

    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
  }

  throw new WavPcmRangeError(
    view.byteLength >= MAX_HEADER_READ_BYTES
      ? 'Audio proxy WAV header is too large'
      : 'Audio proxy WAV data chunk was not found in the header window',
  );
}

async function readWavMetadata(source: AudioByteRangeSource): Promise<WavPcmMetadata> {
  let readSize = Math.min(source.size ?? HEADER_READ_BYTES, HEADER_READ_BYTES);
  readSize = Math.max(44, readSize);

  while (readSize <= MAX_HEADER_READ_BYTES) {
    const header = await source.read(0, readSize);
    try {
      return parseWavMetadata(header);
    } catch (error) {
      if (
        !(error instanceof WavPcmRangeError)
        || !error.message.includes('data chunk was not found')
        || header.byteLength < readSize
        || readSize === MAX_HEADER_READ_BYTES
      ) {
        throw error;
      }
    }
    readSize = Math.min(readSize * 2, MAX_HEADER_READ_BYTES);
  }

  throw new WavPcmRangeError('Audio proxy WAV header could not be parsed');
}

function decodePcmSample(
  view: DataView,
  byteOffset: number,
  audioFormat: number,
  bitsPerSample: number,
): number {
  if (audioFormat === 1 && bitsPerSample === 16) {
    return view.getInt16(byteOffset, true) / 0x8000;
  }
  if (audioFormat === 3 && bitsPerSample === 32) {
    return view.getFloat32(byteOffset, true);
  }
  throw new WavPcmRangeError(
    `Unsupported audio proxy WAV format (${audioFormat}, ${bitsPerSample}-bit)`,
  );
}

export async function readWavPcmAudioRange(
  source: AudioByteRangeSource,
  startSeconds: number,
  endSeconds: number,
): Promise<AudioBuffer> {
  const metadata = await readWavMetadata(source);
  if (
    metadata.channelCount < 1
    || metadata.sampleRate < 1
    || metadata.blockAlign < 1
    || !(
      (metadata.audioFormat === 1 && metadata.bitsPerSample === 16)
      || (metadata.audioFormat === 3 && metadata.bitsPerSample === 32)
    )
  ) {
    throw new WavPcmRangeError('Audio proxy WAV format is not supported for ranged export');
  }

  const bytesPerSample = metadata.bitsPerSample / 8;
  if (metadata.blockAlign !== metadata.channelCount * bytesPerSample) {
    throw new WavPcmRangeError('Audio proxy WAV has an unsupported block alignment');
  }

  const totalFrames = Math.floor(metadata.dataSize / metadata.blockAlign);
  const startFrame = Math.min(
    totalFrames,
    Math.max(0, Math.floor(Math.max(0, startSeconds) * metadata.sampleRate)),
  );
  const requestedEndFrame = Math.ceil(Math.max(startSeconds, endSeconds) * metadata.sampleRate);
  const endFrame = Math.min(totalFrames, Math.max(startFrame + 1, requestedEndFrame));
  const frameCount = Math.max(1, endFrame - startFrame);
  const byteStart = metadata.dataOffset + startFrame * metadata.blockAlign;
  const byteEnd = metadata.dataOffset + endFrame * metadata.blockAlign;
  const bytes = await source.read(byteStart, byteEnd);

  if (bytes.byteLength < frameCount * metadata.blockAlign) {
    throw new WavPcmRangeError('Audio proxy range response was shorter than requested');
  }

  const output = createBuffer(metadata.channelCount, frameCount, metadata.sampleRate);
  const view = new DataView(bytes);
  for (let channel = 0; channel < metadata.channelCount; channel++) {
    const channelData = output.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame++) {
      const sampleOffset = frame * metadata.blockAlign + channel * bytesPerSample;
      channelData[frame] = decodePcmSample(
        view,
        sampleOffset,
        metadata.audioFormat,
        metadata.bitsPerSample,
      );
    }
  }

  return output;
}
