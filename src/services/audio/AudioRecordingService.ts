import { getEditorRepositorySession } from '../project/repository/transaction/editorRepositorySession';
import type {
  AudioRecordingRecoveryAssetRef,
  AudioRecordingRecoveryChunkRef,
  AudioRecordingRecoveryEntry,
  AudioRecordingState,
  AudioRecordingStorageWarning,
  AudioRecordingTarget,
} from '../../types/audio';
import { prepareAudioRecordedAsset } from './recording/assetPreparation';
import {
  createDefaultAudioRecordingCaptureBackend,
} from './recording/captureBackendFactory';
import { commitAudioRecordingResultToTimeline } from './recording/commitRecording';
import {
  ArtifactAudioRecordingRecoveryBlobStore,
  RECOVERY_STORAGE_KEY,
  appendRecoveryChunk as appendRecoveryChunkRef,
  deleteRecoveryArtifacts as deleteRecoveryEntryArtifacts,
  getRecordingStorageManagerFromGlobal,
  getStorageFromGlobal,
  parseRecoveryEntriesRaw,
  readRecoveryEntries,
  writeRecoveryEntries,
} from './recording/recoveryPersistence';
import {
  persistAudioRecordingRecoveryAssets,
  restoreAudioRecordingRecoveryAssets,
} from './recording/recoveryAssets';
import {
  type AudioRecordingSessionStateMachineContext,
  armAudioRecordingPunchInMonitor,
  beginAudioRecordingSessionCapture,
  clearAudioRecordingPunchInMonitor,
  clearAudioRecordingPunchOutMonitor,
} from './recording/sessionStateMachine';
import {
  type ActiveCaptureGroup,
  type ActiveRecordingSession,
  createRecordingSessionId,
  getRecordingInputDeviceIds,
  getRecordingTargetTrackIds,
  groupTargetsByInput,
} from './recording/sessionTypes';
import { prepareStorageForAudioRecording } from './recording/storagePlanning';

const DEFAULT_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

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

export {
  createDefaultAudioRecordingCaptureBackend,
};
export { FallbackAudioRecordingCaptureBackend } from './recording/captureBackendFactory';
export { MediaRecorderAudioCaptureBackend } from './recording/mediaRecorderCaptureBackend';
export { AudioWorkletAudioCaptureBackend } from './recording/workletCaptureBackend';

export class AudioRecordingService {
  private readonly backend: AudioRecordingCaptureBackend;
  private readonly encodeToWav: boolean;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly recoveryBlobStore?: AudioRecordingRecoveryBlobStore;
  private readonly recordingRepositories = new Map<string, ReturnType<typeof getEditorRepositorySession>>();
  private readonly recordingBlobStores = new Map<string, AudioRecordingRecoveryBlobStore>();
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
    this.recoveryBlobStore = options.recoveryBlobStore;
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

    const pinnedBlobStore = this.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore();
    const startedAt = options.startedAt ?? this.now();
    const sessionId = options.sessionId ?? createRecordingSessionId(startedAt);
    this.recordingBlobStores.set(sessionId, pinnedBlobStore);
    this.recordingRepositories.set(sessionId, getEditorRepositorySession());
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
    if (this.recordingRepositories.has(result.sessionId) && this.recordingRepositories.get(result.sessionId) !== getEditorRepositorySession()) throw new Error('Recording belongs to another project session.');
    if (this.committedSessionIds.has(result.sessionId)) {
      return { sessionId: result.sessionId, clips: [] };
    }

    const commitResult = await commitAudioRecordingResultToTimeline(result, deps);

    this.committedSessionIds.add(result.sessionId);
    const recoveryEntry = this.listRecoveryEntries().find(entry => entry.sessionId === result.sessionId);
    this.removeRecoveryEntry(result.sessionId);
    if (recoveryEntry) {
      await this.deleteRecoveryArtifacts(recoveryEntry);
    }
    this.setSnapshot(this.snapshot);
    return commitResult;
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
    await deleteRecoveryEntryArtifacts(entry, this.recordingBlobStores.get(entry.sessionId) ?? this.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore());
    this.recordingBlobStores.delete(entry.sessionId); this.recordingRepositories.delete(entry.sessionId);
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
    return restoreAudioRecordingRecoveryAssets(entry, this.recordingBlobStores.get(entry.sessionId) ?? this.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore());
  }

  private async persistRecoveryAssets(
    assets: readonly AudioRecordedAsset[],
  ): Promise<AudioRecordingRecoveryAssetRef[] | undefined> {
    return persistAudioRecordingRecoveryAssets(assets, this.recordingBlobStores.get(assets[0]?.sessionId ?? '') ?? this.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore());
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
    return prepareStorageForAudioRecording({
      storageManager: this.storageManager,
      ...input,
    });
  }

  private getSessionStateMachineContext(): AudioRecordingSessionStateMachineContext {
    return {
      backend: this.backend,
      now: this.now,
      getActiveSession: () => this.activeSession,
      setActiveSession: (session) => {
        this.activeSession = session;
      },
      getSnapshot: () => this.snapshot,
      setSnapshot: snapshot => this.setSnapshot(snapshot),
      createRecoveryChunkSink: session => this.createRecoveryChunkSink(session),
      persistRecoveryEntry: entry => this.persistRecoveryEntry(entry),
      stop: () => this.stop(),
    };
  }

  private async beginSessionCapture(
    session: ActiveRecordingSession,
    options: { pausedUntilPunch?: boolean } = {},
  ): Promise<void> {
    return beginAudioRecordingSessionCapture(this.getSessionStateMachineContext(), session, options);
  }

  private armPunchInMonitor(session: ActiveRecordingSession): void {
    armAudioRecordingPunchInMonitor(this.getSessionStateMachineContext(), session);
  }

  private clearPunchInMonitor(session: ActiveRecordingSession): void {
    clearAudioRecordingPunchInMonitor(session);
  }

  private clearPunchOutMonitor(session: ActiveRecordingSession): void {
    clearAudioRecordingPunchOutMonitor(session);
  }

  private createRecoveryChunkSink(session: ActiveRecordingSession): AudioRecordingChunkSink {
    const blobStore = this.recordingBlobStores.get(session.sessionId) ?? this.recoveryBlobStore ?? new ArtifactAudioRecordingRecoveryBlobStore();
    return {
      writeChunk: async (chunk) => {
        const ref = await blobStore.putChunk(chunk);
        this.appendRecoveryChunk(session.sessionId, ref);
        return ref;
      },
    };
  }

  private appendRecoveryChunk(sessionId: string, chunkRef: AudioRecordingRecoveryChunkRef): void {
    appendRecoveryChunkRef(this.storage, sessionId, chunkRef);
  }

  private async prepareRecordedAsset(
    session: ActiveRecordingSession,
    group: ActiveCaptureGroup,
    raw: AudioRecordingRawResult,
    stoppedAt: number,
  ): Promise<AudioRecordedAsset> {
    return prepareAudioRecordedAsset(session, group, raw, stoppedAt, this.encodeToWav);
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
