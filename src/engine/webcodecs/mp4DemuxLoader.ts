import * as MP4BoxModule from 'mp4box';

import type { Sample, MP4VideoTrack, MP4ArrayBuffer, MP4File } from '../webCodecsTypes';
import {
  EMPTY_SAMPLE_DATA,
  FileSampleData,
  type FileSampleDataOptions,
  StreamedMp4UnsupportedError,
  scanMp4TopLevelBoxes,
} from './fileSampleData';

type LoaderLog = {
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  time: (label: string) => () => void;
};

const MP4Box = MP4BoxModule as unknown as {
  createFile: typeof MP4BoxModule.createFile;
  DataStream: {
    new (buffer?: unknown, byteOffset?: number, endianness?: number): {
      buffer: ArrayBuffer;
      position?: number;
    };
    BIG_ENDIAN: number;
  };
};

interface CodecConfigurationBox {
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

interface MP4TrackDetails {
  mdia?: {
    minf?: {
      stbl?: {
        stsd?: {
          entries?: Array<{
            avcC?: CodecConfigurationBox;
            hvcC?: CodecConfigurationBox;
            vpcC?: CodecConfigurationBox;
            av1C?: CodecConfigurationBox;
          }>;
        };
      };
    };
  };
}

type MP4FileWithTrackLookup = MP4File & {
  getTrackById: (id: number) => MP4TrackDetails | undefined;
};

export interface Mp4TrackLoadResult {
  videoTrack: MP4VideoTrack;
  codecConfig: VideoDecoderConfig;
  width: number;
  height: number;
  frameRate: number;
  frameInterval: number;
}

export interface Mp4DemuxLoaderCallbacks {
  log: LoaderLog;
  hardwareAcceleration?: VideoDecoderConfig['hardwareAcceleration'];
  onMp4FileCreated: (mp4File: MP4File) => void;
  onTrackReady: (result: Mp4TrackLoadResult) => void;
  onSamples: (samples: Sample[]) => void;
  onConfigSupported: () => void;
  onError: (error: Error) => void;
}

export function loadMp4ForWebCodecs(
  buffer: ArrayBuffer,
  callbacks: Mp4DemuxLoaderCallbacks
): Promise<void> {
  const { log } = callbacks;
  const endLoad = log.time('loadArrayBuffer');

  return new Promise((resolve, reject) => {
    log.info(`Parsing MP4 (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)...`);

    // Reduced timeout - we only wait for codec info now, not all samples
    const timeout = setTimeout(() => {
      reject(new Error('MP4 parsing timeout - file may have unsupported metadata'));
    }, 5000);

    const mp4File = MP4Box.createFile() as unknown as MP4File;
    callbacks.onMp4FileCreated(mp4File);
    let resolved = false;

    mp4File.onReady = (info) => {
      log.info(`MP4 onReady: ${info.videoTracks.length} video tracks`);
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        clearTimeout(timeout);
        reject(new Error('No video track found in file'));
        return;
      }

      const track = describeVideoTrack(mp4File, videoTrack, log, callbacks.hardwareAcceleration);
      const { codecConfig, frameRate } = track;
      const codec = codecConfig.codec;
      callbacks.onTrackReady(track);

      // Set extraction options and start BEFORE codec check (to not miss samples)
      mp4File.setExtractionOptions(videoTrack.id, null, {
        nbSamples: Infinity,
      });
      mp4File.start();
      log.debug(`Extraction started for track ${videoTrack.id}`);

      // Check if codec is supported (async, but extraction already started)
      VideoDecoder.isConfigSupported(codecConfig).then((support) => {
        if (!support.supported) {
          clearTimeout(timeout);
          reject(new Error(`Codec ${codec} not supported`));
          return;
        }

        log.debug(`Codec ${codec} supported`, support.config);
        callbacks.onConfigSupported();

        // RESOLVE IMMEDIATELY after decoder is configured - don't wait for samples!
        // Samples will continue loading in background
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          endLoad();
          log.info(
            `Decoder configured: ${videoTrack.video.width}x${videoTrack.video.height} @ ${frameRate.toFixed(1)}fps (samples loading in background)`
          );
          resolve();
        }
      });
    };

    mp4File.onSamples = (_trackId, _ref, samples) => {
      callbacks.onSamples(samples);
    };

    mp4File.onError = (e) => {
      clearTimeout(timeout);
      const error = new Error(`MP4 parsing error: ${e}`);
      callbacks.onError(error);
      reject(error);
    };

    // Feed the buffer to mp4box
    const mp4Buffer = buffer as MP4ArrayBuffer;
    mp4Buffer.fileStart = 0;
    try {
      const appendedBytes = mp4File.appendBuffer(mp4Buffer);
      log.debug(`Appended ${appendedBytes} bytes to MP4Box`);
      mp4File.flush();
      log.debug('Flushed MP4Box, waiting for callbacks...');
    } catch (e) {
      clearTimeout(timeout);
      reject(new Error(`MP4Box appendBuffer failed: ${e}`));
    }
  });
}

