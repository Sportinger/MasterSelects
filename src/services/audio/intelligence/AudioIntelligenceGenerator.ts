import type { SignalMetadata } from '../../../signals';
import type { TranscriptWord } from '../../../types/clipMetadata';
import {
  createAudioAnalysisManifestRefFromArtifact,
  type AudioAnalysisManifestRef,
} from '../audioAnalysisManifestKeys';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioChannelLayout } from '../audioArtifactTypes';
import { resampleAudioBuffer } from '../audioResample';
import {
  createTranscriptTimingFingerprint,
  type AlignedWordTiming,
} from '../transcriptTimingManifest';
import type { AudioSpan, VoiceActivityConfig } from '../voiceActivityManifest';
import { writeTranscriptTimingArtifact } from './alignment/transcriptTimingWriter';
import {
  AUDIO_INTELLIGENCE_STAGE_ANALYZERS,
  AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION,
  AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
  createAudioIntelligenceVadAnalyzerVersion,
  findFreshAudioArtifact,
  prosodyAnalyzerVersion,
  readAlignedWordTimings,
  readVoiceActivitySegments,
  writeVoiceActivityArtifact,
  type AudioPersistenceContext,
} from './audioIntelligencePersistence';
import {
  AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
  AudioIntelligenceError,
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  isAudioIntelligenceCancellation,
  type AudioIntelligenceAlignmentJobInput,
  type AudioIntelligenceAlignmentJobOutput,
  type AudioIntelligenceFeature,
  type AudioIntelligenceLoadPcmJobOutput,
  type AudioIntelligenceProsodyJobInput,
  type AudioIntelligenceProsodyJobOutput,
  type AudioIntelligenceReleasePcmJobOutput,
  type AudioIntelligenceRoomToneJobInput,
  type AudioIntelligenceRoomToneJobOutput,
  type AudioIntelligenceSpeechMarkersJobInput,
  type AudioIntelligenceSpeechMarkersJobOutput,
  type AudioIntelligenceStageProgress,
  type AudioIntelligenceVadJobOutput,
} from './audioIntelligenceTypes';
import { writeProsodyContourArtifact } from './prosody/prosodyWriter';
import { writeRoomToneProfileArtifact } from './roomTone/roomToneWriter';
import { writeSpeechMarkersArtifact } from './speechMarkers/speechMarkersWriter';

export {
  AUDIO_INTELLIGENCE_VAD_ANALYZER_VERSION,
  AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
  createAudioIntelligenceVadAnalyzerVersion,
};

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';

interface RuntimeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioIntelligenceStageProgress) => void;
}

