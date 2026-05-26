import {
  encodeAudioBufferToWavBlob,
  encodeFloat32PcmChunksToWavBlob,
  type Float32PcmChunk,
} from '../../engine/audio/AudioFileEncoder';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type {
  AudioRecordingRecoveryAssetRef,
  AudioRecordingRecoveryChunkRef,
  AudioRecordingRecoveryEntry,
  AudioRecordingState,
  AudioRecordingStorageWarning,
  AudioRecordingTarget,
} from '../../types/audio';
import { artifactService } from '../project/domains/ArtifactService';
import { Logger } from '../logger';

const log = Logger.create('AudioRecordingService');
const RECOVERY_STORAGE_KEY = 'masterselects.audioRecording.recovery.v1';
const DEFAULT_TIMESLICE_MS = 1000;
const PUNCH_OUT_POLL_MS = 50;
const PUNCH_INPUT_WARMUP_SECONDS = 1.5;
const DEFAULT_OPEN_ENDED_RECORDING_STORAGE_SECONDS = 30 * 60;
const PCM_RECOVERY_STORAGE_BYTES_PER_MINUTE_PER_INPUT = 48 * 1024 * 1024;
const MIN_RECORDING_STORAGE_HEADROOM_BYTES = 256 * 1024 * 1024;
const DEFAULT_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];
const AUDIO_WORKLET_PROCESSOR_NAME = 'masterselects-pcm-recorder';
const AUDIO_WORKLET_STOP_ACK_TIMEOUT_MS = 1000;
const AUDIO_WORKLET_PROCESSOR_SOURCE = `
class MasterSelectsPcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
    }

    const input = inputs[0];
    if (this.recording && input && input.length > 0 && input[0] && input[0].length > 0) {
      const channels = input.map((channelData) => {
        const copy = new Float32Array(channelData.length);
        copy.set(channelData);
        return copy;
      });
      this.port.postMessage({ type: 'pcm', channels }, channels.map((channelData) => channelData.buffer));
    }

    return this.recording;
  }
}

registerProcessor('${AUDIO_WORKLET_PROCESSOR_NAME}', MasterSelectsPcmRecorderProcessor);
`;

export interface AudioRecordingStartOptions {
  targets: AudioRecordingTarget[];
  startTime: number;
  sessionId?: string;
  startedAt?: number;
  mimeTypes?: string[];
  punchInTime?: number;
  punchOutTime?: number;
  getTimelineTime?: () => number;
  onPunchOut?: (result: AudioRecordingStopResult) => Promise<void> | void;
}

export interface AudioRecordingRecoveryChunkInput {
  sessionId: string;
  inputDeviceId?: string;
  trackIds: string[];
  chunkIndex: number;
  kind: AudioRecordingRecoveryChunkRef['kind'];
  blob: Blob;
  mimeType: string;
  startedAt: number;
  startTime: number;
  timeStart: number;
  duration?: number;
  sampleRate?: number;
  channelCount?: number;
  frameCount?: number;
}

export interface AudioRecordingChunkSink {
  writeChunk(input: AudioRecordingRecoveryChunkInput): Promise<AudioRecordingRecoveryChunkRef>;
}

export interface AudioRecordingCaptureStartInput {
  sessionId?: string;
  inputDeviceId?: string;
  trackIds?: string[];
  startedAt?: number;
  startTime?: number;
  mimeTypes: string[];
  timesliceMs: number;
  chunkSink?: AudioRecordingChunkSink;
  initiallyPaused?: boolean;
}

export interface AudioRecordingRawResult {
  blob: Blob;
  mimeType: string;
  chunkCount: number;
  duration?: number;
  sampleRate?: number;
  channelCount?: number;
}

export interface AudioRecordingCapture {
  mimeType: string;
  stream?: MediaStream;
  resume?: (input?: { startedAt?: number; startTime?: number }) => void;
  stop: () => Promise<AudioRecordingRawResult>;
  cancel: () => Promise<void>;
}

export interface AudioRecordingCaptureBackend {
  start: (input: AudioRecordingCaptureStartInput) => Promise<AudioRecordingCapture>;
}

export interface AudioRecordedAsset {
  id: string;
  sessionId: string;
  inputDeviceId?: string;
  trackIds: string[];
  file: File;
  blob: Blob;
  mimeType: string;
  sourceMimeType: string;
  duration: number;
  startTime: number;
  startedAt: number;
  stoppedAt: number;
  sampleRate?: number;
  channelCount?: number;
  chunkCount: number;
}

export interface AudioRecordingStopResult {
  sessionId: string;
  startedAt: number;
  stoppedAt: number;
  startTime: number;
  assets: AudioRecordedAsset[];
}

export interface AudioRecordingCommitResult {
  sessionId: string;
  clips: Array<{
    clipId: string;
    trackId: string;
    mediaFileId: string;
    fileName: string;
  }>;
}

export interface AudioRecordingCommitDependencies {
  importFile?: (
    file: File,
    parentId?: string | null,
    options?: { forceCopyToProject?: boolean; projectFileName?: string },
  ) => Promise<unknown>;
  addClip?: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: 'audio',
    options?: { name?: string },
  ) => Promise<string | undefined>;
  generateWaveformForClip?: (clipId: string) => Promise<void>;
  generateLoudnessForClip?: (clipId: string) => Promise<void>;
}

export interface AudioRecordingServiceOptions {
  backend?: AudioRecordingCaptureBackend;
  encodeToWav?: boolean;
  recoveryStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  recoveryBlobStore?: AudioRecordingRecoveryBlobStore;
  storageManager?: AudioRecordingStorageManager;
  now?: () => number;
}

export interface AudioRecordingRecoveryBlobStore {
  putAsset(asset: AudioRecordedAsset): Promise<AudioRecordingRecoveryAssetRef>;
  getAsset(assetRef: AudioRecordingRecoveryAssetRef): Promise<Blob | null>;
  putChunk(chunk: AudioRecordingRecoveryChunkInput): Promise<AudioRecordingRecoveryChunkRef>;
  getChunk(chunkRef: AudioRecordingRecoveryChunkRef): Promise<Blob | null>;
  deleteRef?: (artifactId: string) => Promise<void>;
}

export interface AudioRecordingStorageEstimate {
  usage?: number;
  quota?: number;
}

export interface AudioRecordingStorageManager {
  estimate?: () => Promise<AudioRecordingStorageEstimate>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

type AudioRecordingSubscriber = (snapshot: AudioRecordingState) => void;

interface ActiveCaptureGroup {
  inputDeviceId?: string;
  trackIds: string[];
  capture: AudioRecordingCapture;
}

interface CaptureInputGroup {
  inputDeviceId?: string;
  targets: AudioRecordingTarget[];
}

interface ActiveRecordingSession {
  sessionId: string;
  startedAt: number;
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
  mimeTypes: string[];
  captureGroups: CaptureInputGroup[];
  getTimelineTime?: () => number;
  onPunchOut?: (result: AudioRecordingStopResult) => Promise<void> | void;
  punchInTimer?: ReturnType<typeof globalThis.setTimeout>;
  punchOutTimer?: ReturnType<typeof globalThis.setTimeout>;
  captureStarting?: boolean;
  punchOutStopping?: boolean;
  storageWarnings?: AudioRecordingStorageWarning[];
  targets: AudioRecordingTarget[];
  captures: ActiveCaptureGroup[];
}

function createRecordingSessionId(now: number): string {
  return `audio-rec-${Math.round(now)}-${Math.random().toString(36).slice(2, 8)}`;
}

function groupTargetsByInput(targets: AudioRecordingTarget[]): CaptureInputGroup[] {
  const groups = new Map<string, AudioRecordingTarget[]>();

  for (const target of targets) {
    const key = target.inputDeviceId?.trim() || '__default__';
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }

  return Array.from(groups.entries()).map(([key, groupedTargets]) => ({
    inputDeviceId: key === '__default__' ? undefined : key,
    targets: groupedTargets,
  }));
}

function selectMediaRecorderMimeType(mimeTypes: string[]): string | undefined {
  const recorder = globalThis.MediaRecorder;
  if (!recorder?.isTypeSupported) return undefined;
  return mimeTypes.find(type => recorder.isTypeSupported(type));
}

function stopStream(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach(track => track.stop());
}

function createAudioInputConstraints(inputDeviceId?: string): MediaStreamConstraints {
  return {
    audio: inputDeviceId
      ? {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: inputDeviceId },
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: { ideal: 48000 },
      }
      : {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: { ideal: 48000 },
      },
    video: false,
  };
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
}

