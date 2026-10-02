// Low-rate mono sync signal for one clip's audio. Hour-long stems and camera
// files are never decoded whole: PCM WAV (the source or a camera's audio
// proxy) streams through the long-WAV peak worker or is read by byte range,
// MP4/MOV audio is decoded in ranged chunks. A target that only needs an
// excerpt reads just that window, chosen from its saved waveform. Short
// sources return null and keep the whole-buffer path.

import type { TimelineClip } from '../../types/timeline';
import type { MediaFile } from '../../stores/mediaStore/types';
import { useMediaStore } from '../../stores/mediaStore';
import { readBlobAsArrayBuffer } from '../../importers/fileIdentity';
import { Logger } from '../logger';
import { estimateDecodedSourceAudioBytes, MAX_DECODED_SOURCE_AUDIO_BYTES } from './fullSourceDecodeBudget';
import { isLongPcmWav, readPcmSample, readPcmWavInfo, type PcmWavInfo } from './longPcmWav';
import { buildPeakDecimatedAudioBuffer } from './longWavPeaksClient';
import { chooseExcerptWindow, energyCurveFromPyramid } from './syncExcerptWindow';

const log = Logger.create('AudioSync');

/** Videos above this size are never read whole for sync, whatever their duration. */
const MAX_WHOLE_READ_VIDEO_BYTES = 256 * 1024 * 1024;
const RANGE_READ_CHUNK_SECONDS = 60;
const WAV_RANGE_CHUNK_SECONDS = 10;

export interface SyncSignalProgress {
  phase: 'proxy' | 'reading';
  /** 0..1 within the phase. */
  fraction: number;
}

export interface SyncSignalRequest {
  clip: TimelineClip;
  /** Source seconds covered by the clip. */
  startSeconds: number;
  durationSeconds: number;
  sampleRate: number;
  /** Read only the most active window of this length when the saved waveform can locate it. */
  excerptSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SyncSignalProgress) => void;
}

export interface SyncSignal {
  samples: Float32Array;
  /** Seconds after `startSeconds` where `samples` begins (0 unless an excerpt was read). */
  offsetSeconds: number;
}

/** Source seconds to read: the whole clip range or one excerpt window inside it. */
interface ReadWindow {
  start: number;
  seconds: number;
}

