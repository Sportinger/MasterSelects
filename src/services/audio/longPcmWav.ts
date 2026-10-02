// Long PCM WAV sources (full-length multitrack stems) are never decoded whole:
// decodeAudioData would hold the file plus ~2 GB of Float32 per hour of stereo.
// The browser plays them directly, so they need no audio proxy, and waveforms
// come from a streamed, peak-preserving decimation read block by block.

import { readBlobAsArrayBuffer } from '../../importers/fileIdentity';
import { estimateDecodedSourceAudioBytes, MAX_DECODED_SOURCE_AUDIO_BYTES } from './fullSourceDecodeBudget';

export interface PcmWavInfo {
  /** 1 = integer PCM, 3 = IEEE float. */
  format: 1 | 3;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
  frames: number;
}

const HEADER_PROBE_BYTES = 64 * 1024;
const MAX_CHUNK_WALK = 64;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
/** Lowest rate an AudioBuffer accepts; ~0.33 ms of peak resolution is plenty for waveforms. */
const MIN_WAVEFORM_SAMPLE_RATE = 3000;
/** Output frames produced per read (the read is `factor` times larger). */
const OUTPUT_FRAMES_PER_READ = 64 * 1024;
const FINGERPRINT_SLICE_BYTES = 64 * 1024;

