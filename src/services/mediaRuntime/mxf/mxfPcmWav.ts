// Builds the 16-bit stereo WAV audio proxy straight from frame-wrapped MXF PCM
// (SMPTE 382 BWF/AES3 sound elements in the content packages). Streams edit
// unit by edit unit, so a long camera file never becomes a Float32 AudioBuffer.
// Mapping (plan D2, v1): A1 -> left, A2 -> right; a single mono track is doubled,
// a stereo track is used as is.

import { parseKlvHeader } from '../../mediaMetadata/mxf/mxfKlv';
import type { MxfAudioInfo } from '../../mediaMetadata/mxf/mxfMetadata';
import { MxfPacketSource } from './MxfPacketSource';

const WAV_HEADER_BYTES = 44;
const READ_BATCH = 16;
const PART_TARGET_BYTES = 4 * 1024 * 1024;
/**
 * Parts are folded into Blobs of this size so the PCM leaves the JS heap early
 * (Chromium moves large Blobs to disk-backed storage); an 80-minute stereo proxy
 * is ~1 GB and must never exist twice in memory.
 */
const BLOB_FOLD_BYTES = 64 * 1024 * 1024;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class MxfAudioUnavailableError extends Error {}

interface ChannelSource {
  trackNumber: number;
  channelIndex: number;
  /** Interleaved channel slots per sample in the element. */
  channels: number;
  /** Bytes before the first sample (SMPTE 386M D-10 AES3 element header). */
  headerBytes: number;
}

/** D-10 sound elements always carry 8 AES3 channel slots after a 4-byte header. */
const D10_CHANNEL_SLOTS = 8;
const D10_HEADER_BYTES = 4;

function isSoundElementKey(key: string): boolean {
  return key.startsWith('060e2b340102010') && key.slice(16, 24) === '0d010301';
}

function pickChannels(audio: readonly MxfAudioInfo[]): [ChannelSource, ChannelSource] | null {
  const usable = audio.filter((a) => a.channels > 0 && a.trackNumber !== 0);
  const first = usable[0];
  if (!first) return null;
  const slots = (track: MxfAudioInfo) => (track.aes3InPicture ? D10_CHANNEL_SLOTS : track.channels);
  const header = (track: MxfAudioInfo) => (track.aes3InPicture ? D10_HEADER_BYTES : 0);
  if (first.channels >= 2) {
    return [
      { trackNumber: first.trackNumber, channelIndex: 0, channels: slots(first), headerBytes: header(first) },
      { trackNumber: first.trackNumber, channelIndex: 1, channels: slots(first), headerBytes: header(first) },
    ];
  }
  const second = usable[1] ?? first;
  return [
    { trackNumber: first.trackNumber, channelIndex: 0, channels: slots(first), headerBytes: header(first) },
    { trackNumber: second.trackNumber, channelIndex: 0, channels: slots(second), headerBytes: header(second) },
  ];
}

/** Reads sample `index` of channel `channel` as a signed 16-bit value. */
function readSample16(data: Uint8Array, bytesPerSample: number, channels: number, index: number, channel: number): number {
  const at = (index * channels + channel) * bytesPerSample;
  switch (bytesPerSample) {
    case 2: return (data[at]! | (data[at + 1]! << 8)) << 16 >> 16;
    case 3: return (data[at + 1]! | (data[at + 2]! << 8)) << 16 >> 16;
    case 4: {
      // AES3 subframe: 24-bit audio in bits 4..27 of a little-endian word.
      const word = (data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16) | (data[at + 3]! << 24)) >>> 0;
      return (word >>> 12) << 16 >> 16;
    }
    default: return 0;
  }
}

function wavHeader(sampleRate: number, channels: number, sampleFrames: number): ArrayBuffer {
  const dataSize = sampleFrames * channels * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return buffer;
}

