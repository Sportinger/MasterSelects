import { Logger } from '../../logger';
import type { ScreenCaptureBackend } from '../ScreenCaptureService';
import type { CaptureRecordingConfig, CaptureRecordingResult } from './sessionTypes';
import {
  appendCaptureRecoveryChunk,
  ArtifactCaptureRecordingBlobStore,
  deleteCaptureRecoveryEntry,
  getCaptureRecoveryStorage,
  readCaptureRecoveryEntries,
  upsertCaptureRecoveryEntry,
  type CaptureRecoveryBlobStore,
} from './recoveryPersistence';

const log = Logger.create('ScreenCapture');
const DEFAULT_TIMESLICE_MS = 1000;
const DEFAULT_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type RecorderConstructor = Pick<typeof MediaRecorder, 'isTypeSupported'> & {
  new(stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
};

export interface MediaRecorderCaptureBackendOptions {
  recorderConstructor?: RecorderConstructor;
  blobStore?: CaptureRecoveryBlobStore;
  recoveryStorage?: RecoveryStorage;
  mimeTypes?: readonly string[];
  timesliceMs?: number;
  now?: () => number;
}

export function selectCaptureMimeType(
  recorderConstructor: Pick<typeof MediaRecorder, 'isTypeSupported'>,
  mimeTypes: readonly string[] = DEFAULT_MIME_TYPES,
): string | undefined {
  return mimeTypes.find(mimeType => recorderConstructor.isTypeSupported(mimeType));
}

export class MediaRecorderCaptureBackend implements ScreenCaptureBackend {
  private readonly Recorder: RecorderConstructor;
  private readonly blobStore: CaptureRecoveryBlobStore;
  private readonly storage?: RecoveryStorage;
  private readonly mimeTypes: readonly string[];
  private readonly timesliceMs: number;
  private readonly now: () => number;
  private recorder: MediaRecorder | null = null;
  private sessionId: string | null = null;
  private startedAt = 0;
  private pausedAt: number | null = null;
  private pausedDurationMs = 0;
  private chunkIndex = 0;
  private bytes = 0;
  private pendingWriteBytes = 0;
  private maxPendingWriteBytes = 0;
  private artifactIds: string[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  private writeError: Error | null = null;
  private recorderError: Error | null = null;
  private acceptingChunks = false;
  private stopPromise: Promise<CaptureRecordingResult> | null = null;

  constructor(options: MediaRecorderCaptureBackendOptions = {}) {
    const Recorder = options.recorderConstructor ?? globalThis.MediaRecorder;
    if (!Recorder) throw new Error('MediaRecorder screen capture is not available in this browser.');
    this.Recorder = Recorder;
    this.blobStore = options.blobStore ?? new ArtifactCaptureRecordingBlobStore();
    this.storage = options.recoveryStorage ?? getCaptureRecoveryStorage();
    this.mimeTypes = options.mimeTypes ?? DEFAULT_MIME_TYPES;
    this.timesliceMs = options.timesliceMs ?? DEFAULT_TIMESLICE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async start(input: { sessionId: string; source: MediaStream; config: CaptureRecordingConfig }): Promise<void> {
    if (this.recorder) throw new Error('Screen capture recording is already active.');
    const requestedMimeType = selectCaptureMimeType(this.Recorder, this.mimeTypes);
    const recorder = new this.Recorder(input.source, {
      ...(requestedMimeType ? { mimeType: requestedMimeType } : {}),
      videoBitsPerSecond: input.config.bitrateBitsPerSecond,
      ...(input.config.audioBitrateBitsPerSecond
        ? { audioBitsPerSecond: input.config.audioBitrateBitsPerSecond }
        : {}),
    });
    this.recorder = recorder;
    this.sessionId = input.sessionId;
    this.startedAt = this.now();
    this.pausedAt = null;
    this.pausedDurationMs = 0;
    this.chunkIndex = 0;
    this.bytes = 0;
    this.pendingWriteBytes = 0;
    this.maxPendingWriteBytes = 0;
    this.artifactIds = [];
    this.pendingWrite = Promise.resolve();
    this.writeError = null;
    this.recorderError = null;
    this.acceptingChunks = true;
    this.stopPromise = null;

    const mimeType = recorder.mimeType || requestedMimeType || 'video/webm';
    upsertCaptureRecoveryEntry(this.storage, {
      sessionId: input.sessionId,
      status: 'active',
      tier: 'media-recorder',
      startedAt: this.startedAt,
      mimeType,
      chunks: [],
    });

    recorder.addEventListener('dataavailable', event => {
      if (!this.acceptingChunks || event.data.size === 0) return;
      const chunkIndex = this.chunkIndex++;
      const blob = event.data;
      this.pendingWriteBytes += blob.size;
      this.maxPendingWriteBytes = Math.max(this.maxPendingWriteBytes, this.pendingWriteBytes);
      this.pendingWrite = this.pendingWrite.then(async () => {
        const ref = await this.blobStore.putChunk({
          sessionId: input.sessionId,
          chunkIndex,
          blob,
          mimeType: blob.type || recorder.mimeType || mimeType,
          startedAt: this.startedAt,
          timeStart: chunkIndex * this.timesliceMs / 1000,
          duration: this.timesliceMs / 1000,
        });
        this.bytes += ref.bytes;
        this.artifactIds.push(ref.artifactId);
        appendCaptureRecoveryChunk(this.storage, input.sessionId, ref);
      }).catch(error => {
        this.writeError = error instanceof Error ? error : new Error('Capture recovery chunk could not be saved.');
        log.error('MediaRecorder recovery chunk write failed', { chunkIndex, error });
      }).finally(() => {
        this.pendingWriteBytes -= blob.size;
      });
    });
    recorder.addEventListener('error', event => {
      const error = (event as Event & { error?: unknown }).error;
      this.recorderError = error instanceof Error ? error : new Error('Screen capture recording failed.');
    });
    recorder.start(this.timesliceMs);
  }

  async pause(): Promise<void> {
    const recorder = this.requireRecorder();
    if (recorder.state !== 'recording') return;
    let pauseObserved = false;
    const paused = new Promise<void>(resolve => recorder.addEventListener('pause', () => {
      pauseObserved = true;
      resolve();
    }, { once: true }));
    const flushed = new Promise<void>(resolve => {
      const handleData = () => {
        if (!pauseObserved) return;
        recorder.removeEventListener('dataavailable', handleData);
        resolve();
      };
      recorder.addEventListener('dataavailable', handleData);
    });
    recorder.pause();
    recorder.requestData();
    await paused;
    this.pausedAt = this.now();
    await flushed;
    await this.pendingWrite;
    this.updateLedger('paused');
  }

  async resume(): Promise<void> {
    const recorder = this.requireRecorder();
    if (recorder.state !== 'paused') return;
    const resumed = new Promise<void>(resolve => recorder.addEventListener('resume', () => resolve(), { once: true }));
    recorder.resume();
    await resumed;
    if (this.pausedAt !== null) this.pausedDurationMs += Math.max(0, this.now() - this.pausedAt);
    this.pausedAt = null;
    this.updateLedger('active');
  }

  stop(): Promise<CaptureRecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    const recorder = this.requireRecorder();
    const sessionId = this.sessionId!;
    const stoppedAt = this.now();
    const pausedNow = this.pausedAt === null ? 0 : Math.max(0, stoppedAt - this.pausedAt);
    const durationSeconds = Math.max(0, (stoppedAt - this.startedAt - this.pausedDurationMs - pausedNow) / 1000);

    this.stopPromise = new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        if (recorder.state === 'inactive') resolve();
        else {
          recorder.requestData();
          recorder.stop();
        }
      } catch (error) {
        reject(error);
      }
    }).then(async () => {
      await this.pendingWrite;
      if (this.recorderError) throw this.recorderError;
      if (this.writeError) throw this.writeError;
      const result: CaptureRecordingResult = {
        sessionId,
        mimeType: recorder.mimeType || 'video/webm',
        durationSeconds,
        bytes: this.bytes,
        artifactIds: [...this.artifactIds],
      };
      this.updateLedger('stopped', result);
      this.recorder = null;
      return result;
    }).catch(error => {
      this.updateErrorLedger(error);
      throw error;
    });
    return this.stopPromise;
  }

  async cancel(): Promise<void> {
    const recorder = this.recorder;
    const sessionId = this.sessionId;
    this.acceptingChunks = false;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        try {
          recorder.stop();
        } catch (error) {
          reject(error);
        }
      });
    }
    await this.pendingWrite;
    if (sessionId) await deleteCaptureRecoveryEntry(this.storage, this.blobStore, sessionId);
    this.recorder = null;
    this.sessionId = null;
  }

  getStats(): { pendingWriteBytes: number; maxPendingWriteBytes: number; artifactBytes: number; outputBytes: number; mimeType?: string; codec?: string } {
    const mimeType = this.recorder?.mimeType;
    const codec = mimeType?.match(/codecs=["']?([^;"']+)/i)?.[1] ?? mimeType;
    return {
      pendingWriteBytes: this.pendingWriteBytes,
      maxPendingWriteBytes: this.maxPendingWriteBytes,
      artifactBytes: this.bytes,
      outputBytes: this.bytes,
      mimeType,
      codec,
    };
  }

  private requireRecorder(): MediaRecorder {
    if (!this.recorder) throw new Error('No screen capture recording is active.');
    return this.recorder;
  }

  private updateLedger(status: 'active' | 'paused' | 'stopped', result?: CaptureRecordingResult): void {
    if (!this.sessionId) return;
    const previous = readCaptureRecoveryEntries(this.storage).find(entry => entry.sessionId === this.sessionId);
    upsertCaptureRecoveryEntry(this.storage, {
      sessionId: this.sessionId,
      status,
      tier: 'media-recorder',
      startedAt: this.startedAt,
      stoppedAt: result ? this.now() : previous?.stoppedAt,
      mimeType: result?.mimeType ?? previous?.mimeType,
      durationSeconds: result?.durationSeconds,
      bytes: result?.bytes,
      chunks: previous?.chunks ?? [],
    });
  }

  private updateErrorLedger(error: unknown): void {
    if (!this.sessionId) return;
    const previous = readCaptureRecoveryEntries(this.storage).find(entry => entry.sessionId === this.sessionId);
    upsertCaptureRecoveryEntry(this.storage, {
      sessionId: this.sessionId,
      status: 'error',
      tier: 'media-recorder',
      startedAt: this.startedAt,
      mimeType: previous?.mimeType,
      bytes: this.bytes,
      chunks: previous?.chunks ?? [],
      message: error instanceof Error ? error.message : 'Screen capture recording failed.',
    });
  }
}
