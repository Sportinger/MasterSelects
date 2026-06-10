import * as MP4BoxModule from 'mp4box';
import type { MP4ArrayBuffer, MP4VideoTrack, Sample } from '../../engine/webCodecsTypes';
import { PROXY_FPS, PROXY_MAX_WIDTH } from './constants';
import { ceilFrameCount, getDurationSecondsFromSamples } from './sampleTiming';

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

interface ProxyGenerationLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

interface AVCConfigurationBox {
  AVCProfileIndication: number;
  profile_compatibility: number;
  AVCLevelIndication: number;
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

interface CodecConfigurationBox {
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

interface MP4TrackDetails {
  mdia?: {
    minf?: {
      stbl?: {
        stsd?: {
          entries?: Array<{
            avcC?: AVCConfigurationBox;
            hvcC?: CodecConfigurationBox;
            vpcC?: CodecConfigurationBox;
            av1C?: CodecConfigurationBox;
          }>;
        };
      };
    };
  };
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: unknown, samples: Sample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: unknown, options: { nbSamples: number }) => void;
  getTrackById: (id: number) => MP4TrackDetails | undefined;
}

export interface ProxyVideoLoadResult {
  videoTrack: MP4VideoTrack;
  samples: Sample[];
  codecConfig: VideoDecoderConfig;
  outputWidth: number;
  outputHeight: number;
  duration: number;
  proxyFps: number;
  totalFrames: number;
}

interface ProxyTimingResult {
  duration: number;
  proxyFps: number;
  totalFrames: number;
  sampleCount: number;
  usedSampleDuration: boolean;
}

export async function loadProxyVideoWithMP4Box(
  file: File,
  log: ProxyGenerationLogger
): Promise<ProxyVideoLoadResult | null> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const mp4File = MP4Box.createFile() as unknown as MP4File;
    const samples: Sample[] = [];
    let videoTrack: MP4VideoTrack | null = null;
    let codecConfig: VideoDecoderConfig | null = null;
    let outputWidth = 0;
    let outputHeight = 0;
    let expectedSamples = 0;
    let samplesReady = false;
    let codecReady = false;
    let completed = false;

    const checkComplete = () => {
      if (completed || !codecReady || !samplesReady || !videoTrack || !codecConfig) return;

      completed = true;
      const timing = getProxyTiming(videoTrack, samples, expectedSamples);
      if (timing.totalFrames <= 0 || timing.duration <= 0) {
        log.error('Could not determine proxy duration from track metadata or sample timestamps', {
          samples: samples.length,
          trackDuration: videoTrack.duration,
          timescale: videoTrack.timescale,
        });
        resolve(null);
        return;
      }

      if (timing.usedSampleDuration) {
        log.warn('Video track duration missing; using sample timestamp duration', {
          sampleDuration: Number(timing.duration.toFixed(3)),
          samples: samples.length,
        });
      }

      log.info(`Duration: ${timing.duration.toFixed(3)}s, totalFrames: ${timing.totalFrames}, samples: ${timing.sampleCount}, proxyFps: ${timing.proxyFps.toFixed(2)}`);
      log.info(`Extracted ${samples.length} samples from video`);
      resolve({
        videoTrack,
        samples,
        codecConfig,
        outputWidth,
        outputHeight,
        duration: timing.duration,
        proxyFps: timing.proxyFps,
        totalFrames: timing.totalFrames,
      });
    };

    mp4File.onReady = async (info: { videoTracks: MP4VideoTrack[] }) => {
      if (info.videoTracks.length === 0) {
        resolve(null);
        return;
      }

      videoTrack = info.videoTracks[0];
      expectedSamples = videoTrack.nb_samples;

      let width = videoTrack.video.width;
      let height = videoTrack.video.height;
      if (width > PROXY_MAX_WIDTH) {
        height = Math.round((PROXY_MAX_WIDTH / width) * height);
        width = PROXY_MAX_WIDTH;
      }
      outputWidth = width & ~1;
      outputHeight = height & ~1;

      const trak = mp4File.getTrackById(videoTrack.id);
      const codecString = getCodecString(videoTrack.codec, trak);
      log.debug(`Detected codec: ${codecString}`);

      const description = extractCodecDescription(trak, log);
      codecConfig = await findSupportedCodec(codecString, videoTrack.video.width, videoTrack.video.height, log, description);
      if (!codecConfig) {
        resolve(null);
        return;
      }

      codecReady = true;
      mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity });
      mp4File.start();
      mp4File.flush();
      checkComplete();
    };

    mp4File.onSamples = (_trackId: number, _ref: unknown, newSamples: Sample[]) => {
      samples.push(...newSamples);
      if (samples.length >= expectedSamples) {
        samplesReady = true;
        checkComplete();
      }
    };

    mp4File.onError = (error: string) => {
      log.error('MP4Box error', error);
      resolve(null);
    };

    const fileData = await file.arrayBuffer();

    try {
      const buffer1 = fileData.slice(0) as MP4ArrayBuffer;
      buffer1.fileStart = 0;
      mp4File.appendBuffer(buffer1);
      mp4File.flush();

      const maxCodecWait = 3000;
      const pollStart = performance.now();
      while (!codecReady && performance.now() - pollStart < maxCodecWait) {
        await new Promise(r => setTimeout(r, 20));
      }

      if (!codecReady) {
        log.warn('Codec not ready after polling');
        resolve(null);
        return;
      }

      if (samples.length === 0) {
        const buffer2 = fileData.slice(0) as MP4ArrayBuffer;
        buffer2.fileStart = 0;
        mp4File.appendBuffer(buffer2);
        mp4File.flush();
      }

      const maxSampleWait = 3000;
      const samplePollStart = performance.now();
      while (!samplesReady && performance.now() - samplePollStart < maxSampleWait) {
        if (samples.length > 0 && samples.length >= expectedSamples) {
          samplesReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 20));
      }

      if (!samplesReady && samples.length > 0) {
        samplesReady = true;
      }

      if (samplesReady) {
        checkComplete();
      } else {
        log.error('No samples extracted');
        resolve(null);
      }
    } catch (e) {
      log.error('File read error', e);
      resolve(null);
    }
  });
}

