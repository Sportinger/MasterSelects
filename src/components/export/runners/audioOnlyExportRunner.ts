import {
  AudioExportPipeline,
  encodeAudioBufferToWavBlob,
} from '../../../engine/audio';
import type { ExportProgress, VideoCodec, ContainerFormat } from '../../../engine/export';
import {
  canRetainExportRunJob,
  createExportRunId,
  releaseExportRunResources,
  reportExportRunJob,
} from '../../../services/timeline/exportRuntimeReporting';
import type { EncoderType } from '../useExportState';

export interface AudioOnlyExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  filename: string;
  encoder: EncoderType;
  videoCodec: VideoCodec;
  containerFormat: ContainerFormat;
  bitrate: number;
  audioOnlyFormat: 'wav' | 'browser';
  audioSampleRate: 44100 | 48000;
  audioBitrate: number;
  normalizeAudio: boolean;
  audioPipelineRef: { current: AudioExportPipeline | null };
  onProgress: (progress: ExportProgress) => void;
  onTimelineStart: (startTime: number, endTime: number) => void;
  onTimelineProgress: (percent: number, time: number) => void;
}

export type AudioOnlyExportRunnerResult =
  | { kind: 'download'; blob: Blob; filename: string }
  | { kind: 'error'; message: string };

export async function runAudioOnlyExport(
  input: AudioOnlyExportRunnerInput,
): Promise<AudioOnlyExportRunnerResult> {
  const exportRunId = createExportRunId();
  const runJobReport = {
    runId: exportRunId,
    settings: {
      width: input.width,
      height: input.height,
      fps: input.fps,
      codec: input.videoCodec,
      container: input.containerFormat,
      bitrate: input.bitrate,
      startTime: input.startTime,
      endTime: input.endTime,
      includeAudio: true,
      audioSampleRate: input.audioSampleRate,
      audioBitrate: input.audioBitrate,
      normalizeAudio: input.normalizeAudio,
      exportMode: input.encoder === 'htmlvideo' ? 'precise' as const : 'fast' as const,
      filename: input.filename,
    },
    startedAtMs: Date.now(),
    exportMode: 'audio-only',
    requestedAudio: true,
    effectiveAudio: true,
  };
  const runAdmission = canRetainExportRunJob(runJobReport);
  if (!runAdmission.admitted) {
    return {
      kind: 'error',
      message: `Audio export denied by runtime admission: ${runAdmission.reason ?? 'unknown'}`,
    };
  }

  input.onProgress({
    phase: 'audio',
    currentFrame: 0,
    totalFrames: 0,
    percent: 0,
    estimatedTimeRemaining: 0,
    currentTime: input.startTime,
    audioPhase: 'extracting',
    audioPercent: 0,
  });

  // Audio-only export deliberately has no engine render session.
  const audioPipeline = new AudioExportPipeline({
    sampleRate: input.audioSampleRate,
    bitrate: input.audioBitrate,
    normalize: input.normalizeAudio,
  }, {
    exportRunId,
  });
  input.audioPipelineRef.current = audioPipeline;

  try {
    reportExportRunJob(runJobReport);
    input.onTimelineStart(input.startTime, input.endTime);

    if (input.audioOnlyFormat === 'wav') {
      const audioBuffer = await audioPipeline.exportRawAudio(
        input.startTime,
        input.endTime,
        (audioProgress) => {
          reportAudioProgress(input, audioProgress);
        },
      );

      if (audioBuffer && audioBuffer.length > 0) {
        return {
          kind: 'download',
          blob: encodeAudioBufferToWavBlob(audioBuffer),
          filename: `${input.filename}.wav`,
        };
      }

      return {
        kind: 'error',
        message: 'No audio clips found in the selected range',
      };
    }

    const audioResult = await audioPipeline.exportAudio(
      input.startTime,
      input.endTime,
      (audioProgress) => {
        reportAudioProgress(input, audioProgress);
      },
    );

    if (!audioResult || audioResult.chunks.length === 0) {
      return {
        kind: 'error',
        message: 'No audio clips found in the selected range',
      };
    }

    const audioBlobs: Blob[] = [];
    for (const chunk of audioResult.chunks) {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      audioBlobs.push(new Blob([buffer]));
    }

    const mimeType = audioResult.codec === 'opus' ? 'audio/ogg' : 'audio/aac';
    const extension = audioResult.codec === 'opus' ? 'ogg' : 'aac';
    return {
      kind: 'download',
      blob: new Blob(audioBlobs, { type: mimeType }),
      filename: `${input.filename}.${extension}`,
    };
  } finally {
    input.audioPipelineRef.current = null;
    releaseExportRunResources(exportRunId);
  }
}

function reportAudioProgress(
  input: AudioOnlyExportRunnerInput,
  audioProgress: {
    phase: NonNullable<ExportProgress['audioPhase']>;
    percent: number;
  },
): void {
  input.onProgress({
    phase: 'audio',
    currentFrame: 0,
    totalFrames: 0,
    percent: audioProgress.percent,
    estimatedTimeRemaining: 0,
    currentTime: input.endTime,
    audioPhase: audioProgress.phase,
    audioPercent: audioProgress.percent,
  });
  input.onTimelineProgress(audioProgress.percent, input.endTime);
}