const MAX_ON_DEMAND_MOOV_BYTES = 256 * 1024 * 1024;

/**
 * Parses only the ftyp and moov boxes of a file and returns its video samples without their
 * bytes; the returned FileSampleData reads them on demand (see fileSampleData.ts). Fragmented
 * files keep their sample tables in moof boxes and are refused with StreamedMp4UnsupportedError.
 */
export async function loadMp4FileOnDemand(
  file: Blob,
  callbacks: Mp4DemuxLoaderCallbacks,
  options?: FileSampleDataOptions,
): Promise<FileSampleData> {
  const { log } = callbacks;
  const endLoad = log.time('loadMp4FileOnDemand');
  const boxes = await scanMp4TopLevelBoxes(file);
  if (boxes.some((box) => box.type === 'moof')) {
    throw new StreamedMp4UnsupportedError('Fragmented MP4: its sample tables are in moof boxes, not in the moov');
  }
  const moov = boxes.find((box) => box.type === 'moov');
  if (!moov) {
    throw new StreamedMp4UnsupportedError('No moov box found');
  }
  if (moov.size > MAX_ON_DEMAND_MOOV_BYTES) {
    throw new StreamedMp4UnsupportedError(`moov box of ${(moov.size / 1024 / 1024).toFixed(0)}MB is too large`);
  }
  const metadataBoxes = [boxes.find((box) => box.type === 'ftyp'), moov]
    .filter((box): box is NonNullable<typeof box> => Boolean(box));
  const parts = await Promise.all(
    metadataBoxes.map((box) => file.slice(box.start, box.start + box.size).arrayBuffer()),
  );
  const metadata = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let writeAt = 0;
  for (const part of parts) {
    metadata.set(new Uint8Array(part), writeAt);
    writeAt += part.byteLength;
  }
  log.info(`Parsing MP4 metadata (${(moov.size / 1024).toFixed(0)}KB moov of ${(file.size / 1024 / 1024).toFixed(0)}MB), samples read on demand`);

  const mp4File = MP4Box.createFile() as unknown as MP4File;
  callbacks.onMp4FileCreated(mp4File);
  const parsed: { info?: { videoTracks: MP4VideoTrack[] }; error?: string } = {};
  mp4File.onReady = (info) => {
    parsed.info = info;
  };
  mp4File.onError = (error) => {
    parsed.error = String(error);
  };
  const metadataBuffer = metadata.buffer as MP4ArrayBuffer;
  metadataBuffer.fileStart = 0;
  mp4File.appendBuffer(metadataBuffer);
  mp4File.flush();
  if (parsed.error) {
    throw new Error(`MP4 parsing error: ${parsed.error}`);
  }
  const videoTrack = parsed.info?.videoTracks[0];
  if (!videoTrack) {
    throw new Error('No video track found in file');
  }

  const track = describeVideoTrack(mp4File, videoTrack, log, callbacks.hardwareAcceleration);
  const support = await VideoDecoder.isConfigSupported(track.codecConfig);
  if (!support.supported) {
    throw new Error(`Codec ${track.codecConfig.codec} not supported`);
  }
  const table = mp4File.getTrackSamplesInfo?.(videoTrack.id) ?? [];
  if (table.length === 0) {
    throw new StreamedMp4UnsupportedError('The moov box lists no video samples');
  }
  const samples: Sample[] = table.map((sample) => ({
    number: sample.number,
    track_id: sample.track_id,
    data: EMPTY_SAMPLE_DATA,
    size: sample.size,
    cts: sample.cts,
    dts: sample.dts,
    duration: sample.duration,
    is_sync: sample.is_sync,
    timescale: sample.timescale,
    offset: sample.offset,
  }));
  const sampleData = new FileSampleData(file, samples, options);
  // decodeFirstFrame() decodes the first sample as soon as the decoder exists.
  await sampleData.ensure(0, 1);

  callbacks.onTrackReady(track);
  callbacks.onSamples(samples);
  callbacks.onConfigSupported();
  endLoad();
  log.info(
    `Decoder configured: ${track.width}x${track.height} @ ${track.frameRate.toFixed(1)}fps, ${samples.length} samples read on demand`
  );
  return sampleData;
}

