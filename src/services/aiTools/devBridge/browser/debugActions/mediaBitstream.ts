import { useMediaStore } from '../../../../../stores/mediaStore';
import { loadProxyVideoWithMP4Box } from '../../../../proxyGeneration/mp4Demuxer';
import type { Sample } from '../../../../../engine/webCodecsTypes';
import { getVideoTrackRotation } from '../../../../../engine/webcodecs/videoTrackOrientation';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeWindow(samples: Sample[], centerSeconds: number, radiusSeconds: number) {
  const selected = samples.filter((sample) => {
    const presentationSeconds = sample.cts / sample.timescale;
    return Math.abs(presentationSeconds - centerSeconds) <= radiusSeconds;
  });
  const sizes = selected.map((sample) => sample.size);
  const durationsMs = selected.map((sample) => (sample.duration * 1000) / sample.timescale);
  const reorderOffsetsMs = selected.map((sample) => ((sample.cts - sample.dts) * 1000) / sample.timescale);
  const firstIndex = selected.length > 0 ? samples.indexOf(selected[0]) : -1;
  let previousKeyframeIndex = firstIndex;
  while (previousKeyframeIndex > 0 && !samples[previousKeyframeIndex].is_sync) {
    previousKeyframeIndex -= 1;
  }

  return {
    centerSeconds,
    radiusSeconds,
    frameCount: selected.length,
    totalBytes: sizes.reduce((sum, value) => sum + value, 0),
    averageFrameBytes: round(sizes.reduce((sum, value) => sum + value, 0) / Math.max(1, sizes.length), 1),
    p95FrameBytes: percentile(sizes, 0.95),
    maxFrameBytes: Math.max(0, ...sizes),
    keyframeCount: selected.filter((sample) => sample.is_sync).length,
    framesSincePreviousKeyframe: firstIndex >= 0 ? firstIndex - previousKeyframeIndex : null,
    averageDurationMs: round(
      durationsMs.reduce((sum, value) => sum + value, 0) / Math.max(1, durationsMs.length),
    ),
    maxReorderOffsetMs: round(Math.max(0, ...reorderOffsetsMs.map(Math.abs))),
    sampleSizes: selected.map((sample) => ({
      timeSeconds: round(sample.cts / sample.timescale),
      decodeSeconds: round(sample.dts / sample.timescale),
      bytes: sample.size,
      keyframe: sample.is_sync,
    })),
  };
}

export async function probeMediaBitstream(args: Record<string, unknown> = {}) {
  const mediaId = typeof args.mediaId === 'string' ? args.mediaId : '';
  const media = useMediaStore.getState().files.find((entry) => entry.id === mediaId);
  if (!media || media.type !== 'video') {
    return { success: false, error: `Video media not found: ${mediaId}` };
  }

  let sourceFile = media.file;
  if (!sourceFile) {
    const response = await fetch(media.url);
    if (!response.ok) {
      return { success: false, error: `Could not load media URL (${response.status})` };
    }
    sourceFile = new File([await response.blob()], media.name, { type: 'video/mp4' });
  }

  const loaded = await loadProxyVideoWithMP4Box(sourceFile, silentLogger);
  if (!loaded) {
    return { success: false, error: 'Could not demux video for bitstream probe' };
  }

  const centers = Array.isArray(args.centers)
    ? args.centers.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [0];
  const radiusSeconds = typeof args.radiusSeconds === 'number' && Number.isFinite(args.radiusSeconds)
    ? Math.max(0.1, Math.min(10, args.radiusSeconds))
    : 1;
  const keyframeIndices = loaded.samples
    .map((sample, index) => sample.is_sync ? index : -1)
    .filter((index) => index >= 0);
  const keyframeDistances = keyframeIndices
    .slice(1)
    .map((index, position) => index - keyframeIndices[position]);
  const sampleSizes = loaded.samples.map((sample) => sample.size);

  return {
    success: true,
    data: {
      media: {
        id: media.id,
        name: media.name,
        bytes: sourceFile.size,
        codec: loaded.videoTrack.codec,
        width: loaded.videoTrack.video.width,
        height: loaded.videoTrack.video.height,
        displayWidth: loaded.videoTrack.track_width ?? loaded.videoTrack.video.width,
        displayHeight: loaded.videoTrack.track_height ?? loaded.videoTrack.video.height,
        rotationDegrees: getVideoTrackRotation(loaded.videoTrack),
        durationSeconds: round(loaded.duration),
        frameRate: round(loaded.proxyFps),
        sampleCount: loaded.samples.length,
      },
      global: {
        keyframeCount: keyframeIndices.length,
        medianKeyframeDistanceFrames: percentile(keyframeDistances, 0.5),
        p95KeyframeDistanceFrames: percentile(keyframeDistances, 0.95),
        maxKeyframeDistanceFrames: Math.max(0, ...keyframeDistances),
        averageFrameBytes: round(
          sampleSizes.reduce((sum, value) => sum + value, 0) / Math.max(1, sampleSizes.length),
          1,
        ),
        p95FrameBytes: percentile(sampleSizes, 0.95),
        maxFrameBytes: Math.max(0, ...sampleSizes),
      },
      windows: centers.map((centerSeconds) =>
        summarizeWindow(loaded.samples, centerSeconds, radiusSeconds)
      ),
    },
  };
}
