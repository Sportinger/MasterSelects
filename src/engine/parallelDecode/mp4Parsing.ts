/**
 * MP4 demux support for parallel decode: MP4Box parsing of track info and
 * samples, plus EncodedVideoChunk construction from extracted samples.
 *
 * Decoder lifecycle calls (configure/reset/close) intentionally live in
 * ParallelDecodeManager — this module owns no decoder or frame handles.
 */

import { Logger } from '../../services/logger';
const log = Logger.create('ParallelDecode');

import * as MP4BoxModule from 'mp4box';
import {
  createBaseDecoderConfig,
  extractCodecDescription,
  getCodecString,
  type MP4DataStreamConstructor,
  type MP4TrackDetails,
  type MP4VideoTrack,
} from './decoderConfig';
import type { ParallelDecodeClipInfo as ClipInfo } from './clipWindow';
import { getNormalizedSampleTimestampMicroseconds } from './sampleTiming';

const MP4Box = MP4BoxModule as unknown as {
  createFile: typeof MP4BoxModule.createFile;
  DataStream: MP4DataStreamConstructor;
};

// MP4Box types
interface MP4ArrayBuffer extends ArrayBuffer {
  fileStart: number;
}

export interface ParallelDecodeSample {
  number: number;
  track_id: number;
  data: ArrayBuffer;
  size: number;
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
  timescale: number;
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: unknown, samples: ParallelDecodeSample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: unknown, options: { nbSamples: number }) => void;
  getTrackById: (id: number) => MP4TrackDetails | undefined;
}

export interface ParallelDecodeParseResult {
  videoTrack: MP4VideoTrack;
  baseConfig: VideoDecoderConfig;
  samples: ParallelDecodeSample[];
}

/**
 * Parse MP4 file and extract track info + samples synchronously.
 * onReady MUST be sync — MP4Box calls it during appendBuffer, and an async
 * callback would yield control before setExtractionOptions/start/flush,
 * causing MP4Box to never deliver samples.
 */
export function parseMP4TrackInfo(
  clipInfo: ClipInfo & { fileData: ArrayBuffer }
): Promise<ParallelDecodeParseResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`MP4 parsing timeout for clip "${clipInfo.clipName}"`));
    }, 5000);

    const mp4File = MP4Box.createFile() as unknown as MP4File;
    const collectedSamples: ParallelDecodeSample[] = [];

    // SYNC onReady — no await allowed here!
    mp4File.onReady = (info) => {
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        clearTimeout(timeout);
        reject(new Error(`No video track in clip "${clipInfo.clipName}"`));
        return;
      }

      // Build codec config
      const codec = getCodecString(videoTrack);
      let description: ArrayBuffer | undefined;

      try {
        const trak = mp4File.getTrackById(videoTrack.id);
        description = extractCodecDescription(trak, MP4Box.DataStream);
      } catch (e) {
        log.warn(`Failed to extract codec description for ${clipInfo.clipName}: ${e}`);
      }

      const baseConfig = createBaseDecoderConfig(videoTrack, description);

      // Start sample extraction SYNCHRONOUSLY before appendBuffer returns
      mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity });
      mp4File.start();

      // Resolve will happen after appendBuffer+flush complete (samples collected via onSamples)
      // Use setTimeout(0) to resolve after the synchronous appendBuffer+flush chain completes
      setTimeout(() => {
        clearTimeout(timeout);
        log.info(`"${clipInfo.clipName}" parsed: ${codec} ${videoTrack.video.width}x${videoTrack.video.height}, ${collectedSamples.length} samples`);
        resolve({ videoTrack, baseConfig, samples: collectedSamples });
      }, 0);
    };

    mp4File.onSamples = (_trackId, _ref, newSamples) => {
      collectedSamples.push(...newSamples);
    };

    mp4File.onError = (e) => {
      clearTimeout(timeout);
      reject(new Error(`MP4 parsing error for "${clipInfo.clipName}": ${e}`));
    };

    // Feed entire buffer — onReady fires sync during appendBuffer,
    // which sets up extraction before flush() signals end-of-data
    const mp4Buffer = clipInfo.fileData as MP4ArrayBuffer;
    mp4Buffer.fileStart = 0;
    try {
      mp4File.appendBuffer(mp4Buffer);
      mp4File.flush();
    } catch (e) {
      clearTimeout(timeout);
      reject(new Error(`MP4Box appendBuffer failed for "${clipInfo.clipName}": ${e}`));
    }
  });
}

/**
 * Build an EncodedVideoChunk for a sample with normalized presentation timing.
 */
export function createEncodedChunkForSample(
  sample: ParallelDecodeSample,
  presentationOffsetSeconds: number,
  type: EncodedVideoChunkType
): EncodedVideoChunk {
  return new EncodedVideoChunk({
    type,
    timestamp: getNormalizedSampleTimestampMicroseconds(sample, presentationOffsetSeconds),
    duration: (sample.duration * 1_000_000) / sample.timescale,
    data: sample.data,
  });
}
