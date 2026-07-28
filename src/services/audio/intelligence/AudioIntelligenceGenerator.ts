import { sha256ArrayBuffer } from '../../../artifacts';
import type { JsonValue, SignalMetadata } from '../../../signals';
import {
  createAudioAnalysisCacheKey,
  createAudioAnalysisManifestRefFromArtifact,
  isAudioAnalysisArtifactStaleForInput,
  type AudioAnalysisManifestRef,
} from '../audioAnalysisManifestKeys';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import type {
  AudioAnalysisArtifact,
  AudioChannelLayout,
} from '../audioArtifactTypes';
import {
  AUDIO_SPAN_LIST_PAYLOAD_VERSION,
  VOICE_ACTIVITY_MANIFEST_VERSION,
  createVoiceActivityManifest,
  encodeAudioSpanListPayload,
  spansToFloat32,
  type AudioSpan,
  type VoiceActivityConfig,
} from '../voiceActivityManifest';
import { resampleAudioBuffer } from '../audioResample';
import {
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AudioIntelligenceError,
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  isAudioIntelligenceCancellation,
  type AudioIntelligenceFeature,
  type AudioIntelligenceStageProgress,
  type AudioIntelligenceVadJobOutput,
} from './audioIntelligenceTypes';
import { requireAudioIntelligenceModel } from './audioIntelligenceModelCatalog';

export const AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION =
  'masterselects.audio-intelligence.vad@1.0.0+silero-v5.1.2';
export const AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.audio-span-list';

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export interface AudioIntelligenceRuntimeLike {
  runVad(
    pcm: Float32Array,
    config: VoiceActivityConfig,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: AudioIntelligenceStageProgress) => void;
    },
  ): Promise<AudioIntelligenceVadJobOutput>;
}

export interface AudioIntelligenceGeneratorOptions {
  artifactStore: AudioArtifactStore;
  runtime: AudioIntelligenceRuntimeLike;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface AudioIntelligenceRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  features: ReadonlySet<AudioIntelligenceFeature>;
  vadConfig?: Partial<VoiceActivityConfig>;
  clipAudioStateHash?: string;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface AudioIntelligenceResult {
  jobId: string;
  artifacts: { voiceActivity?: AudioAnalysisArtifact };
  refs: { voiceActivity?: AudioAnalysisManifestRef };
  skipped: AudioIntelligenceFeature[];
  deferred: AudioIntelligenceFeature[];
}

export interface AudioIntelligenceGenerateOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioIntelligenceStageProgress) => void;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultJobId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `audio-intelligence:${randomId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): AudioIntelligenceError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new AudioIntelligenceError(`Audio intelligence ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    recoverable: true,
  });
}