function isWavMimeType(mimeType: string | undefined): boolean {
  return Boolean(mimeType?.toLowerCase().includes('wav'));
}

function disconnectAudioNode(node: AudioNode | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Already disconnected or never connected.
  }
}

function isPcmChunkMessage(value: unknown): value is { type: 'pcm'; channels: Float32Array[] } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'pcm' &&
    Array.isArray((value as { channels?: unknown }).channels),
  );
}

function encodeInterleavedFloat32Chunk(
  chunks: readonly Float32PcmChunk[],
  channelCount: number,
  frameCount: number,
): ArrayBuffer {
  const output = new Float32Array(Math.max(0, frameCount) * Math.max(1, channelCount));
  let outputFrame = 0;

  for (const chunk of chunks) {
    if (outputFrame >= frameCount) break;
    const chunkFrameCount = Math.min(
      chunk.frameCount ?? chunk.channels.reduce((max, channel) => Math.max(max, channel.length), 0),
      frameCount - outputFrame,
    );
    for (let frame = 0; frame < chunkFrameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        output[(outputFrame + frame) * channelCount + channel] = chunk.channels[channel]?.[frame] ?? 0;
      }
    }
    outputFrame += chunkFrameCount;
  }

  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

async function decodeInterleavedFloat32Chunk(
  blob: Blob,
  channelCount: number,
  frameCount: number,
): Promise<Float32PcmChunk> {
  const arrayBuffer = await blob.arrayBuffer();
  const interleaved = new Float32Array(arrayBuffer);
  const channels = Array.from({ length: Math.max(1, channelCount) }, () => new Float32Array(Math.max(0, frameCount)));

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      channels[channel][frame] = interleaved[frame * channels.length + channel] ?? 0;
    }
  }

  return { channels, frameCount };
}

function isAudioWorkletStoppedMessage(value: unknown): value is { type: 'stopped' } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'stopped',
  );
}

