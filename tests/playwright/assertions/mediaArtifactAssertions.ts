import { stat } from 'node:fs/promises';
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';

export interface MediaArtifactMetadata {
  path: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds: number;
  videoTracks: Array<{
    codec: string | null;
    width: number;
    height: number;
    packetCount: number;
    averagePacketRate: number;
    averageBitrate: number;
  }>;
  audioTracks: Array<{
    codec: string | null;
    sampleRate: number;
    channels: number;
    packetCount: number;
    averagePacketRate: number;
    averageBitrate: number;
  }>;
}

export interface GoldenVideoExpectation {
  width: number;
  height: number;
  durationSeconds: number;
  durationToleranceSeconds?: number;
  requireAudio?: boolean;
  minimumSizeBytes?: number;
}

export async function inspectMediaArtifact(path: string): Promise<MediaArtifactMetadata> {
  const file = await stat(path);
  const input = new Input({
    source: new FilePathSource(path),
    formats: ALL_FORMATS,
  });

  try {
    const [mimeType, durationSeconds, videoTracks, audioTracks] = await Promise.all([
      input.getMimeType(),
      input.computeDuration(),
      input.getVideoTracks(),
      input.getAudioTracks(),
    ]);

    const inspectedVideoTracks = await Promise.all(videoTracks.map(async (track) => ({
      codec: track.codec,
      width: track.displayWidth,
      height: track.displayHeight,
      ...await track.computePacketStats(),
    })));
    const inspectedAudioTracks = await Promise.all(audioTracks.map(async (track) => ({
      codec: track.codec,
      sampleRate: track.sampleRate,
      channels: track.numberOfChannels,
      ...await track.computePacketStats(),
    })));

    return {
      path,
      sizeBytes: file.size,
      mimeType,
      durationSeconds,
      videoTracks: inspectedVideoTracks,
      audioTracks: inspectedAudioTracks,
    };
  } finally {
    input.dispose();
  }
}

export function assertGoldenVideoArtifact(
  metadata: MediaArtifactMetadata,
  expectation: GoldenVideoExpectation,
): void {
  const minimumSizeBytes = expectation.minimumSizeBytes ?? 1_024;
  const durationToleranceSeconds = expectation.durationToleranceSeconds ?? 0.35;
  const primaryVideo = metadata.videoTracks[0];

  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) {
    throw new Error(`Export artifact has an invalid duration: ${metadata.durationSeconds}.`);
  }

  if (metadata.sizeBytes < minimumSizeBytes) {
    throw new Error(
      `Export artifact is unexpectedly small: ${metadata.sizeBytes} B < ${minimumSizeBytes} B.`,
    );
  }
  if (!metadata.mimeType.startsWith('video/')) {
    throw new Error(`Export artifact is not a video: ${metadata.mimeType}.`);
  }
  if (!primaryVideo) {
    throw new Error('Export artifact has no video track.');
  }
  if (!primaryVideo.codec) {
    throw new Error('Export artifact has an unknown video codec.');
  }
  if (primaryVideo.packetCount <= 0 || primaryVideo.averageBitrate <= 0) {
    throw new Error('Export artifact video track has no inspectable encoded payload.');
  }
  if (primaryVideo.width !== expectation.width || primaryVideo.height !== expectation.height) {
    throw new Error(
      `Unexpected export resolution ${primaryVideo.width}x${primaryVideo.height}; `
        + `expected ${expectation.width}x${expectation.height}.`,
    );
  }
  if (Math.abs(metadata.durationSeconds - expectation.durationSeconds) > durationToleranceSeconds) {
    throw new Error(
      `Unexpected export duration ${metadata.durationSeconds.toFixed(3)}s; `
        + `expected ${expectation.durationSeconds.toFixed(3)}s +/-${durationToleranceSeconds.toFixed(3)}s.`,
    );
  }
  if (expectation.requireAudio !== false && metadata.audioTracks.length === 0) {
    throw new Error('Export artifact has no audio track.');
  }
  if (expectation.requireAudio !== false) {
    const primaryAudio = metadata.audioTracks[0];
    if (!primaryAudio.codec || primaryAudio.packetCount <= 0 || primaryAudio.averageBitrate <= 0) {
      throw new Error('Export artifact audio track has no known codec or encoded payload.');
    }
  }
}
