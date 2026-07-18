import { Logger } from '../logger';
import { CaptureLifecycle, type CaptureTeardownReason } from './captureLifecycle';
import {
  getCaptureElapsedSeconds,
  transitionCaptureSession,
} from './recording/sessionStateMachine';
import {
  createCaptureSessionId,
  createIdleCaptureSnapshot,
  type CaptureRecordingConfig,
  type CaptureRecordingResult,
  type CaptureSessionSnapshot,
  type CaptureSourceSnapshot,
} from './recording/sessionTypes';
import {
  getCaptureStorageManagerFromGlobal,
  prepareStorageForCapture,
  type CaptureStorageManager,
} from './recording/storagePlanning';
import { CaptureBackendRouter } from './recording/webCodecsBackend';
import type { CaptureAudioLevels } from './recording/audioMixing';

const log = Logger.create('ScreenCapture');

export interface CaptureSourceRuntime {
  stream: MediaStream;
  getAudioLevels?: () => CaptureAudioLevels;
  release?: () => Promise<void> | void;
}

export interface ScreenCaptureBackend {
  start(input: { sessionId: string; source: MediaStream; config: CaptureRecordingConfig }): Promise<void>;
  pause(): Promise<void> | void;
  resume(): Promise<void> | void;
  stop(): Promise<CaptureRecordingResult>;
  cancel(): Promise<void> | void;
  getStats?(): { encodeQueueSize?: number; droppedFrames?: number; queuedPacketBytes?: number; pendingWriteBytes?: number; maxPendingWriteBytes?: number; artifactBytes?: number; outputBytes?: number; mimeType?: string; codec?: string };
  setFatalErrorHandler?(handler: (error: Error) => void): void;
}

export interface ScreenCaptureServiceOptions {
  backend?: ScreenCaptureBackend;
  storageManager?: CaptureStorageManager;
  now?: () => number;
}

type CaptureSubscriber = (snapshot: CaptureSessionSnapshot) => void;

const unavailableBackend: ScreenCaptureBackend = {
  start: async () => { throw new Error('Screen capture recording is not available.'); },
  pause: () => undefined,
  resume: () => undefined,
  stop: async () => { throw new Error('Screen capture recording is not available.'); },
  cancel: () => undefined,
};

function createDefaultBackend(): ScreenCaptureBackend {
  return globalThis.MediaRecorder ? new CaptureBackendRouter() : unavailableBackend;
}

export class ScreenCaptureService {
  private readonly backend: ScreenCaptureBackend;
  private readonly storageManager?: CaptureStorageManager;
  private readonly now: () => number;
  private readonly subscribers = new Set<CaptureSubscriber>();
  private snapshot = createIdleCaptureSnapshot();
  private source: MediaStream | null = null;
  private readAudioLevels: (() => CaptureAudioLevels) | null = null;
  private lifecycle = new CaptureLifecycle();
  private pausePromise: Promise<CaptureSessionSnapshot> | null = null;
  private stopPromise: Promise<CaptureRecordingResult> | null = null;

  constructor(options: ScreenCaptureServiceOptions = {}) {
    this.backend = options.backend ?? createDefaultBackend();
    this.storageManager = options.storageManager ?? getCaptureStorageManagerFromGlobal();
    this.now = options.now ?? (() => Date.now());
    this.backend.setFatalErrorHandler?.(error => { void this.handleBackendFatalError(error); });
  }

  getSnapshot(): CaptureSessionSnapshot {
    const elapsedSeconds = getCaptureElapsedSeconds(this.snapshot, this.now());
    const stats = this.backend.getStats?.();
    return elapsedSeconds === this.snapshot.elapsedSeconds && !stats
      ? this.snapshot
      : {
          ...this.snapshot,
          elapsedSeconds,
          encoderQueueSize: stats?.encodeQueueSize ?? this.snapshot.encoderQueueSize,
          droppedFrames: stats?.droppedFrames ?? this.snapshot.droppedFrames,
          bytes: stats?.outputBytes ?? this.snapshot.bytes,
          mimeType: stats?.mimeType ?? this.snapshot.mimeType,
          codec: stats?.codec ?? this.snapshot.codec,
        };
  }