export class AudioWorkletAudioCaptureBackend implements AudioRecordingCaptureBackend {
  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Audio input capture is not available in this browser.');
    }
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error('AudioWorklet recording requires Web Audio support.');
    }
    if (!globalThis.AudioWorkletNode) {
      throw new Error('AudioWorklet recording is not available in this browser.');
    }
    if (!globalThis.URL?.createObjectURL || !globalThis.URL?.revokeObjectURL) {
      throw new Error('AudioWorklet recording cannot load the capture processor in this browser.');
    }

    const audioContext = new AudioContextCtor();
    if (!audioContext.audioWorklet) {
      await audioContext.close().catch(() => undefined);
      throw new Error('AudioWorklet recording requires BaseAudioContext.audioWorklet.');
    }
    const stream = await globalThis.navigator.mediaDevices.getUserMedia(
      createAudioInputConstraints(input.inputDeviceId),
    );

    let processorUrl: string | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let processor: AudioWorkletNode | undefined;
    let sink: GainNode | undefined;
    let finalized = false;
    let acceptingChunks = input.initiallyPaused !== true;
    let captureStartedAt = input.startedAt;
    let captureStartTime = input.startTime;
    let stopAckResolve: (() => void) | undefined;
    let stopAckTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const chunks: Float32PcmChunk[] = [];
    const pendingRecoveryWrites: Promise<unknown>[] = [];
    let frameCount = 0;
    let channelCount = 0;
    let recoveryChunkIndex = 0;
    let recoveryCheckpointStartFrame = 0;
    let recoveryCheckpointFrameCount = 0;
    let recoveryCheckpointChannelCount = 0;
    let recoveryCheckpointChunks: Float32PcmChunk[] = [];

    const resolveStopAck = (): void => {
      if (stopAckTimer !== undefined) {
        globalThis.clearTimeout(stopAckTimer);
        stopAckTimer = undefined;
      }
      stopAckResolve?.();
      stopAckResolve = undefined;
    };

    const requestStopAck = (): Promise<void> => new Promise(resolve => {
      if (!processor || finalized) {
        resolve();
        return;
      }
      stopAckResolve = resolve;
      stopAckTimer = globalThis.setTimeout(() => {
        stopAckTimer = undefined;
        resolveStopAck();
      }, AUDIO_WORKLET_STOP_ACK_TIMEOUT_MS);
      processor.port.postMessage({ type: 'stop' });
    });

    const flushRecoveryCheckpoint = (): void => {
      if (
        !input.chunkSink ||
        recoveryCheckpointFrameCount <= 0 ||
        !input.sessionId ||
        typeof captureStartedAt !== 'number'
      ) {
        recoveryCheckpointChunks = [];
        recoveryCheckpointFrameCount = 0;
        recoveryCheckpointChannelCount = 0;
        recoveryCheckpointStartFrame = frameCount;
        return;
      }

      const sampleRate = audioContext.sampleRate;
      const checkpointChunks = recoveryCheckpointChunks;
      const checkpointFrameCount = recoveryCheckpointFrameCount;
      const checkpointChannelCount = Math.max(1, recoveryCheckpointChannelCount);
      const checkpointStartFrame = recoveryCheckpointStartFrame;
      const payload = encodeInterleavedFloat32Chunk(
        checkpointChunks,
        checkpointChannelCount,
        checkpointFrameCount,
      );
      const blob = new Blob([payload], {
        type: 'application/vnd.masterselects.audio-recording-pcm-f32',
      });
      const chunkIndex = recoveryChunkIndex;
      recoveryChunkIndex += 1;

      pendingRecoveryWrites.push(input.chunkSink.writeChunk({
        sessionId: input.sessionId,
        inputDeviceId: input.inputDeviceId,
        trackIds: input.trackIds ?? [],
        chunkIndex,
        kind: 'audio-worklet-pcm-f32',
        blob,
        mimeType: blob.type,
        startedAt: captureStartedAt,
        startTime: captureStartTime ?? 0,
        timeStart: checkpointStartFrame / sampleRate,
        duration: checkpointFrameCount / sampleRate,
        sampleRate,
        channelCount: checkpointChannelCount,
        frameCount: checkpointFrameCount,
      }).catch(error => {
        log.warn('AudioWorklet recording recovery chunk write failed', { chunkIndex, error });
      }));

      recoveryCheckpointChunks = [];
      recoveryCheckpointFrameCount = 0;
      recoveryCheckpointChannelCount = 0;
      recoveryCheckpointStartFrame = frameCount;
    };

    const cleanup = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      acceptingChunks = false;

      try {
        processor?.port.postMessage({ type: 'stop' });
      } catch {
        // Port may already be closed by the browser when the worklet stops.
      }
      resolveStopAck();
      if (processor) {
        processor.port.onmessage = null;
      }
      disconnectAudioNode(source);
      disconnectAudioNode(processor);
      disconnectAudioNode(sink);
      stopStream(stream);
      if (processorUrl) {
        globalThis.URL.revokeObjectURL(processorUrl);
      }
      await audioContext.close().catch(() => undefined);
    };

    try {
      processorUrl = globalThis.URL.createObjectURL(new Blob([AUDIO_WORKLET_PROCESSOR_SOURCE], {
        type: 'text/javascript',
      }));
      await audioContext.audioWorklet.addModule(processorUrl);
      source = audioContext.createMediaStreamSource(stream);
      processor = new AudioWorkletNode(audioContext, AUDIO_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      sink = audioContext.createGain();
      sink.gain.value = 0;

      processor.port.onmessage = (event: MessageEvent<unknown>) => {
        if (isAudioWorkletStoppedMessage(event.data)) {
          resolveStopAck();
          return;
        }
        if (!acceptingChunks || !isPcmChunkMessage(event.data)) return;

        const channels = event.data.channels
          .filter((channel): channel is Float32Array => channel instanceof Float32Array);
        const chunkFrameCount = channels.reduce(
          (maxFrames, channel) => Math.max(maxFrames, channel.length),
          0,
        );
        if (channels.length === 0 || chunkFrameCount <= 0) return;

        chunks.push({ channels, frameCount: chunkFrameCount });
        frameCount += chunkFrameCount;
        channelCount = Math.max(channelCount, channels.length);

        if (input.chunkSink) {
          recoveryCheckpointChunks.push({ channels, frameCount: chunkFrameCount });
          recoveryCheckpointFrameCount += chunkFrameCount;
          recoveryCheckpointChannelCount = Math.max(recoveryCheckpointChannelCount, channels.length);
          const targetFrames = Math.max(1, Math.floor(audioContext.sampleRate * input.timesliceMs / 1000));
          if (recoveryCheckpointFrameCount >= targetFrames) {
            flushRecoveryCheckpoint();
          }
        }
      };

      source.connect(processor);
      processor.connect(sink);
      sink.connect(audioContext.destination);
      await audioContext.resume().catch(() => undefined);

      return {
        mimeType: 'audio/wav',
        stream,
        resume: (resumeInput) => {
          captureStartedAt = resumeInput?.startedAt ?? captureStartedAt;
          captureStartTime = resumeInput?.startTime ?? captureStartTime;
          acceptingChunks = true;
        },
        stop: async () => {
          await requestStopAck();
          acceptingChunks = false;
          flushRecoveryCheckpoint();
          await Promise.allSettled(pendingRecoveryWrites);

          const finalFrameCount = frameCount;
          const finalChannelCount = Math.max(1, channelCount);
          const sampleRate = audioContext.sampleRate;
          const blob = encodeFloat32PcmChunksToWavBlob({
            sampleRate,
            channelCount: finalChannelCount,
            chunks,
            frameCount: finalFrameCount,
          });
          await cleanup();

          return {
            blob,
            mimeType: 'audio/wav',
            chunkCount: chunks.length,
            duration: finalFrameCount > 0 ? finalFrameCount / sampleRate : undefined,
            sampleRate,
            channelCount: finalChannelCount,
          };
        },
        cancel: cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}

export class MediaRecorderAudioCaptureBackend implements AudioRecordingCaptureBackend {
  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Audio input capture is not available in this browser.');
    }
    if (!globalThis.MediaRecorder) {
      throw new Error('MediaRecorder audio capture is not available in this browser.');
    }

    const stream = await globalThis.navigator.mediaDevices.getUserMedia(
      createAudioInputConstraints(input.inputDeviceId),
    );
    const mimeType = selectMediaRecorderMimeType(input.mimeTypes);
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const pendingRecoveryWrites: Promise<unknown>[] = [];
    let chunkIndex = 0;
    let captureStartedAt = input.startedAt;
    let captureStartTime = input.startTime;
    let hasStartedRecorder = false;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        const currentChunkIndex = chunkIndex;
        chunkIndex += 1;
        chunks.push(event.data);
        if (input.chunkSink && input.sessionId && typeof captureStartedAt === 'number') {
          const chunkMimeType = event.data.type || recorder.mimeType || mimeType || 'audio/webm';
          pendingRecoveryWrites.push(input.chunkSink.writeChunk({
            sessionId: input.sessionId,
            inputDeviceId: input.inputDeviceId,
            trackIds: input.trackIds ?? [],
            chunkIndex: currentChunkIndex,
            kind: 'media-recorder',
            blob: event.data,
            mimeType: chunkMimeType,
            startedAt: captureStartedAt,
            startTime: captureStartTime ?? 0,
            timeStart: (currentChunkIndex * input.timesliceMs) / 1000,
            duration: input.timesliceMs / 1000,
          }).catch(error => {
            log.warn('MediaRecorder recovery chunk write failed', { chunkIndex: currentChunkIndex, error });
          }));
        }
      }
    });

    const startRecorder = (): void => {
      if (hasStartedRecorder || recorder.state !== 'inactive') return;
      recorder.start(input.timesliceMs);
      hasStartedRecorder = true;
    };

    if (input.initiallyPaused !== true) {
      startRecorder();
    }

    return {
      mimeType: recorder.mimeType || mimeType || '',
      stream,
      resume: (resumeInput) => {
        captureStartedAt = resumeInput?.startedAt ?? captureStartedAt;
        captureStartTime = resumeInput?.startTime ?? captureStartTime;
        startRecorder();
      },
      stop: () => new Promise<AudioRecordingRawResult>((resolve, reject) => {
        const finish = async () => {
          stopStream(stream);
          await Promise.allSettled(pendingRecoveryWrites);
          const sourceMimeType = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
          resolve({
            blob: new Blob(chunks, { type: sourceMimeType }),
            mimeType: sourceMimeType,
            chunkCount: chunks.length,
          });
        };
        recorder.addEventListener('stop', finish, { once: true });
        recorder.addEventListener('error', (event) => {
          stopStream(stream);
          const eventError = (event as Event & { error?: unknown }).error;
          reject(eventError instanceof Error ? eventError : new Error('Audio recording failed.'));
        }, { once: true });

        if (!hasStartedRecorder || recorder.state === 'inactive') {
          void finish();
          return;
        }

        try {
          recorder.requestData();
          recorder.stop();
        } catch (error) {
          stopStream(stream);
          reject(error);
        }
      }),
      cancel: async () => {
        if (hasStartedRecorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
        stopStream(stream);
      },
    };
  }
}

export class FallbackAudioRecordingCaptureBackend implements AudioRecordingCaptureBackend {
  private readonly backends: AudioRecordingCaptureBackend[];

  constructor(backends: AudioRecordingCaptureBackend[]) {
    this.backends = backends;
  }

  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    let lastError: unknown;