interface AudioSamples {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Adds `buffer` (starting at source second `bufferStart`) into `output`, one
 * bin per output sample: the mono mix's largest-magnitude sample, sign kept.
 * Peak bins survive any decimation in between, so a peak-decimated stem and a
 * full decode of the same audio yield the same signal.
 */
export function accumulatePeakBins(
  buffer: AudioSamples,
  bufferStart: number,
  output: Float32Array,
  outputStart: number,
  outputRate: number,
): void {
  const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
  const scale = 1 / channels.length;
  for (let index = 0; index < buffer.length; index += 1) {
    const bin = Math.floor((bufferStart + index / buffer.sampleRate - outputStart) * outputRate);
    if (bin < 0) continue;
    if (bin >= output.length) break;
    let sample = 0;
    for (const channel of channels) sample += channel[index] ?? 0;
    sample *= scale;
    if (Math.abs(sample) > Math.abs(output[bin])) output[bin] = sample;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Audio sync was cancelled.', 'AbortError');
}

function toSignal(request: SyncSignalRequest, window: ReadWindow, samples: Float32Array): SyncSignal {
  return { samples, offsetSeconds: window.start - request.startSeconds };
}

/** The excerpt window located in the media's saved waveform, or the whole clip range. */
async function resolveReadWindow(mediaFile: MediaFile, request: SyncSignalRequest): Promise<ReadWindow> {
  const whole = { start: request.startSeconds, seconds: request.durationSeconds };
  const refId = mediaFile.audioAnalysisRefs?.waveformPyramidId;
  if (!request.excerptSeconds || request.durationSeconds <= request.excerptSeconds || !refId) return whole;
  try {
    const { loadTimelineWaveformPyramid } = await import('./timelineWaveformPyramidCache');
    const pyramid = await loadTimelineWaveformPyramid(refId);
    const curve = pyramid ? energyCurveFromPyramid(pyramid) : null;
    const start = curve
      ? chooseExcerptWindow(curve, request.startSeconds, request.durationSeconds, request.excerptSeconds)
      : null;
    return start === null ? whole : { start, seconds: request.excerptSeconds };
  } catch (error) {
    log.debug('Saved waveform cannot locate a sync excerpt; reading the whole clip', { mediaFileId: mediaFile.id, error });
    return whole;
  }
}

async function signalFromPcmWavPeaks(file: Blob, info: PcmWavInfo, request: SyncSignalRequest): Promise<SyncSignal> {
  const peaks = await buildPeakDecimatedAudioBuffer(file, info, {
    signal: request.signal,
    onProgress: (fraction) => request.onProgress?.({ phase: 'reading', fraction }),
  });
  const output = new Float32Array(Math.max(0, Math.floor(request.durationSeconds * request.sampleRate)));
  accumulatePeakBins(peaks, 0, output, request.startSeconds, request.sampleRate);
  return { samples: output, offsetSeconds: 0 };
}

/** Byte-range reads of one window of a PCM WAV; nothing outside it is touched. */
async function signalFromPcmWavRange(file: Blob, info: PcmWavInfo, window: ReadWindow, request: SyncSignalRequest): Promise<Float32Array> {
  const output = new Float32Array(Math.max(0, Math.floor(window.seconds * request.sampleRate)));
  const startFrame = Math.max(0, Math.floor(window.start * info.sampleRate));
  const endFrame = Math.min(info.frames, Math.ceil((window.start + window.seconds) * info.sampleRate));
  const chunkFrames = Math.max(1, Math.round(WAV_RANGE_CHUNK_SECONDS * info.sampleRate));
  const bytesPerSample = info.bitsPerSample / 8;
  for (let frame = startFrame; frame < endFrame; frame += chunkFrames) {
    throwIfAborted(request.signal);
    const frames = Math.min(chunkFrames, endFrame - frame);
    const byteStart = info.dataOffset + frame * info.blockAlign;
    const view = new DataView(await readBlobAsArrayBuffer(file.slice(byteStart, byteStart + frames * info.blockAlign)));
    const readable = Math.min(frames, Math.floor(view.byteLength / info.blockAlign));
    const channels = Array.from({ length: info.channels }, () => new Float32Array(readable));
    for (let index = 0; index < readable; index += 1) {
      for (let channel = 0; channel < info.channels; channel += 1) {
        channels[channel][index] = readPcmSample(view, index * info.blockAlign + channel * bytesPerSample, info);
      }
    }
    accumulatePeakBins({
      sampleRate: info.sampleRate,
      numberOfChannels: info.channels,
      length: readable,
      getChannelData: (channel) => channels[channel],
    }, frame / info.sampleRate, output, window.start, request.sampleRate);
    request.onProgress?.({ phase: 'reading', fraction: (frame + frames - startFrame) / Math.max(1, endFrame - startFrame) });
  }
  return output;
}

async function signalFromPcmWav(file: Blob, mediaFile: MediaFile, request: SyncSignalRequest): Promise<SyncSignal | null> {
  const info = await readPcmWavInfo(file).catch(() => null);
  if (!info) return null;
  const window = await resolveReadWindow(mediaFile, request);
  if (window.seconds < request.durationSeconds) {
    return toSignal(request, window, await signalFromPcmWavRange(file, info, window, request));
  }
  return signalFromPcmWavPeaks(file, info, request);
}

async function signalFromRangeReads(file: File, mediaFile: MediaFile, request: SyncSignalRequest): Promise<SyncSignal> {
  const window = await resolveReadWindow(mediaFile, request);
  const { MediaAudioRangeReader } = await import('../../engine/audio/exportPipeline/MediaAudioRangeReader');
  const reader = new MediaAudioRangeReader(file);
  const output = new Float32Array(Math.max(0, Math.floor(window.seconds * request.sampleRate)));
  const end = window.start + window.seconds;
  try {
    for (let start = window.start; start < end; start += RANGE_READ_CHUNK_SECONDS) {
      throwIfAborted(request.signal);
      const chunkEnd = Math.min(end, start + RANGE_READ_CHUNK_SECONDS);
      accumulatePeakBins(await reader.read(start, chunkEnd), start, output, window.start, request.sampleRate);
      request.onProgress?.({ phase: 'reading', fraction: (chunkEnd - window.start) / window.seconds });
    }
  } finally {
    reader.dispose();
  }
  return toSignal(request, window, output);
}

async function readAudioProxy(mediaFile: MediaFile): Promise<Blob | null> {
  const { readStoredAudioProxyFile } = await import('./AudioProxyService');
  return readStoredAudioProxyFile(mediaFile);
}

/** The camera's WAV audio proxy, extracted first when it does not exist yet. */
async function ensureAudioProxy(mediaFileId: string, request: SyncSignalRequest): Promise<Blob | null> {
  const current = () => useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  const existing = current();
  if (!existing) return null;
  if (existing.hasProxyAudio || existing.audioProxyStatus === 'ready') {
    const proxy = await readAudioProxy(existing);
    if (proxy) return proxy;
  }
  const unsubscribe = useMediaStore.subscribe((state) => {
    const file = state.files.find((candidate) => candidate.id === mediaFileId);
    if (file?.audioProxyStatus === 'generating') {
      request.onProgress?.({ phase: 'proxy', fraction: Math.min(1, (file.audioProxyProgress ?? 0) / 100) });
    }
  });
  try {
    await useMediaStore.getState().generateAudioProxy(mediaFileId);
  } finally {
    unsubscribe();
  }
  throwIfAborted(request.signal);
  const generated = current();
  return generated?.hasProxyAudio || generated?.audioProxyStatus === 'ready' ? readAudioProxy(generated) : null;
}

function isWholeReadAffordable(mediaFile: MediaFile, file: File): boolean {
  if (mediaFile.type === 'video' && file.size > MAX_WHOLE_READ_VIDEO_BYTES) return false;
  return estimateDecodedSourceAudioBytes(mediaFile.duration, 48_000) <= MAX_DECODED_SOURCE_AUDIO_BYTES;
}

/**
 * Streamed sync signal for long or large sources, or null when the source is
 * small enough for the regular whole-buffer decode.
 */
export async function loadStreamedSyncSignal(request: SyncSignalRequest): Promise<SyncSignal | null> {
  const mediaFileId = request.clip.source?.mediaFileId ?? request.clip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)
    : undefined;
  const file = mediaFile?.file ?? request.clip.file;
  if (!mediaFile || !file || request.clip.isComposition) return null;

  if (mediaFile.type === 'audio') {
    const info = await readPcmWavInfo(file).catch(() => null);
    if (info && isLongPcmWav(info)) return signalFromPcmWav(file, mediaFile, request);
    return isWholeReadAffordable(mediaFile, file) ? null : signalFromRangeReads(file, mediaFile, request);
  }
  if (isWholeReadAffordable(mediaFile, file)) return null;

  const { isIsobmffFileName } = await import('../mediaMetadata/isobmffMetadata');
  if (isIsobmffFileName(file.name)) return signalFromRangeReads(file, mediaFile, request);

  // MXF and other containers the browser cannot open: their audio is the WAV proxy.
  const proxy = await ensureAudioProxy(mediaFile.id, request);
  if (!proxy) throw new Error(`No readable audio for ${mediaFile.name}: the audio proxy could not be created.`);
  const signal = await signalFromPcmWav(proxy, mediaFile, request);
  if (!signal) throw new Error(`The audio proxy of ${mediaFile.name} is not a PCM WAV.`);
  return signal;
}