function ascii(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

async function readBytes(file: Blob, offset: number, length: number): Promise<DataView> {
  const end = Math.min(file.size, offset + length);
  return new DataView(await readBlobAsArrayBuffer(file.slice(offset, end)));
}

/** Parses the RIFF/RF64 header; null for anything that is not integer/float PCM WAV. */
export async function readPcmWavInfo(file: Blob): Promise<PcmWavInfo | null> {
  if (file.size < 44) return null;
  const head = await readBytes(file, 0, HEADER_PROBE_BYTES);
  const riff = ascii(head, 0);
  if ((riff !== 'RIFF' && riff !== 'RF64') || ascii(head, 8) !== 'WAVE') return null;

  let fmt: Omit<PcmWavInfo, 'dataOffset' | 'dataSize' | 'frames'> | null = null;
  let ds64DataSize: number | null = null;
  let at = 12;
  for (let n = 0; n < MAX_CHUNK_WALK && at + 8 <= file.size; n += 1) {
    const header = at + 8 <= head.byteLength ? new DataView(head.buffer, at, 8) : await readBytes(file, at, 8);
    if (header.byteLength < 8) return null;
    const id = ascii(header, 0);
    const size = header.getUint32(4, true);
    if (id === 'ds64') {
      const ds64 = await readBytes(file, at + 8, 16);
      ds64DataSize = Number(ds64.getBigUint64(8, true));
    } else if (id === 'fmt ') {
      const body = await readBytes(file, at + 8, Math.min(size, 40));
      let format = body.getUint16(0, true);
      if (format === WAVE_FORMAT_EXTENSIBLE && body.byteLength >= 26) format = body.getUint16(24, true);
      if (format !== 1 && format !== 3) return null;
      fmt = {
        format: format as 1 | 3,
        channels: body.getUint16(2, true),
        sampleRate: body.getUint32(4, true),
        blockAlign: body.getUint16(12, true),
        bitsPerSample: body.getUint16(14, true),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.channels <= 0 || fmt.sampleRate <= 0 || fmt.blockAlign <= 0) return null;
      const bytes = fmt.bitsPerSample / 8;
      const supported = fmt.format === 1 ? [2, 3, 4].includes(bytes) : bytes === 4;
      if (!supported || fmt.blockAlign !== bytes * fmt.channels) return null;
      const dataOffset = at + 8;
      const declared = size === 0xffffffff ? (ds64DataSize ?? file.size - dataOffset) : size;
      const dataSize = Math.min(declared, file.size - dataOffset);
      return { ...fmt, dataOffset, dataSize, frames: Math.floor(dataSize / fmt.blockAlign) };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Whether a whole-source decode of this WAV would exceed the shared decode budget. */
export function isLongPcmWav(info: PcmWavInfo): boolean {
  return estimateDecodedSourceAudioBytes(info.frames / info.sampleRate, info.sampleRate, info.channels)
    > MAX_DECODED_SOURCE_AUDIO_BYTES;
}

export async function readLongPcmWavInfo(file: Blob): Promise<PcmWavInfo | null> {
  const info = await readPcmWavInfo(file).catch(() => null);
  return info && isLongPcmWav(info) ? info : null;
}

/** One PCM sample at byte offset `at`, scaled to -1..1. */
export function readPcmSample(view: DataView, at: number, info: PcmWavInfo): number {
  if (info.format === 3) return view.getFloat32(at, true);
  switch (info.bitsPerSample) {
    case 16: return view.getInt16(at, true) / 32768;
    case 24: {
      const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16);
      return value / 8388608;
    }
    default: return view.getInt32(at, true) / 2147483648;
  }
}

export interface PeakDecimation {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

export interface PeakDecimationOptions {
  isCancelled?: () => boolean;
  /** Fraction read so far plus a coarse, growing peak preview (0..1, normalized to the running max). */
  onProgress?: (fraction: number, preview: number[]) => void;
}

/** Buckets of the coarse preview shown while a long stem is still being read. */
const PROGRESS_PREVIEW_BUCKETS = 2000;
const PROGRESS_STEP = 0.02;

/**
 * Streams the data chunk and keeps, per channel and per `factor` input frames,
 * the sample with the largest magnitude. Min/max envelopes stay intact at every
 * waveform zoom level while memory drops by the decimation factor. Runs in the
 * long-WAV peaks worker; `onProgress` gets a growing preview for the UI.
 */
export async function decimatePcmWavPeaks(
  file: Blob,
  info: PcmWavInfo,
  options: PeakDecimationOptions = {},
): Promise<PeakDecimation> {
  const factor = Math.max(1, Math.floor(info.sampleRate / MIN_WAVEFORM_SAMPLE_RATE));
  const length = Math.max(1, Math.floor(info.frames / factor));
  const channels = Array.from({ length: info.channels }, () => new Float32Array(length));
  const bytesPerSample = info.bitsPerSample / 8;
  const preview = new Array<number>(PROGRESS_PREVIEW_BUCKETS).fill(0);
  const bucketLength = Math.max(1, length / PROGRESS_PREVIEW_BUCKETS);
  let previewMax = 0;
  let lastReported = 0;

  for (let outStart = 0; outStart < length; outStart += OUTPUT_FRAMES_PER_READ) {
    if (options.isCancelled?.()) throw new DOMException('Aborted', 'AbortError');
    const outCount = Math.min(OUTPUT_FRAMES_PER_READ, length - outStart);
    const view = await readBytes(file, info.dataOffset + outStart * factor * info.blockAlign, outCount * factor * info.blockAlign);
    const available = Math.floor(view.byteLength / (factor * info.blockAlign));
    for (let o = 0; o < available; o += 1) {
      const blockStart = o * factor * info.blockAlign;
      let framePeak = 0;
      for (let channel = 0; channel < info.channels; channel += 1) {
        let best = 0;
        for (let f = 0; f < factor; f += 1) {
          const value = readPcmSample(view, blockStart + f * info.blockAlign + channel * bytesPerSample, info);
          if (Math.abs(value) > Math.abs(best)) best = value;
        }
        channels[channel]![outStart + o] = best;
        framePeak = Math.max(framePeak, Math.abs(best));
      }
      const bucket = Math.min(PROGRESS_PREVIEW_BUCKETS - 1, Math.floor((outStart + o) / bucketLength));
      preview[bucket] = Math.max(preview[bucket]!, framePeak);
      previewMax = Math.max(previewMax, framePeak);
    }
    const fraction = Math.min(1, (outStart + outCount) / length);
    if (options.onProgress && (fraction - lastReported >= PROGRESS_STEP || fraction === 1)) {
      lastReported = fraction;
      options.onProgress(fraction, preview.map((value) => (previewMax > 0 ? value / previewMax : 0)));
    }
    // Yield between blocks (cancel messages, UI when running on the main thread).
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { channels, sampleRate: info.sampleRate / factor };
}

/** Wraps decimated peaks in an AudioBuffer (main thread: AudioBuffer does not exist in workers). */
export function peakDecimationToAudioBuffer(peaks: PeakDecimation): AudioBuffer {
  const buffer = new AudioBuffer({
    length: peaks.channels[0]?.length ?? 1,
    numberOfChannels: Math.max(1, peaks.channels.length),
    sampleRate: peaks.sampleRate,
  });
  peaks.channels.forEach((data, channel) => buffer.copyToChannel(data, channel));
  return buffer;
}

/** Cheap content fingerprint (header, tail, size) in place of hashing a multi-GB file. */
export async function readLongWavFingerprintBytes(file: File): Promise<ArrayBuffer> {
  const head = await readBlobAsArrayBuffer(file.slice(0, FINGERPRINT_SLICE_BYTES));
  const tail = await readBlobAsArrayBuffer(file.slice(Math.max(0, file.size - FINGERPRINT_SLICE_BYTES)));
  const meta = new TextEncoder().encode(`${file.size}:${file.lastModified}`);
  const bytes = new Uint8Array(head.byteLength + tail.byteLength + meta.byteLength);
  bytes.set(new Uint8Array(head), 0);
  bytes.set(new Uint8Array(tail), head.byteLength);
  bytes.set(meta, head.byteLength + tail.byteLength);
  return bytes.buffer;
}