    for (const [index, backend] of this.backends.entries()) {
      try {
        return await backend.start(input);
      } catch (error) {
        lastError = error;
        if (index < this.backends.length - 1) {
          log.warn('Audio recording backend failed; trying fallback backend.', {
            backend: backend.constructor?.name ?? `backend-${index + 1}`,
            error,
          });
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No audio recording backend could start.');
  }
}

export function createDefaultAudioRecordingCaptureBackend(): AudioRecordingCaptureBackend {
  return new FallbackAudioRecordingCaptureBackend([
    new AudioWorkletAudioCaptureBackend(),
    new MediaRecorderAudioCaptureBackend(),
  ]);
}

class ArtifactAudioRecordingRecoveryBlobStore implements AudioRecordingRecoveryBlobStore {
  async putAsset(asset: AudioRecordedAsset): Promise<AudioRecordingRecoveryAssetRef> {
    const result = await artifactService.putIndexedDBArtifact(asset.blob, {
      mimeType: asset.mimeType || asset.blob.type || 'audio/wav',
      encoding: 'raw',
      producer: {
        providerId: 'masterselects.audio.recording',
        providerVersion: '1.0.0',
        jobId: asset.sessionId,
      },
      sourceRefs: [
        `audio-recording:${asset.sessionId}`,
        ...asset.trackIds.map(trackId => `timeline-track:${trackId}`),
      ],
      metadata: {
        audioArtifactRole: 'recording-recovery',
        audioRecordingSessionId: asset.sessionId,
        inputDeviceId: asset.inputDeviceId ?? 'default',
        trackIds: asset.trackIds.join(','),
      },
      createdAt: new Date(asset.stoppedAt).toISOString(),
    });

    return {
      id: asset.id,
      artifactId: result.manifest.artifactId,
      inputDeviceId: asset.inputDeviceId,
      trackIds: asset.trackIds,
      fileName: asset.file.name,
      mimeType: asset.mimeType,
      sourceMimeType: asset.sourceMimeType,
      duration: asset.duration,
      startTime: asset.startTime,
      startedAt: asset.startedAt,
      stoppedAt: asset.stoppedAt,
      sampleRate: asset.sampleRate,
      channelCount: asset.channelCount,
      chunkCount: asset.chunkCount,
    };
  }

  async getAsset(assetRef: AudioRecordingRecoveryAssetRef): Promise<Blob | null> {
    const stored = await artifactService.getIndexedDBArtifact(assetRef.artifactId);
    return stored?.blob ?? null;
  }

  async putChunk(chunk: AudioRecordingRecoveryChunkInput): Promise<AudioRecordingRecoveryChunkRef> {
    const result = await artifactService.putIndexedDBArtifact(chunk.blob, {
      mimeType: chunk.mimeType || chunk.blob.type || 'application/octet-stream',
      encoding: 'raw',
      producer: {
        providerId: 'masterselects.audio.recording',
        providerVersion: '1.0.0',
        jobId: chunk.sessionId,
      },
      sourceRefs: [
        `audio-recording:${chunk.sessionId}`,
        `audio-recording:${chunk.sessionId}:chunks`,
        ...chunk.trackIds.map(trackId => `timeline-track:${trackId}`),
      ],
      metadata: {
        audioArtifactRole: 'recording-recovery-chunk',
        audioRecordingSessionId: chunk.sessionId,
        audioRecordingChunkIndex: chunk.chunkIndex,
        inputDeviceId: chunk.inputDeviceId ?? 'default',
        trackIds: chunk.trackIds.join(','),
        kind: chunk.kind,
        timeStart: chunk.timeStart,
        duration: chunk.duration ?? 0,
        sampleRate: chunk.sampleRate ?? 0,
        channelCount: chunk.channelCount ?? 0,
        frameCount: chunk.frameCount ?? 0,
      },
      createdAt: new Date(chunk.startedAt + Math.max(0, chunk.timeStart) * 1000).toISOString(),
    });

    return {
      artifactId: result.manifest.artifactId,
      inputDeviceId: chunk.inputDeviceId,
      trackIds: chunk.trackIds,
      chunkIndex: chunk.chunkIndex,
      kind: chunk.kind,
      mimeType: chunk.mimeType,
      startedAt: chunk.startedAt,
      startTime: chunk.startTime,
      timeStart: chunk.timeStart,
      duration: chunk.duration,
      sampleRate: chunk.sampleRate,
      channelCount: chunk.channelCount,
      frameCount: chunk.frameCount,
    };
  }

  async getChunk(chunkRef: AudioRecordingRecoveryChunkRef): Promise<Blob | null> {
    const stored = await artifactService.getIndexedDBArtifact(chunkRef.artifactId);
    return stored?.blob ?? null;
  }

  async deleteRef(artifactId: string): Promise<void> {
    await artifactService.createIndexedDBStore().deleteArtifact(artifactId);
  }
}

function getStorageFromGlobal(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function getRecordingStorageManagerFromGlobal(): AudioRecordingStorageManager | undefined {
  const navigatorLike = globalThis.navigator as { storage?: AudioRecordingStorageManager } | undefined;
  return navigatorLike?.storage;
}

function readRecoveryEntries(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): AudioRecordingRecoveryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECOVERY_STORAGE_KEY);
    return parseRecoveryEntriesRaw(raw);
  } catch {
    return [];
  }
}

function parseRecoveryEntriesRaw(raw: string | null): AudioRecordingRecoveryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is AudioRecordingRecoveryEntry => (
      entry &&
      typeof entry.sessionId === 'string' &&
      Array.isArray(entry.targetTrackIds) &&
      typeof entry.startedAt === 'number' &&
      typeof entry.startTime === 'number'
    )) : [];
  } catch {
    return [];
  }
}

function writeRecoveryEntries(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  entries: AudioRecordingRecoveryEntry[],
): void {
  if (!storage) return;
  if (entries.length === 0) {
    storage.removeItem(RECOVERY_STORAGE_KEY);
    return;
  }
  storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(entries));
}

function isAudioMediaFile(value: unknown): value is MediaFile {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as MediaFile).type === 'audio' &&
    typeof (value as MediaFile).id === 'string',
  );
}

function getRecordingTargetTrackIds(targets: readonly AudioRecordingTarget[]): string[] {
  return targets.map(target => target.trackId);
}