  subscribe(subscriber: CaptureSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getSnapshot());
    return () => this.subscribers.delete(subscriber);
  }

  getPreviewStream(): MediaStream | null {
    return this.source;
  }

  getAudioLevels(): CaptureAudioLevels {
    return this.readAudioLevels?.() ?? { display: 0, microphone: 0 };
  }

  getDiagnosticState() {
    return {
      session: this.getSnapshot(),
      backend: { ...this.backend.getStats?.() },
      audioLevels: this.getAudioLevels(),
      hasPreviewSource: this.source !== null,
    };
  }

  beginSourceSelection(sessionId = createCaptureSessionId(this.now())): CaptureSessionSnapshot {
    this.stopPromise = null;
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'request-source', sessionId }));
    return this.snapshot;
  }

  attachSource(source: CaptureSourceRuntime, details: CaptureSourceSnapshot): CaptureSessionSnapshot {
    this.source = source.stream;
    this.readAudioLevels = source.getAudioLevels ?? null;
    this.lifecycle = new CaptureLifecycle();
    this.lifecycle.addCleanup(source.release ?? (() => source.stream.getTracks().forEach(track => track.stop())));
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'source-ready', source: details }));
    return this.snapshot;
  }

  async start(config: CaptureRecordingConfig): Promise<CaptureSessionSnapshot> {
    if (!this.source || !this.snapshot.sessionId) throw new Error('Choose a capture source before recording.');
    const storageWarnings = await prepareStorageForCapture({
      storageManager: this.storageManager,
      bitrateBitsPerSecond: config.bitrateBitsPerSecond,
      audioBitrateBitsPerSecond: config.audioBitrateBitsPerSecond,
    });
    try {
      await this.backend.start({ sessionId: this.snapshot.sessionId, source: this.source, config });
      this.setSnapshot(transitionCaptureSession(this.snapshot, {
        type: 'start-recording',
        tier: config.tier,
        startedAt: this.now(),
        storageWarnings,
      }));
      return this.snapshot;
    } catch (error) {
      await this.failAndTeardown(error);
      throw error;
    }
  }

  pause(): Promise<CaptureSessionSnapshot> {
    if (this.pausePromise) return this.pausePromise;
    const at = this.now();
    this.pausePromise = Promise.resolve(this.backend.pause()).then(() => {
      this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'pause', at }));
      return this.snapshot;
    }).finally(() => { this.pausePromise = null; });
    return this.pausePromise;
  }

  async resume(): Promise<CaptureSessionSnapshot> {
    await this.backend.resume();
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'resume', at: this.now() }));
    return this.snapshot;
  }

  stop(reason: Extract<CaptureTeardownReason, 'stop' | 'source-lost'> = 'stop'): Promise<CaptureRecordingResult> {
    if (this.stopPromise) return this.stopPromise;
    const at = this.now();
    this.setSnapshot(transitionCaptureSession(this.snapshot, {
      type: reason === 'source-lost' ? 'source-lost' : 'stop',
      at,
    }));
    this.stopPromise = this.lifecycle.teardownSession(reason, () => this.backend.stop()).then(result => {
      if (!result) throw new Error('Capture stopped without a recording result.');
      this.source = null;
      this.readAudioLevels = null;
      this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'complete', at: this.now(), result }));
      return result;
    }).catch(error => {
      this.source = null;
      this.readAudioLevels = null;
      this.setSnapshot(transitionCaptureSession(this.snapshot, {
        type: 'fail',
        message: error instanceof Error ? error.message : 'Screen capture could not stop.',
      }));
      throw error;
    });
    return this.stopPromise;
  }

  async handleSourceLost(): Promise<CaptureRecordingResult | undefined> {
    if (this.snapshot.phase === 'recording' || this.snapshot.phase === 'paused' || this.snapshot.phase === 'stopping') {
      return this.stop('source-lost');
    }
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'source-lost', at: this.now() }));
    await this.lifecycle.teardownSession('source-lost', () => this.backend.cancel());
    this.source = null;
    this.readAudioLevels = null;
    return undefined;
  }

  async cancel(): Promise<void> {
    await this.lifecycle.teardownSession('cancel', () => this.backend.cancel());
    this.source = null;
    this.readAudioLevels = null;
    this.stopPromise = null;
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'reset' }));
  }

  private async failAndTeardown(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Screen capture could not start.';
    log.warn(message, error);
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'fail', message }));
    await this.lifecycle.teardownSession('error', () => this.backend.cancel());
    this.source = null;
    this.readAudioLevels = null;
  }

  private async handleBackendFatalError(error: Error): Promise<void> {
    log.error('Screen capture backend failed', error);
    this.setSnapshot(transitionCaptureSession(this.snapshot, { type: 'fail', message: error.message }));
    await this.lifecycle.teardownSession('error');
    this.source = null;
    this.readAudioLevels = null;
  }

  private setSnapshot(snapshot: CaptureSessionSnapshot): void {
    this.snapshot = snapshot;
    for (const subscriber of this.subscribers) subscriber(this.getSnapshot());
  }
}

export function createScreenCaptureService(options?: ScreenCaptureServiceOptions): ScreenCaptureService {
  return new ScreenCaptureService(options);
}

let sharedScreenCaptureService = import.meta.hot?.data?.screenCaptureService as ScreenCaptureService | undefined;
sharedScreenCaptureService ??= createScreenCaptureService();

export const screenCaptureService = sharedScreenCaptureService;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.screenCaptureService = screenCaptureService;
  });
}