function getProxyTiming(
  videoTrack: MP4VideoTrack,
  samples: Sample[],
  expectedSamples: number
): ProxyTimingResult {
  const trackDuration = videoTrack.timescale > 0
    ? videoTrack.duration / videoTrack.timescale
    : 0;
  const sampleDuration = getDurationSecondsFromSamples(samples);
  const duration = trackDuration > 0 ? trackDuration : sampleDuration;
  const sampleCount = expectedSamples > 0 ? expectedSamples : samples.length;
  const sourceFps = duration > 0 && sampleCount > 0 ? sampleCount / duration : PROXY_FPS;
  const proxyFps = Number.isFinite(sourceFps) && sourceFps > 0
    ? Math.min(PROXY_FPS, Math.round(sourceFps * 100) / 100)
    : PROXY_FPS;

  return {
    duration,
    proxyFps,
    totalFrames: duration > 0 ? ceilFrameCount(duration * proxyFps) : 0,
    sampleCount,
    usedSampleDuration: trackDuration <= 0 && sampleDuration > 0,
  };
}

function extractCodecDescription(
  trak: MP4TrackDetails | undefined,
  log: ProxyGenerationLogger
): Uint8Array | undefined {
  const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  if (!entry) return undefined;

  const candidates: Array<[string, CodecConfigurationBox | undefined]> = [
    ['avcC', entry.avcC],
    ['hvcC', entry.hvcC],
    ['vpcC', entry.vpcC],
    ['av1C', entry.av1C],
  ];
  const match = candidates.find(([, box]) => Boolean(box));

  if (!match) {
    log.warn('No codec config box found in sample entry', Object.keys(entry));
    return undefined;
  }

  const [boxName, configBox] = match;
  if (!configBox) return undefined;

  try {
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    configBox.write(stream);
    const totalWritten = stream.position || stream.buffer.byteLength;
    if (totalWritten <= 8) {
      log.warn(`Codec config box ${boxName} did not contain a payload`);
      return undefined;
    }

    const description = new Uint8Array(stream.buffer.slice(8, totalWritten));
    log.debug(`Got ${boxName} description: ${description.byteLength} bytes`);
    return description;
  } catch (error) {
    log.warn(`Failed to extract ${boxName} codec description`, error);
    return undefined;
  }
}

function getCodecString(codec: string, trak: MP4TrackDetails | undefined): string {
  if (codec.startsWith('avc1')) {
    const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
    if (avcC) {
      const profile = avcC.AVCProfileIndication.toString(16).padStart(2, '0');
      const compat = avcC.profile_compatibility.toString(16).padStart(2, '0');
      const level = avcC.AVCLevelIndication.toString(16).padStart(2, '0');
      return `avc1.${profile}${compat}${level}`;
    }
    return 'avc1.640028';
  }
  return codec;
}

async function findSupportedCodec(
  baseCodec: string,
  width: number,
  height: number,
  log: ProxyGenerationLogger,
  description?: Uint8Array
): Promise<VideoDecoderConfig | null> {
  const h264Fallbacks = [
    baseCodec,
    'avc1.42001e', 'avc1.4d001e', 'avc1.64001e',
    'avc1.640028', 'avc1.4d0028', 'avc1.42E01E',
    'avc1.4D401E', 'avc1.640029',
  ];

  const codecsToTry = baseCodec.startsWith('avc1') ? h264Fallbacks : [baseCodec];

  for (const codec of codecsToTry) {
    const config: VideoDecoderConfig = {
      codec,
      codedWidth: width,
      codedHeight: height,
      hardwareAcceleration: 'prefer-hardware',
      ...(description && { description }),
    };

    try {
      const support = await VideoDecoder.isConfigSupported(config);
      if (support.supported) {
        log.debug(`Decoder codec ${codec}: supported`);
        return config;
      }
    } catch {
      // Try next
    }
  }

  log.warn(`No supported decoder codec found for ${baseCodec}`);
  return null;
}