export interface AudioIntelligenceRuntimeLike {
  loadPcm(
    pcm: Float32Array,
    sampleRate?: number,
    offsetSeconds?: number,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceLoadPcmJobOutput>;
  releasePcm(token: string, options?: RuntimeOptions): Promise<AudioIntelligenceReleasePcmJobOutput>;
  runVad(
    pcmOrToken: Float32Array | string,
    config: VoiceActivityConfig,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceVadJobOutput>;
  runAlignment(
    input: AudioIntelligenceAlignmentJobInput,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceAlignmentJobOutput>;
  runSpeechMarkers(
    input: AudioIntelligenceSpeechMarkersJobInput,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceSpeechMarkersJobOutput>;
  runProsody(
    input: AudioIntelligenceProsodyJobInput,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceProsodyJobOutput>;
  runRoomTone(
    input: AudioIntelligenceRoomToneJobInput,
    options?: RuntimeOptions,
  ): Promise<AudioIntelligenceRoomToneJobOutput>;
}

export interface AudioIntelligenceGeneratorOptions {
  artifactStore: AudioArtifactStore;
  runtime: AudioIntelligenceRuntimeLike;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface AudioIntelligenceTranscriptInput {
  words: readonly TranscriptWord[];
  hash: string;
  language?: string;
  wordSource: 'synthetic' | 'provider';
}

export interface AudioIntelligenceRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  features: ReadonlySet<AudioIntelligenceFeature>;
  vadConfig?: Partial<VoiceActivityConfig>;
  transcript?: AudioIntelligenceTranscriptInput;
  profile?: { hopSeconds: number };
  clipAudioStateHash?: string;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface AudioIntelligenceSkip {
  feature: AudioIntelligenceFeature;
  reason: string;
}

export interface AudioIntelligenceResult {
  jobId: string;
  artifacts: {
    voiceActivity?: AudioAnalysisArtifact;
    transcriptTiming?: AudioAnalysisArtifact;
    speechMarkers?: AudioAnalysisArtifact;
    prosodyContour?: AudioAnalysisArtifact;
    roomToneProfile?: AudioAnalysisArtifact;
  };
  refs: {
    voiceActivity?: AudioAnalysisManifestRef;
    transcriptTiming?: AudioAnalysisManifestRef;
    speechMarkers?: AudioAnalysisManifestRef;
    prosodyContour?: AudioAnalysisManifestRef;
    roomToneProfile?: AudioAnalysisManifestRef;
  };
  skipped: AudioIntelligenceSkip[];
  deferred: AudioIntelligenceFeature[];
}

export type AudioIntelligenceGenerateOptions = RuntimeOptions;

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
  if (signal?.aborted) throw cancelledError(jobId, getAbortReason(signal));
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
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

function addArtifact(
  result: AudioIntelligenceResult,
  key: keyof AudioIntelligenceResult['artifacts'],
  artifact: AudioAnalysisArtifact,
): void {
  result.artifacts[key] = artifact;
  result.refs[key] = createAudioAnalysisManifestRefFromArtifact(artifact);
}

function wordsWithAlignment(
  words: readonly TranscriptWord[],
  timings: readonly AlignedWordTiming[] | undefined,
): TranscriptWord[] {
  if (!timings) return [...words];
  const byId = new Map(timings.map(timing => [timing.wordId, timing]));
  return words.map((word) => {
    const timing = byId.get(word.id);
    return timing ? {
      ...word,
      alignedStart: timing.alignedStart,
      alignedEnd: timing.alignedEnd,
      alignmentConfidence: timing.confidence,
      alignmentMethod: 'acoustic-refine',
    } : word;
  });
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
    let pcmToken: string | undefined;
    try {
      validateAudioBuffer(request.buffer);
      const result: AudioIntelligenceResult = {
        jobId,
        artifacts: {},
        refs: {},
        skipped: [],
        deferred: [],
      };
      if (request.features.size === 0) return result;

      const context: AudioPersistenceContext = {
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        channelLayout: describeAnalysisChannelLayout(),
        sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels),
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        metadata: request.metadata,
      };
      const ensurePcmToken = async (): Promise<string> => {
        if (pcmToken) return pcmToken;
        options.onProgress?.({ stage: 'resampling', progress: 0.02 });
        throwIfCancelled(options.signal, jobId);
        let pcm = resampleAudioBuffer(request.buffer, AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE);
        if (request.buffer.sampleRate === AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE) pcm = pcm.slice();
        const loaded = await this.runtime.loadPcm(
          pcm,
          AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
          0,
          options,
        );
        pcmToken = loaded.token;
        return pcmToken;
      };

      const config: VoiceActivityConfig = { ...DEFAULT_VOICE_ACTIVITY_CONFIG, ...request.vadConfig };
      if (config.frameSamples !== DEFAULT_VOICE_ACTIVITY_CONFIG.frameSamples) {
        throw new AudioIntelligenceError(
          `Audio intelligence VAD requires frameSamples=${DEFAULT_VOICE_ACTIVITY_CONFIG.frameSamples} `
          + `for Silero inference, got ${config.frameSamples}.`,
          { code: 'invalid-input', recoverable: false },
        );
      }
      const vadAnalyzer = createAudioIntelligenceVadAnalyzerVersion(config, this.baseAnalyzerVersion);
      let vadArtifact = await findFreshAudioArtifact(
        context,
        'voice-activity',
        request.sourceFingerprint,
        vadAnalyzer,
      );
      throwIfCancelled(options.signal, jobId);
      let vadSegments: AudioSpan[];
      if (vadArtifact) {
        vadSegments = await readVoiceActivitySegments(this.artifactStore, vadArtifact);
        addArtifact(result, 'voiceActivity', vadArtifact);
        if (request.features.has('vad')) {
          result.skipped.push({ feature: 'vad', reason: 'Fresh voice-activity artifact reused.' });
        }
      } else {
        const token = await ensurePcmToken();
        const vad = await this.runtime.runVad(token, config, options);
        throwIfCancelled(options.signal, jobId);
        vadSegments = vad.segments;
        vadArtifact = await writeVoiceActivityArtifact(context, {
          segments: vadSegments,
          config,
          analyzerVersion: vadAnalyzer,
          generatedAt: this.now(),
          checkCancelled: () => throwIfCancelled(options.signal, jobId),
        });
        addArtifact(result, 'voiceActivity', vadArtifact);
        options.onProgress?.({ stage: 'vad-stored', progress: 1, feature: 'vad' });
        throwIfCancelled(options.signal, jobId);
      }

      let alignedTimings: AlignedWordTiming[] | undefined;
      if (request.features.has('alignment')) {
        if (!request.transcript) {
          result.skipped.push({ feature: 'alignment', reason: 'Transcript unavailable.' });
        } else {
          const fingerprint = createTranscriptTimingFingerprint(
            request.sourceFingerprint,
            request.transcript.hash,
          );
          const fresh = await findFreshAudioArtifact(
            context,
            'transcript-timing',
            fingerprint,
            AUDIO_INTELLIGENCE_STAGE_ANALYZERS.alignment,
          );
          throwIfCancelled(options.signal, jobId);
          if (fresh) {
            alignedTimings = await readAlignedWordTimings(this.artifactStore, fresh);
            addArtifact(result, 'transcriptTiming', fresh);
            result.skipped.push({ feature: 'alignment', reason: 'Fresh transcript-timing artifact reused.' });
          } else {
            alignedTimings = await this.runtime.runAlignment({
              token: await ensurePcmToken(),
              words: request.transcript.words,
              wordSource: request.transcript.wordSource,
              vadSegments,
            }, options);
            throwIfCancelled(options.signal, jobId);
            const artifact = await writeTranscriptTimingArtifact({
              artifactStore: this.artifactStore,
              mediaFileId: request.mediaFileId,
              audioFingerprint: request.sourceFingerprint,
              transcriptHash: request.transcript.hash,
              clipAudioStateHash: request.clipAudioStateHash,
              sampleRate: request.buffer.sampleRate,
              channelLayout: context.channelLayout,
              duration: request.buffer.duration,
              timings: alignedTimings,
              method: 'acoustic-refine',
              sourceVoiceActivityArtifactId: vadArtifact.id,
              decoderId: request.decoderId,
              decoderVersion: request.decoderVersion,
            });
            addArtifact(result, 'transcriptTiming', artifact);
            options.onProgress?.({ stage: 'alignment-stored', progress: 1, feature: 'alignment' });
            throwIfCancelled(options.signal, jobId);
          }
        }
      }

      if (request.features.has('room-tone')) {
        const fresh = await findFreshAudioArtifact(
          context,
          'room-tone-profile',
          request.sourceFingerprint,
          AUDIO_INTELLIGENCE_STAGE_ANALYZERS.roomTone,
        );
        throwIfCancelled(options.signal, jobId);
        if (fresh) {
          addArtifact(result, 'roomToneProfile', fresh);
          result.skipped.push({ feature: 'room-tone', reason: 'Fresh room-tone profile reused.' });
        } else {
          const roomTone = await this.runtime.runRoomTone({
            token: await ensurePcmToken(),
            vadSegments,
          }, options);
          throwIfCancelled(options.signal, jobId);
          const artifact = await writeRoomToneProfileArtifact({
            artifactStore: this.artifactStore,
            mediaFileId: request.mediaFileId,
            sourceFingerprint: request.sourceFingerprint,
            clipAudioStateHash: request.clipAudioStateHash,
            sampleRate: request.buffer.sampleRate,
            channelLayout: context.channelLayout,
            duration: request.buffer.duration,
            result: roomTone,
            sourceVoiceActivityArtifactId: vadArtifact.id,
            decoderId: request.decoderId,
            decoderVersion: request.decoderVersion,
          });
          addArtifact(result, 'roomToneProfile', artifact);
          options.onProgress?.({ stage: 'room-tone-stored', progress: 1, feature: 'room-tone' });
          throwIfCancelled(options.signal, jobId);
        }
      }

      if (request.features.has('speech-markers')) {
        const markerFingerprint = request.transcript
          ? createTranscriptTimingFingerprint(request.sourceFingerprint, request.transcript.hash)
          : request.sourceFingerprint;
        const fresh = await findFreshAudioArtifact(
          context,
          'speech-markers',
          markerFingerprint,
          AUDIO_INTELLIGENCE_STAGE_ANALYZERS.speechMarkers,
        );
        throwIfCancelled(options.signal, jobId);
        if (fresh) {
          addArtifact(result, 'speechMarkers', fresh);
          result.skipped.push({ feature: 'speech-markers', reason: 'Fresh speech-markers artifact reused.' });
        } else {
          const markers = await this.runtime.runSpeechMarkers({
            token: await ensurePcmToken(),
            vadSegments,
            words: request.transcript
              ? wordsWithAlignment(request.transcript.words, alignedTimings)
              : undefined,
            language: request.transcript?.language,
          }, options);
          throwIfCancelled(options.signal, jobId);
          const artifact = await writeSpeechMarkersArtifact({
            artifactStore: this.artifactStore,
            mediaFileId: request.mediaFileId,
            sourceFingerprint: markerFingerprint,
            clipAudioStateHash: request.clipAudioStateHash,
            sampleRate: request.buffer.sampleRate,
            channelLayout: context.channelLayout,
            duration: request.buffer.duration,
            markers,
            sourceVoiceActivityArtifactId: vadArtifact.id,
            transcriptHash: request.transcript?.hash,
            decoderId: request.decoderId,
            decoderVersion: request.decoderVersion,
          });
          addArtifact(result, 'speechMarkers', artifact);
          options.onProgress?.({ stage: 'speech-markers-stored', progress: 1, feature: 'speech-markers' });
          throwIfCancelled(options.signal, jobId);
        }
        if (!request.transcript) {
          result.skipped.push({
            feature: 'speech-markers',
            reason: 'Transcript unavailable; filler detection skipped (breath markers retained).',
          });
        }
      }

      if (request.features.has('prosody')) {
        const hopSeconds = Math.min(0.05, Math.max(0.01, request.profile?.hopSeconds ?? 0.05));
        const prosodyFingerprint = request.transcript && alignedTimings
          ? createTranscriptTimingFingerprint(request.sourceFingerprint, request.transcript.hash)
          : request.sourceFingerprint;
        const fresh = await findFreshAudioArtifact(
          context,
          'prosody-contour',
          prosodyFingerprint,
          prosodyAnalyzerVersion(hopSeconds),
        );
        throwIfCancelled(options.signal, jobId);
        if (fresh) {
          addArtifact(result, 'prosodyContour', fresh);
          result.skipped.push({ feature: 'prosody', reason: 'Fresh prosody contour reused.' });
        } else {
          const prosody = await this.runtime.runProsody({
            token: await ensurePcmToken(),
            hopSeconds,
            vadSegments,
            alignedWords: alignedTimings,
          }, options);
          throwIfCancelled(options.signal, jobId);
          const artifact = await writeProsodyContourArtifact({
            artifactStore: this.artifactStore,
            mediaFileId: request.mediaFileId,
            sourceFingerprint: prosodyFingerprint,
            clipAudioStateHash: request.clipAudioStateHash,
            sampleRate: request.buffer.sampleRate,
            analysisSampleRate: AUDIO_INTELLIGENCE_ANALYSIS_SAMPLE_RATE,
            channelLayout: context.channelLayout,
            duration: request.buffer.duration,
            result: prosody,
            sourceVoiceActivityArtifactId: vadArtifact.id,
            decoderId: request.decoderId,
            decoderVersion: request.decoderVersion,
          });
          addArtifact(result, 'prosodyContour', artifact);
          options.onProgress?.({ stage: 'prosody-stored', progress: 1, feature: 'prosody' });
          throwIfCancelled(options.signal, jobId);
        }
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
    } finally {
      if (pcmToken) {
        await this.runtime.releasePcm(pcmToken).catch(() => undefined);
      }
    }
  }
}