function getRecordingInputDeviceIds(targets: readonly AudioRecordingTarget[]): string[] {
  return Array.from(new Set(targets.map(target => target.inputDeviceId ?? 'default')));
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function formatStorageBytes(bytes: number): string {
  const absolute = Math.max(0, bytes);
  if (absolute >= 1024 * 1024 * 1024) {
    return `${(absolute / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (absolute >= 1024 * 1024) {
    return `${Math.round(absolute / (1024 * 1024))} MB`;
  }
  return `${Math.round(absolute / 1024)} KB`;
}

async function maybeEncodeBlobToWav(blob: Blob): Promise<{
  blob: Blob;
  duration?: number;
  sampleRate?: number;
  channelCount?: number;
}> {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
  if (!AudioContextCtor) {
    return { blob };
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      blob: encodeAudioBufferToWavBlob(decoded),
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channelCount: decoded.numberOfChannels,
    };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

function createFileFromBlob(blob: Blob, name: string, lastModified: number): File {
  return new File([blob], name, {
    type: blob.type || 'audio/wav',
    lastModified,
  });
}

export class AudioRecordingService {
  private readonly backend: AudioRecordingCaptureBackend;
  private readonly encodeToWav: boolean;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly recoveryBlobStore: AudioRecordingRecoveryBlobStore;
  private readonly storageManager?: AudioRecordingStorageManager;
  private readonly now: () => number;
  private readonly subscribers = new Set<AudioRecordingSubscriber>();
  private activeSession: ActiveRecordingSession | null = null;
  private snapshot: AudioRecordingState = { phase: 'idle' };
  private stopPromise: Promise<AudioRecordingStopResult> | null = null;
  private readonly committedSessionIds = new Set<string>();
  private recoverySnapshotRaw: string | null | undefined;
  private recoverySnapshotEntries: AudioRecordingRecoveryEntry[] = [];

  constructor(options: AudioRecordingServiceOptions = {}) {
    this.backend = options.backend ?? createDefaultAudioRecordingCaptureBackend();
    this.encodeToWav = options.encodeToWav ?? true;
    this.storage = options.recoveryStorage ?? getStorageFromGlobal();
    this.recoveryBlobStore = options.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore();
    this.storageManager = options.storageManager ?? getRecordingStorageManagerFromGlobal();
    this.now = options.now ?? (() => Date.now());
  }

  getSnapshot(): AudioRecordingState {
    this.snapshot = this.composeSnapshot(this.snapshot);
    return this.snapshot;
  }

  subscribe(listener: AudioRecordingSubscriber): () => void {
    this.subscribers.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  listRecoveryEntries(): AudioRecordingRecoveryEntry[] {
    return this.readRecoveryEntriesCached();
  }

  async start(options: AudioRecordingStartOptions): Promise<AudioRecordingState> {
    if (this.activeSession) {
      throw new Error('Audio recording is already active.');
    }
    if (options.targets.length === 0) {
      throw new Error('Arm at least one audio track before recording.');
    }

    const startedAt = options.startedAt ?? this.now();
    const sessionId = options.sessionId ?? createRecordingSessionId(startedAt);
    const targetTrackIds = getRecordingTargetTrackIds(options.targets);
    const inputDeviceIds = getRecordingInputDeviceIds(options.targets);
    const captureGroups = groupTargetsByInput(options.targets);
    const mimeTypes = options.mimeTypes ?? DEFAULT_MIME_TYPES;
    const storageWarnings = await this.prepareStorageForRecording({
      inputGroupCount: captureGroups.length,
      startTime: options.startTime,
      punchInTime: options.punchInTime,
      punchOutTime: options.punchOutTime,
    });
    const session: ActiveRecordingSession = {
      sessionId,
      startedAt,
      startTime: options.startTime,
      punchInTime: options.punchInTime,
      punchOutTime: options.punchOutTime,
      mimeTypes,
      captureGroups,
      getTimelineTime: options.getTimelineTime,
      onPunchOut: options.onPunchOut,
      storageWarnings,
      targets: options.targets,
      captures: [],
    };

    this.persistRecoveryEntry({
      sessionId,
      targetTrackIds,
      inputDeviceIds,
      startedAt,
      startTime: options.startTime,
      punchInTime: options.punchInTime,
      punchOutTime: options.punchOutTime,
      status: 'active',
    });
    this.activeSession = session;
    const initialPhase = this.shouldWaitForPunchIn(session) ? 'waiting-for-punch' : 'requesting-input';
    this.setSnapshot({
      phase: initialPhase,
      sessionId,
      targetTrackIds,
      startedAt,
      startTime: options.startTime,
      punchInTime: options.punchInTime,
      punchOutTime: options.punchOutTime,
      elapsedSeconds: 0,
      inputDeviceIds,
      storageWarnings,
    });

    if (initialPhase === 'waiting-for-punch') {
      this.armPunchInMonitor(session);
      return this.snapshot;
    }

    try {
      await this.beginSessionCapture(session);
      return this.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audio recording could not start.';
      this.persistRecoveryEntry({
        sessionId,
        targetTrackIds,
        inputDeviceIds,
        startedAt,
        startTime: options.startTime,
        punchInTime: options.punchInTime,
        punchOutTime: options.punchOutTime,
        status: 'error',
        message,
      });
      this.activeSession = null;
      this.setSnapshot({
        phase: 'error',
        sessionId,
        targetTrackIds,
        startedAt,
        startTime: options.startTime,
        punchInTime: options.punchInTime,
        punchOutTime: options.punchOutTime,
        inputDeviceIds,
        lastError: message,
        storageWarnings,
      });
      throw error;
    }
  }

  async stop(): Promise<AudioRecordingStopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = this.stopActiveSession();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async stopActiveSession(): Promise<AudioRecordingStopResult> {
    const session = this.activeSession;
    if (!session) {
      throw new Error('No audio recording is active.');
    }
    this.clearPunchInMonitor(session);
    this.clearPunchOutMonitor(session);

    const stoppedAt = this.now();
    this.setSnapshot({
      ...this.snapshot,
      phase: 'stopping',
      elapsedSeconds: Math.max(0, (stoppedAt - session.startedAt) / 1000),
    });

    const assets: AudioRecordedAsset[] = [];
    for (const group of session.captures) {
      const raw = await group.capture.stop();
      const prepared = await this.prepareRecordedAsset(session, group, raw, stoppedAt);
      assets.push(prepared);
    }
    const recoveryAssets = await this.persistRecoveryAssets(assets);

    this.activeSession = null;
    this.persistRecoveryEntry({
      sessionId: session.sessionId,
      targetTrackIds: session.targets.map(target => target.trackId),
      inputDeviceIds: Array.from(new Set(session.targets.map(target => target.inputDeviceId ?? 'default'))),
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      assets: recoveryAssets,
      status: 'stopped',
    });
    this.setSnapshot({
      phase: 'complete',
      sessionId: session.sessionId,
      targetTrackIds: session.targets.map(target => target.trackId),
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      elapsedSeconds: Math.max(0, (stoppedAt - session.startedAt) / 1000),
      inputDeviceIds: Array.from(new Set(session.targets.map(target => target.inputDeviceId ?? 'default'))),
      lastCompletedAt: stoppedAt,
      storageWarnings: session.storageWarnings,
    });

    return {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      stoppedAt,
      startTime: session.startTime,
      assets,
    };
  }

  async cancel(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;

    this.clearPunchInMonitor(session);
    this.clearPunchOutMonitor(session);
    await Promise.all(session.captures.map(group => group.capture.cancel()));
    this.activeSession = null;
    this.persistRecoveryEntry({
      sessionId: session.sessionId,
      targetTrackIds: session.targets.map(target => target.trackId),
      inputDeviceIds: Array.from(new Set(session.targets.map(target => target.inputDeviceId ?? 'default'))),
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      status: 'cancelled',
    });
    this.removeRecoveryEntry(session.sessionId);
    this.setSnapshot({ phase: 'idle' });
  }

  async commitRecordingResult(
    result: AudioRecordingStopResult,
    deps: AudioRecordingCommitDependencies = {},
  ): Promise<AudioRecordingCommitResult> {
    if (this.committedSessionIds.has(result.sessionId)) {
      return { sessionId: result.sessionId, clips: [] };
    }

    const mediaStore = deps.importFile ? null : useMediaStore.getState();
    const timelineStore = deps.addClip && deps.generateWaveformForClip && deps.generateLoudnessForClip
      ? null
      : useTimelineStore.getState();
    const importFile = deps.importFile ?? mediaStore!.importFile.bind(mediaStore);
    const addClip = deps.addClip ?? timelineStore!.addClip.bind(timelineStore);
    const generateWaveformForClip = deps.generateWaveformForClip ?? timelineStore!.generateWaveformForClip.bind(timelineStore);
    const generateLoudnessForClip = deps.generateLoudnessForClip ?? timelineStore!.generateLoudnessForClip.bind(timelineStore);
    const clips: AudioRecordingCommitResult['clips'] = [];

    for (const asset of result.assets) {
      const imported = await importFile(asset.file, null, {
        forceCopyToProject: true,
        projectFileName: asset.file.name,
      });
      if (!isAudioMediaFile(imported)) {
        throw new Error(`Recorded file "${asset.file.name}" did not import as an audio media file.`);
      }

      const sourceFile = imported.file ?? asset.file;
      for (const trackId of asset.trackIds) {
        const clipId = await addClip(
          trackId,
          sourceFile,
          asset.startTime,
          asset.duration,
          imported.id,
          'audio',
          { name: asset.file.name },
        );
        if (!clipId) continue;

        clips.push({
          clipId,
          trackId,
          mediaFileId: imported.id,
          fileName: asset.file.name,
        });
        void generateWaveformForClip(clipId).catch(error => {
          log.warn('Recorded waveform generation failed', { clipId, error });
        });
        void generateLoudnessForClip(clipId).catch(error => {
          log.warn('Recorded loudness generation failed', { clipId, error });
        });
      }
    }

    this.committedSessionIds.add(result.sessionId);
    const recoveryEntry = this.listRecoveryEntries().find(entry => entry.sessionId === result.sessionId);
    this.removeRecoveryEntry(result.sessionId);
    if (recoveryEntry) {
      await this.deleteRecoveryArtifacts(recoveryEntry);
    }
    this.setSnapshot(this.snapshot);
    return { sessionId: result.sessionId, clips };
  }

  async dismissRecoveryEntry(sessionId: string): Promise<void> {
    const recoveryEntry = this.listRecoveryEntries().find(entry => entry.sessionId === sessionId);
    this.removeRecoveryEntry(sessionId);
    if (recoveryEntry) {
      await this.deleteRecoveryArtifacts(recoveryEntry);
    }
    this.setSnapshot(this.snapshot);
  }

  private async deleteRecoveryArtifacts(entry: AudioRecordingRecoveryEntry): Promise<void> {
    const artifactIds = [
      ...(entry.assets?.map(asset => asset.artifactId) ?? []),
      ...(entry.chunks?.map(chunk => chunk.artifactId) ?? []),
    ];
    if (!this.recoveryBlobStore.deleteRef || artifactIds.length === 0) return;

    await Promise.allSettled(artifactIds.map(artifactId => this.recoveryBlobStore.deleteRef!(artifactId)));
  }

  async commitRecoveryEntry(
    sessionId: string,
    deps: AudioRecordingCommitDependencies = {},
  ): Promise<AudioRecordingCommitResult> {
    const entry = this.listRecoveryEntries().find(candidate => candidate.sessionId === sessionId);
    if (!entry || (entry.status !== 'stopped' && entry.status !== 'active')) {
      throw new Error('No stopped audio recording recovery assets are available for this session.');
    }

    const assets = await this.restoreRecoveryAssets(entry);
    if (assets.length === 0) {
      throw new Error('No stopped audio recording recovery assets are available for this session.');
    }

    return this.commitRecordingResult({
      sessionId: entry.sessionId,
      startedAt: entry.startedAt,
      stoppedAt: Math.max(...assets.map(asset => asset.stoppedAt)),
      startTime: entry.startTime,
      assets,
    }, deps);
  }

  private async restoreRecoveryAssets(entry: AudioRecordingRecoveryEntry): Promise<AudioRecordedAsset[]> {
    if (entry.assets && entry.assets.length > 0) {
      return this.restoreRecoveryAssetRefs(entry);
    }
    if (entry.chunks && entry.chunks.length > 0) {
      return this.restoreRecoveryChunkRefs(entry);
    }
    return [];
  }

  private async restoreRecoveryAssetRefs(entry: AudioRecordingRecoveryEntry): Promise<AudioRecordedAsset[]> {
    const refs = entry.assets ?? [];
    const assets: AudioRecordedAsset[] = [];
    for (const assetRef of refs) {
      const blob = await this.recoveryBlobStore.getAsset(assetRef);
      if (!blob) {
        throw new Error(`Recovered recording asset "${assetRef.fileName}" is missing.`);
      }
      const file = createFileFromBlob(blob, assetRef.fileName, assetRef.stoppedAt);
      assets.push({
        id: assetRef.id,
        sessionId: entry.sessionId,
        inputDeviceId: assetRef.inputDeviceId,
        trackIds: assetRef.trackIds,
        file,
        blob,
        mimeType: assetRef.mimeType,
        sourceMimeType: assetRef.sourceMimeType,
        duration: assetRef.duration,
        startTime: assetRef.startTime,
        startedAt: assetRef.startedAt,
        stoppedAt: assetRef.stoppedAt,
        sampleRate: assetRef.sampleRate,
        channelCount: assetRef.channelCount,
        chunkCount: assetRef.chunkCount,
      });
    }

    return assets;
  }

  private async restoreRecoveryChunkRefs(entry: AudioRecordingRecoveryEntry): Promise<AudioRecordedAsset[]> {
    const groups = new Map<string, AudioRecordingRecoveryChunkRef[]>();
    for (const chunk of entry.chunks ?? []) {
      const key = chunk.inputDeviceId ?? 'default';
      groups.set(key, [...(groups.get(key) ?? []), chunk]);
    }

    const assets: AudioRecordedAsset[] = [];
    for (const [inputKey, chunks] of groups.entries()) {
      const sortedChunks = chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
      const first = sortedChunks[0];
      if (!first) continue;

      const restoredBlobs = await Promise.all(sortedChunks.map(async chunk => ({
        ref: chunk,
        blob: await this.recoveryBlobStore.getChunk(chunk),
      })));
      const missing = restoredBlobs.find(item => !item.blob);
      if (missing) {
        throw new Error(`Recovered recording chunk ${missing.ref.chunkIndex} is missing.`);
      }

      let blob: Blob;
      let mimeType = first.mimeType;
      let duration = sortedChunks.reduce((total, chunk) => total + (chunk.duration ?? 0), 0);
      let sampleRate = first.sampleRate;
      let channelCount = first.channelCount;
      const chunkCount = sortedChunks.length;
      if (first.kind === 'audio-worklet-pcm-f32') {
        sampleRate = first.sampleRate ?? 48000;
        channelCount = Math.max(1, ...sortedChunks.map(chunk => chunk.channelCount ?? 1));
        const pcmChunks = await Promise.all(restoredBlobs.map(async ({ ref, blob: chunkBlob }) => (
          decodeInterleavedFloat32Chunk(
            chunkBlob!,
            ref.channelCount ?? channelCount!,
            ref.frameCount ?? 0,
          )
        )));
        const frameCount = sortedChunks.reduce((total, chunk) => total + (chunk.frameCount ?? 0), 0);
        blob = encodeFloat32PcmChunksToWavBlob({
          sampleRate,
          channelCount,
          chunks: pcmChunks,
          frameCount,
        });
        mimeType = 'audio/wav';
        duration = frameCount > 0 ? frameCount / sampleRate : duration;
      } else {
        blob = new Blob(restoredBlobs.map(item => item.blob!), { type: first.mimeType || 'audio/webm' });
      }

      const extension = mimeType.includes('wav')
        ? 'wav'
        : mimeType.includes('ogg')
          ? 'ogg'
          : 'webm';
      const fileName = `Recovered Recording ${new Date(entry.startedAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;
      const stoppedAt = Math.max(entry.startedAt, entry.startedAt + Math.max(0.001, duration) * 1000);
      const file = createFileFromBlob(blob, fileName, stoppedAt);
      const inputDeviceId = inputKey === 'default' ? undefined : inputKey;
      assets.push({
        id: `${entry.sessionId}:${inputKey}:chunks`,
        sessionId: entry.sessionId,
        inputDeviceId,
        trackIds: first.trackIds,
        file,
        blob,
        mimeType,
        sourceMimeType: first.mimeType,
        duration: Math.max(0.001, duration),
        startTime: entry.startTime,
        startedAt: entry.startedAt,
        stoppedAt,
        sampleRate,
        channelCount,
        chunkCount,
      });
    }

    return assets;
  }

  private async persistRecoveryAssets(
    assets: readonly AudioRecordedAsset[],
  ): Promise<AudioRecordingRecoveryAssetRef[] | undefined> {
    if (assets.length === 0) return undefined;

    const refs: AudioRecordingRecoveryAssetRef[] = [];
    for (const asset of assets) {
      try {
        refs.push(await this.recoveryBlobStore.putAsset(asset));
      } catch (error) {
        log.warn('Could not persist recording recovery asset', {
          sessionId: asset.sessionId,
          fileName: asset.file.name,
          error,
        });
      }
    }

    return refs.length > 0 ? refs : undefined;
  }

  private shouldWaitForPunchIn(session: ActiveRecordingSession): boolean {
    if (
      typeof session.punchInTime !== 'number' ||
      !Number.isFinite(session.punchInTime) ||
      !session.getTimelineTime
    ) {
      return false;
    }

    const timelineTime = session.getTimelineTime();
    return typeof timelineTime === 'number'
      && Number.isFinite(timelineTime)
      && timelineTime < session.punchInTime - 0.001;
  }

  private async prepareStorageForRecording(input: {
    inputGroupCount: number;
    startTime: number;
    punchInTime?: number;
    punchOutTime?: number;
  }): Promise<AudioRecordingStorageWarning[]> {
    const storageManager = this.storageManager;
    if (!storageManager?.estimate) {
      return [{
        code: 'storage-estimate-unavailable',
        severity: 'info',
        message: 'Browser storage estimate is unavailable. Recording recovery remains enabled, but long takes may have less durable recovery.',
      }];
    }

    let estimate: AudioRecordingStorageEstimate;
    try {
      estimate = await storageManager.estimate();
    } catch {
      return [{
        code: 'storage-estimate-unavailable',
        severity: 'info',
        message: 'Browser storage estimate failed. Recording recovery remains enabled, but long takes may have less durable recovery.',
      }];
    }

    const usageBytes = finitePositiveNumber(estimate.usage) ?? 0;
    const quotaBytes = finitePositiveNumber(estimate.quota);
    if (!quotaBytes) {
      return [{
        code: 'storage-estimate-unavailable',
        severity: 'info',
        usageBytes,
        message: 'Browser storage quota is unavailable. Recording recovery remains enabled, but long takes may have less durable recovery.',
      }];
    }

    const availableBytes = Math.max(0, quotaBytes - usageBytes);
    const inputCount = Math.max(1, input.inputGroupCount);
    const recordingSeconds = this.estimateRecordingStorageSeconds(input);
    const estimatedSessionBytes = Math.ceil(
      (recordingSeconds / 60) * PCM_RECOVERY_STORAGE_BYTES_PER_MINUTE_PER_INPUT * inputCount,
    );
    const warnings: AudioRecordingStorageWarning[] = [];
    let persistent = false;
    let persistRequested = false;
    let persistGranted = false;

    try {
      persistent = await storageManager.persisted?.() ?? false;
    } catch {
      persistent = false;
    }

    const shouldRequestPersistence = !persistent && (
      estimatedSessionBytes >= MIN_RECORDING_STORAGE_HEADROOM_BYTES ||
      availableBytes < estimatedSessionBytes * 2 ||
      availableBytes < MIN_RECORDING_STORAGE_HEADROOM_BYTES
    );

    if (shouldRequestPersistence && storageManager.persist) {
      persistRequested = true;
      try {
        persistGranted = await storageManager.persist();
        persistent = persistGranted;
      } catch {
        persistGranted = false;
      }
    }

    if (availableBytes < estimatedSessionBytes) {
      warnings.push({
        code: 'storage-quota-low',
        severity: 'warning',
        usageBytes,
        quotaBytes,
        availableBytes,
        estimatedSessionBytes,
        persistent,
        persistRequested,
        persistGranted,
        message: `Recording recovery storage is low: ${formatStorageBytes(availableBytes)} available, roughly ${formatStorageBytes(estimatedSessionBytes)} reserved for this take.`,
      });
    } else if (availableBytes < MIN_RECORDING_STORAGE_HEADROOM_BYTES) {
      warnings.push({
        code: 'storage-quota-near-full',
        severity: 'warning',
        usageBytes,
        quotaBytes,
        availableBytes,
        estimatedSessionBytes,
        persistent,
        persistRequested,
        persistGranted,
        message: `Browser storage is nearly full (${formatStorageBytes(availableBytes)} available). Long recording recovery may stop early.`,
      });
    }

    if (persistRequested && !persistGranted && !persistent) {
      warnings.push({
        code: 'storage-persistence-denied',
        severity: 'warning',
        usageBytes,
        quotaBytes,
        availableBytes,
        estimatedSessionBytes,
        persistent,
        persistRequested,
        persistGranted,
        message: 'Persistent browser storage was not granted. Recording still works, but recovery artifacts may be evicted by the browser.',
      });
    } else if (persistRequested && persistGranted) {
      warnings.push({
        code: 'storage-persistence-granted',
        severity: 'info',
        usageBytes,
        quotaBytes,
        availableBytes,
        estimatedSessionBytes,
        persistent,
        persistRequested,
        persistGranted,
        message: 'Persistent browser storage is enabled for recording recovery.',
      });
    }

    return warnings;
  }

  private estimateRecordingStorageSeconds(input: {
    startTime: number;
    punchInTime?: number;
    punchOutTime?: number;
  }): number {
    const start = typeof input.punchInTime === 'number' && Number.isFinite(input.punchInTime)
      ? input.punchInTime
      : input.startTime;
    if (typeof input.punchOutTime === 'number' && Number.isFinite(input.punchOutTime)) {
      return Math.max(1, input.punchOutTime - start);
    }
    return DEFAULT_OPEN_ENDED_RECORDING_STORAGE_SECONDS;
  }

  private async beginSessionCapture(
    session: ActiveRecordingSession,
    options: { pausedUntilPunch?: boolean } = {},
  ): Promise<void> {
    if (this.activeSession !== session) return;
    if (session.captureStarting || session.captures.length > 0) return;
    session.captureStarting = true;
    const wasWaitingForPunch = this.snapshot.phase === 'waiting-for-punch';
    if (!options.pausedUntilPunch) {
      this.clearPunchInMonitor(session);
    }

    const targetTrackIds = getRecordingTargetTrackIds(session.targets);
    const inputDeviceIds = getRecordingInputDeviceIds(session.targets);
    this.setSnapshot({
      phase: options.pausedUntilPunch ? 'warming-input' : 'requesting-input',
      sessionId: session.sessionId,
      targetTrackIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      elapsedSeconds: 0,
      inputDeviceIds,
      storageWarnings: session.storageWarnings,
    });

    const captures: ActiveCaptureGroup[] = [];
    try {
      if (wasWaitingForPunch && !options.pausedUntilPunch) {
        session.startedAt = this.now();
      }
      for (const group of session.captureGroups) {
        const capture = await this.backend.start({
          sessionId: session.sessionId,
          inputDeviceId: group.inputDeviceId,
          trackIds: group.targets.map(target => target.trackId),
          startedAt: session.startedAt,
          startTime: session.startTime,
          mimeTypes: session.mimeTypes,
          timesliceMs: DEFAULT_TIMESLICE_MS,
          chunkSink: this.createRecoveryChunkSink(session),
          initiallyPaused: options.pausedUntilPunch,
        });
        captures.push({
          inputDeviceId: group.inputDeviceId,
          trackIds: group.targets.map(target => target.trackId),
          capture,
        });
        if (this.activeSession !== session) {
          await Promise.allSettled(captures.map(startedGroup => startedGroup.capture.cancel()));
          return;
        }
      }

      if (this.activeSession !== session) {
        await Promise.allSettled(captures.map(group => group.capture.cancel()));
        return;
      }

      session.captures = captures;
      this.persistRecoveryEntry({
        sessionId: session.sessionId,
        targetTrackIds,
        inputDeviceIds,
        startedAt: session.startedAt,
        startTime: session.startTime,
        punchInTime: session.punchInTime,
        punchOutTime: session.punchOutTime,
        status: 'active',
      });
      if (options.pausedUntilPunch) {
        this.setSnapshot({
          phase: 'warming-input',
          sessionId: session.sessionId,
          targetTrackIds,
          startedAt: session.startedAt,
          startTime: session.startTime,
          punchInTime: session.punchInTime,
          punchOutTime: session.punchOutTime,
          elapsedSeconds: 0,
          inputDeviceIds,
          storageWarnings: session.storageWarnings,
        });
        return;
      }
      this.armPunchOutMonitor(session);
      this.setSnapshot({
        phase: 'recording',
        sessionId: session.sessionId,
        targetTrackIds,
        startedAt: session.startedAt,
        startTime: session.startTime,
        punchInTime: session.punchInTime,
        punchOutTime: session.punchOutTime,
        elapsedSeconds: 0,
        inputDeviceIds,
        storageWarnings: session.storageWarnings,
      });
    } catch (error) {
      await Promise.allSettled(captures.map(group => group.capture.cancel()));
      session.captures = [];
      this.activeSession = null;
      const message = error instanceof Error ? error.message : 'Audio recording could not start.';
      this.persistRecoveryEntry({
        sessionId: session.sessionId,
        targetTrackIds,
        inputDeviceIds,
        startedAt: session.startedAt,
        startTime: session.startTime,
        punchInTime: session.punchInTime,
        punchOutTime: session.punchOutTime,
        status: 'error',
        message,
      });
      this.setSnapshot({
        phase: 'error',
        sessionId: session.sessionId,
        targetTrackIds,
        startedAt: session.startedAt,
        startTime: session.startTime,
        punchInTime: session.punchInTime,
        punchOutTime: session.punchOutTime,
        inputDeviceIds,
        lastError: message,
        storageWarnings: session.storageWarnings,
      });
      throw error;
    } finally {
      session.captureStarting = false;
    }
  }

  private resumeSessionCapture(session: ActiveRecordingSession): void {
    if (this.activeSession !== session || session.captures.length === 0) return;

    this.clearPunchInMonitor(session);
    session.startedAt = this.now();
    const targetTrackIds = getRecordingTargetTrackIds(session.targets);
    const inputDeviceIds = getRecordingInputDeviceIds(session.targets);

    for (const group of session.captures) {
      group.capture.resume?.({
        startedAt: session.startedAt,
        startTime: session.startTime,
      });
    }

    this.persistRecoveryEntry({
      sessionId: session.sessionId,
      targetTrackIds,
      inputDeviceIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      status: 'active',
    });
    this.armPunchOutMonitor(session);
    this.setSnapshot({
      phase: 'recording',
      sessionId: session.sessionId,
      targetTrackIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      elapsedSeconds: 0,
      inputDeviceIds,
      storageWarnings: session.storageWarnings,
    });
  }

  private createRecoveryChunkSink(session: ActiveRecordingSession): AudioRecordingChunkSink {
    return {
      writeChunk: async (chunk) => {
        const ref = await this.recoveryBlobStore.putChunk(chunk);
        this.appendRecoveryChunk(session.sessionId, ref);
        return ref;
      },
    };
  }

  private appendRecoveryChunk(sessionId: string, chunkRef: AudioRecordingRecoveryChunkRef): void {
    const entries = readRecoveryEntries(this.storage);
    const nextEntries = entries.map(entry => {
      if (entry.sessionId !== sessionId) return entry;

      const chunks = entry.chunks ?? [];
      if (chunks.some(candidate => candidate.artifactId === chunkRef.artifactId)) {
        return entry;
      }
      return {
        ...entry,
        chunks: [...chunks, chunkRef].toSorted((a, b) => a.chunkIndex - b.chunkIndex),
      };
    });

    writeRecoveryEntries(this.storage, nextEntries);
  }

  private armPunchInMonitor(session: ActiveRecordingSession): void {
    const checkPunchIn = async (): Promise<void> => {
      if (this.activeSession !== session) return;
      if (session.captureStarting) {
        session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
        return;
      }

      const timelineTime = session.getTimelineTime?.();
      if (
        typeof timelineTime === 'number' &&
        Number.isFinite(timelineTime) &&
        typeof session.punchInTime === 'number' &&
        timelineTime >= session.punchInTime
      ) {
        if (session.captures.length > 0) {
          this.resumeSessionCapture(session);
        } else {
          await this.beginSessionCapture(session).catch(error => {
            log.warn('Punch-in recording start failed', error);
          });
        }
        return;
      }

      if (
        session.captures.length === 0 &&
        typeof timelineTime === 'number' &&
        Number.isFinite(timelineTime) &&
        typeof session.punchInTime === 'number' &&
        timelineTime >= session.punchInTime - PUNCH_INPUT_WARMUP_SECONDS
      ) {
        await this.beginSessionCapture(session, { pausedUntilPunch: true }).catch(error => {
          log.warn('Punch-in input warmup failed', error);
        });
        if (this.activeSession !== session) return;
      }

      session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
    };

    session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
  }

  private clearPunchInMonitor(session: ActiveRecordingSession): void {
    if (session.punchInTimer !== undefined) {
      globalThis.clearTimeout(session.punchInTimer);
      session.punchInTimer = undefined;
    }
  }

  private armPunchOutMonitor(session: ActiveRecordingSession): void {
    if (
      typeof session.punchOutTime !== 'number' ||
      !Number.isFinite(session.punchOutTime) ||
      !session.getTimelineTime
    ) {
      return;
    }

    const checkPunchOut = async (): Promise<void> => {
      if (this.activeSession !== session || session.punchOutStopping) return;

      const timelineTime = session.getTimelineTime?.();
      if (typeof timelineTime === 'number' && Number.isFinite(timelineTime) && timelineTime >= session.punchOutTime!) {
        session.punchOutStopping = true;
        try {
          const result = await this.stop();
          await session.onPunchOut?.(result);
        } catch (error) {
          log.warn('Punch-out recording stop failed', error);
          this.setSnapshot({
            ...this.snapshot,
            phase: 'error',
            lastError: error instanceof Error ? error.message : 'Punch-out recording stop failed.',
          });
        }
        return;
      }

      session.punchOutTimer = globalThis.setTimeout(checkPunchOut, PUNCH_OUT_POLL_MS);
    };

    session.punchOutTimer = globalThis.setTimeout(checkPunchOut, PUNCH_OUT_POLL_MS);
  }

  private clearPunchOutMonitor(session: ActiveRecordingSession): void {
    if (session.punchOutTimer !== undefined) {
      globalThis.clearTimeout(session.punchOutTimer);
      session.punchOutTimer = undefined;
    }
  }

  private async prepareRecordedAsset(
    session: ActiveRecordingSession,
    group: ActiveCaptureGroup,
    raw: AudioRecordingRawResult,
    stoppedAt: number,
  ): Promise<AudioRecordedAsset> {
    let duration = Math.max(0.001, raw.duration ?? (stoppedAt - session.startedAt) / 1000);
    let blob = raw.blob;
    let sampleRate = raw.sampleRate;
    let channelCount = raw.channelCount;

    if (this.encodeToWav && raw.blob.size > 0 && !isWavMimeType(raw.blob.type || raw.mimeType)) {
      try {
        const encoded = await maybeEncodeBlobToWav(raw.blob);
        blob = encoded.blob;
        duration = Math.max(0.001, encoded.duration ?? duration);
        sampleRate = encoded.sampleRate;
        channelCount = encoded.channelCount;
      } catch (error) {
        log.warn('Could not transcode recording to WAV; keeping source recording blob.', error);
      }
    }

    const mimeType = blob.type || raw.mimeType || 'audio/wav';
    const extension = mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('ogg')
        ? 'ogg'
        : 'webm';
    const fileName = `Recording ${new Date(session.startedAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;
    const file = createFileFromBlob(blob, fileName, stoppedAt);

    return {
      id: `${session.sessionId}:${group.inputDeviceId ?? 'default'}`,
      sessionId: session.sessionId,
      inputDeviceId: group.inputDeviceId,
      trackIds: group.trackIds,
      file,
      blob,
      mimeType,
      sourceMimeType: raw.mimeType,
      duration,
      startTime: session.startTime,
      startedAt: session.startedAt,
      stoppedAt,
      sampleRate,
      channelCount,
      chunkCount: raw.chunkCount,
    };
  }

  private setSnapshot(snapshot: AudioRecordingState): void {
    this.snapshot = this.composeSnapshot(snapshot);
    for (const subscriber of this.subscribers) {
      subscriber(this.snapshot);
    }
  }

  private readRecoveryEntriesCached(): AudioRecordingRecoveryEntry[] {
    const raw = this.readRecoveryStorageRaw();
    if (raw === this.recoverySnapshotRaw) {
      return this.recoverySnapshotEntries;
    }

    this.recoverySnapshotRaw = raw;
    this.recoverySnapshotEntries = parseRecoveryEntriesRaw(raw);
    return this.recoverySnapshotEntries;
  }

  private readRecoveryStorageRaw(): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(RECOVERY_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private composeSnapshot(snapshot: AudioRecordingState): AudioRecordingState {
    const recoveryEntries = this.readRecoveryEntriesCached();
    if (snapshot.recoveryEntries === recoveryEntries) {
      return snapshot;
    }
    return {
      ...snapshot,
      recoveryEntries,
    };
  }

  private persistRecoveryEntry(entry: AudioRecordingRecoveryEntry): void {
    const entries = readRecoveryEntries(this.storage);
    const existing = entries.find(candidate => candidate.sessionId === entry.sessionId);
    const merged: AudioRecordingRecoveryEntry = {
      ...(existing ?? entry),
      ...entry,
      assets: entry.assets ?? existing?.assets,
      chunks: entry.chunks ?? existing?.chunks,
    };
    writeRecoveryEntries(
      this.storage,
      [...entries.filter(candidate => candidate.sessionId !== entry.sessionId), merged],
    );
  }

  private removeRecoveryEntry(sessionId: string): void {
    writeRecoveryEntries(
      this.storage,
      readRecoveryEntries(this.storage).filter(entry => entry.sessionId !== sessionId),
    );
  }
}

export function createAudioRecordingService(options?: AudioRecordingServiceOptions): AudioRecordingService {
  return new AudioRecordingService(options);
}

let sharedAudioRecordingService: AudioRecordingService | null = null;

if (import.meta.hot?.data?.audioRecordingService) {
  sharedAudioRecordingService = import.meta.hot.data.audioRecordingService as AudioRecordingService;
}

export const audioRecordingService = sharedAudioRecordingService ?? createAudioRecordingService();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.audioRecordingService = audioRecordingService;
  });
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