function throwIfCancelled(signal: AbortSignal | undefined, jobId: string): void {
  if (signal?.aborted) {
    throw cancelledError(jobId, getAbortReason(signal));
  }
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function describeAnalysisChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function validateAudioBuffer(buffer: AudioBuffer): void {
  if (!buffer || typeof buffer !== 'object'
    || !Number.isInteger(buffer.numberOfChannels)
    || buffer.numberOfChannels < 1
    || !Number.isInteger(buffer.length)
    || buffer.length < 0
    || !finiteNumber(buffer.sampleRate)
    || buffer.sampleRate <= 0
    || !finiteNumber(buffer.duration)
    || buffer.duration < 0
    || typeof buffer.getChannelData !== 'function'
  ) {
    throw new AudioIntelligenceError('Audio intelligence requires a valid AudioBuffer.', {
      code: 'invalid-audio-buffer',
      recoverable: false,
    });
  }
}

function summarizeSpans(spans: readonly AudioSpan[], duration: number) {
  const speechSeconds = spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);
  return {
    speechSeconds,
    speechRatio: duration > 0 ? Math.min(1, speechSeconds / duration) : 0,
    segmentCount: spans.length,
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createAudioIntelligenceVadAnalyzerVersion(
  config: VoiceActivityConfig,
  baseVersion = AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION,
): string {
  const model = requireAudioIntelligenceModel('silero-vad');
  return [
    baseVersion,
    `manifest=v${VOICE_ACTIVITY_MANIFEST_VERSION}`,
    `payload=v${AUDIO_SPAN_LIST_PAYLOAD_VERSION}`,
    `model=${model.id}@${model.version}`,
    `threshold=${config.threshold}`,
    `negThreshold=${config.negThreshold}`,
    `minSpeechMs=${config.minSpeechMs}`,
    `minSilenceMs=${config.minSilenceMs}`,
    `padMs=${config.padMs}`,
    `frame=${config.frameSamples}`,
    `rate=${AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE}`,
    'channels=mono-ch0',
  ].join(';');
}

export class AudioIntelligenceGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly runtime: AudioIntelligenceRuntimeLike;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: AudioIntelligenceGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.runtime = options.runtime;
    this.baseAnalyzerVersion = options.analyzerVersion ?? AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: AudioIntelligenceRequest,
    options: AudioIntelligenceGenerateOptions = {},
  ): Promise<AudioIntelligenceResult> {
    const jobId = request.jobId ?? this.createJobId();

    try {
      validateAudioBuffer(request.buffer);
      const result: AudioIntelligenceResult = {
        jobId,
        artifacts: {},
        refs: {},
        skipped: [],
        deferred: [],
      };

      for (const feature of request.features) {
        if (feature !== 'vad') {
          result.deferred.push(feature);
        }
      }

      if (request.features.has('vad')) {
        await this.generateVad(jobId, request, options, result);
      }

      options.onProgress?.({ stage: 'complete', progress: 1 });
      return result;
    } catch (error) {
      if (isAudioIntelligenceCancellation(error) || options.signal?.aborted) {
        const cancellation = isAudioIntelligenceCancellation(error)
          ? error as AudioIntelligenceError
          : cancelledError(jobId, options.signal ? getAbortReason(options.signal) : undefined);
        options.onProgress?.({ stage: 'cancelled', progress: 0, message: cancellation.message });
        throw cancellation;
      }

      throw error instanceof AudioIntelligenceError
        ? error
        : new AudioIntelligenceError(
          `Audio intelligence ${jobId} failed: ${errorMessage(error)}`,
          { code: 'artifact-store-failed', cause: error },
        );
    }
  }

  private async generateVad(
    jobId: string,
    request: AudioIntelligenceRequest,
    options: AudioIntelligenceGenerateOptions,
    result: AudioIntelligenceResult,
  ): Promise<void> {
    const generatedAt = this.now();
    const config: VoiceActivityConfig = { ...DEFAULT_VOICE_ACTIVITY_CONFIG, ...request.vadConfig };
    if (config.frameSamples !== DEFAULT_VOICE_ACTIVITY_CONFIG.frameSamples) {
      throw new AudioIntelligenceError(
        `Audio intelligence VAD requires frameSamples=${DEFAULT_VOICE_ACTIVITY_CONFIG.frameSamples} `
        + `for Silero inference, got ${config.frameSamples}.`,
        { code: 'invalid-input', recoverable: false },
      );
    }
    const analyzerVersion = createAudioIntelligenceVadAnalyzerVersion(config, this.baseAnalyzerVersion);
    const channelLayout = describeAnalysisChannelLayout();
    const model = requireAudioIntelligenceModel('silero-vad');
    const cacheKeyInput = {
      mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint,
      kind: 'voice-activity' as const,
      analyzerVersion,
      channelLayout,
      sampleRate: request.buffer.sampleRate,
      duration: request.buffer.duration,
      clipAudioStateHash: request.clipAudioStateHash,
    };
    const cacheKey = createAudioAnalysisCacheKey(cacheKeyInput);

    throwIfCancelled(options.signal, jobId);
    const existing = await this.artifactStore.listAnalysisArtifacts(request.mediaFileId, 'voice-activity');
    throwIfCancelled(options.signal, jobId);
    const fresh = existing.find((artifact) => !isAudioAnalysisArtifactStaleForInput(artifact, cacheKeyInput));
    if (fresh) {
      result.artifacts.voiceActivity = fresh;
      result.refs.voiceActivity = createAudioAnalysisManifestRefFromArtifact(fresh);
      result.skipped.push('vad');
      options.onProgress?.({ stage: 'vad-fresh', progress: 1, feature: 'vad', message: 'Voice activity is up to date' });
      return;
    }

    options.onProgress?.({ stage: 'resampling', progress: 0.02, feature: 'vad' });
    throwIfCancelled(options.signal, jobId);
    let pcm = resampleAudioBuffer(request.buffer, AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE);
    if (request.buffer.sampleRate === AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE) {
      // runVad transfers the buffer to the worker; never detach an
      // AudioBuffer's live channel data.
      pcm = pcm.slice();
    }

    const vad = await this.runtime.runVad(pcm, config, {
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.({
        ...progress,
        feature: 'vad',
        progress: 0.05 + progress.progress * 0.85,
      }),
    });
    throwIfCancelled(options.signal, jobId);

    options.onProgress?.({ stage: 'storing', progress: 0.92, feature: 'vad', message: 'Storing voice activity' });
    const payloadBytes = encodeAudioSpanListPayload({
      header: {
        schemaVersion: AUDIO_SPAN_LIST_PAYLOAD_VERSION,
        kind: 'voice-activity-segments',
        spanCount: vad.segments.length,
        valueLayout: 'span-major',
        valueEncoding: 'start-end-confidence-f32',
        timeUnit: 'seconds',
      },
      values: spansToFloat32(vad.segments),
    });
    const payloadRef = await this.artifactStore.putPayload(new Blob([payloadBytes], {
      type: AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
    }), {
      mediaFileId: request.mediaFileId,
      kind: 'voice-activity',
      sourceFingerprint: request.sourceFingerprint,
      clipAudioStateHash: request.clipAudioStateHash,
      mimeType: AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
      analyzerVersion,
      createdAt: generatedAt,
      metadata: { cacheKey },
    });
    // Cancellation may leave this content-addressed payload orphaned; deduplication
    // makes that safe and avoids deleting a payload shared by another artifact.
    throwIfCancelled(options.signal, jobId);

    const manifest = createVoiceActivityManifest({
      mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint,
      clipAudioStateHash: request.clipAudioStateHash,
      sampleRate: request.buffer.sampleRate,
      analysisSampleRate: AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
      channelLayout,
      duration: request.buffer.duration,
      model: { id: model.id, version: model.version },
      config,
      segmentCount: vad.segments.length,
      segmentsPayloadRef: payloadRef,
      summary: summarizeSpans(vad.segments, request.buffer.duration),
    });

    const artifactId = await deterministicHashId('audio:voice-activity', cacheKey);
    const artifactResult = await this.artifactStore.putAnalysisArtifact({
      id: artifactId,
      kind: 'voice-activity',
      mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint,
      clipAudioStateHash: request.clipAudioStateHash,
      decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
      decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
      analyzerVersion,
      sampleRate: request.buffer.sampleRate,
      channelLayout,
      duration: request.buffer.duration,
      payloadRefs: [payloadRef],
      createdAt: toTimestamp(generatedAt),
      stale: false,
      metadata: {
        ...(request.metadata ?? {}),
        analysisKind: 'voice-activity',
        cacheKey,
        sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
        voiceActivityManifest: manifest as unknown as JsonValue,
      },
    });
    throwIfCancelled(options.signal, jobId);

    result.artifacts.voiceActivity = artifactResult.artifact;
    result.refs.voiceActivity = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);
  }
}