function describeVideoTrack(
  mp4File: MP4File,
  videoTrack: MP4VideoTrack,
  log: LoaderLog,
  hardwareAcceleration: VideoDecoderConfig['hardwareAcceleration'] | undefined,
): Mp4TrackLoadResult {
  // Tracks with duration=0 metadata make this Infinity/NaN, which poisons
  // every frame-tolerance computation downstream (export CTS lookups get a
  // zero tolerance and fall into a per-frame decode-restart crawl).
  const rawFrameRate = videoTrack.nb_samples / (videoTrack.duration / videoTrack.timescale);
  const frameRate = Number.isFinite(rawFrameRate) && rawFrameRate > 0 && rawFrameRate <= 480
    ? rawFrameRate
    : 30;
  if (frameRate !== rawFrameRate) {
    log.warn(`Track reports unusable frame rate (${String(rawFrameRate)}); falling back to 30fps`);
  }
  return {
    videoTrack,
    codecConfig: {
      codec: getCodecString(videoTrack),
      codedWidth: videoTrack.video.width,
      codedHeight: videoTrack.video.height,
      // Let the browser choose an available decoder unless the caller requires one.
      hardwareAcceleration: hardwareAcceleration ?? 'no-preference',
      optimizeForLatency: true,
      description: extractCodecDescription(mp4File, videoTrack, log),
    },
    width: videoTrack.video.width,
    height: videoTrack.video.height,
    frameRate,
    frameInterval: 1000 / frameRate,
  };
}

function extractCodecDescription(
  mp4File: MP4File,
  videoTrack: MP4VideoTrack,
  log: LoaderLog
): ArrayBuffer | undefined {
  // Extract codec-specific description (avcC for H.264, hvcC for H.265, etc.)
  // This is REQUIRED for AVC/HEVC to work properly
  try {
    const trak = (mp4File as MP4FileWithTrackLookup).getTrackById(videoTrack.id);
    if (trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]) {
      const entry = trak.mdia.minf.stbl.stsd.entries[0];

      // Try to extract codec-specific configuration
      const configBox = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (configBox) {
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        configBox.write(stream);
        // The write() includes the box header (8 bytes: size + type), we need to skip it
        const description = stream.buffer.slice(8);
        log.debug(
          `Extracted codec description: ${description.byteLength} bytes from ${entry.avcC ? 'avcC' : entry.hvcC ? 'hvcC' : entry.vpcC ? 'vpcC' : 'av1C'}`
        );
        return description;
      }
      log.warn('No codec config box found in sample entry', Object.keys(entry));
    }
  } catch (e) {
    log.warn('Failed to extract codec description', e);
  }
  return undefined;
}

function getCodecString(track: MP4VideoTrack): string {
  const dominated = track.codec;

  // Handle common codecs
  if (dominated.startsWith('avc1') || dominated.startsWith('avc3')) {
    // H.264/AVC
    return dominated;
  } else if (dominated.startsWith('hvc1') || dominated.startsWith('hev1')) {
    // H.265/HEVC
    return dominated;
  } else if (dominated.startsWith('vp09')) {
    // VP9
    return dominated;
  } else if (dominated.startsWith('av01')) {
    // AV1
    return dominated;
  }

  return dominated;
}