export async function buildMxfPcmWavBlob(
  file: File,
  options: { onProgress?: (fraction: number) => void; isCancelled?: () => boolean } = {},
): Promise<Blob> {
  const source = await MxfPacketSource.create(file);
  try {
    const mapping = pickChannels(source.mxf.audio);
    if (!mapping) throw new MxfAudioUnavailableError('MXF file has no frame-wrapped PCM audio track');
    const sampleRate = source.mxf.audio[0]!.sampleRate || 48_000;
    const fps = source.metadata.fps;
    const frameCount = source.frameCount;
    const blobs: Blob[] = [];
    let parts: ArrayBuffer[] = [];
    let partBytes = 0;
    let current = new Int16Array(PART_TARGET_BYTES / 2);
    let currentLength = 0;
    let totalFrames = 0;

    const foldParts = () => {
      if (parts.length === 0) return;
      blobs.push(new Blob(parts));
      parts = [];
      partBytes = 0;
    };
    const flush = () => {
      if (currentLength === 0) return;
      parts.push(current.slice(0, currentLength).buffer);
      partBytes += currentLength * 2;
      currentLength = 0;
      if (partBytes >= BLOB_FOLD_BYTES) foldParts();
    };

    for (let batchStart = 0; batchStart < frameCount; batchStart += READ_BATCH) {
      if (options.isCancelled?.()) throw new Error('MXF audio extraction cancelled');
      const indices = Array.from({ length: Math.min(READ_BATCH, frameCount - batchStart) }, (_, i) => batchStart + i);
      const regions = await Promise.all(indices.map(async (index) => {
        const span = await source.contentPackageSpan(index);
        if (!span) throw new MxfAudioUnavailableError('Clip-wrapped MXF audio is not supported yet');
        return { span, bytes: await source.readBytes(span.afterPicture, span.end - span.afterPicture) };
      }));

      for (const { bytes } of regions) {
        const elements = new Map<number, Uint8Array>();
        let at = 0;
        while (at + 17 <= bytes.length) {
          const klv = parseKlvHeader(bytes, at);
          if (!klv || klv.end > bytes.length) break;
          if (isSoundElementKey(klv.key)) {
            const trackNumber = parseInt(klv.key.slice(24, 32), 16) >>> 0;
            const skip = mapping.find((c) => c.trackNumber === trackNumber)?.headerBytes ?? 0;
            elements.set(trackNumber, bytes.subarray(klv.valueOffset + skip, klv.end));
          }
          at = klv.end;
        }
        // Sample count per edit unit can alternate (e.g. 1602/1601 at 29.97); derive it from the data.
        const left = elements.get(mapping[0].trackNumber);
        const right = elements.get(mapping[1].trackNumber);
        const nominal = Math.round(sampleRate / fps);
        const samplesOf = (data: Uint8Array | undefined, channels: number) => {
          if (!data) return 0;
          const bytesPerSample = Math.round(data.length / (channels * nominal)) || 3;
          return Math.floor(data.length / (channels * bytesPerSample));
        };
        const samples = Math.max(samplesOf(left, mapping[0].channels), samplesOf(right, mapping[1].channels), 0) || nominal;
        const bpsLeft = left ? Math.max(1, Math.floor(left.length / (mapping[0].channels * samples))) : 0;
        const bpsRight = right ? Math.max(1, Math.floor(right.length / (mapping[1].channels * samples))) : 0;
        if (currentLength + samples * 2 > current.length) flush();
        for (let i = 0; i < samples; i += 1) {
          current[currentLength++] = left ? readSample16(left, bpsLeft, mapping[0].channels, i, mapping[0].channelIndex) : 0;
          current[currentLength++] = right ? readSample16(right, bpsRight, mapping[1].channels, i, mapping[1].channelIndex) : 0;
        }
        totalFrames += samples;
      }
      options.onProgress?.(Math.min(1, (batchStart + indices.length) / frameCount));
      // Keep playback and UI responsive during long extractions.
      if ((batchStart / READ_BATCH) % 8 === 7) await yieldToEventLoop();
    }
    flush();
    foldParts();
    return new Blob([wavHeader(sampleRate, 2, totalFrames), ...blobs], { type: 'audio/wav' });
  } finally {
    source.dispose();
  }
}
