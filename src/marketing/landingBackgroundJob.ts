import { useMediaStore } from '../stores/mediaStore';
import {
  LANDING_FINAL_OUTPUT_PREFIX,
  runLandingBackgroundCreation,
  type LandingBackgroundCreationPhase,
  type LandingBackgroundCreationResult,
  type LandingBackgroundStatus,
  type LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';

const LANDING_BACKGROUND_JOB_STORAGE_KEY = 'masterselects.landing.background-job.v1';

export type LandingBackgroundJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export interface LandingBackgroundJobSnapshot {
  createdAt: number;
  error?: string;
  id: string;
  outputFileId?: string;
  phase: LandingBackgroundCreationPhase;
  projectId: string | null;
  prompt: string;
  sourceFileIds: string[];
  state: LandingBackgroundJobState;
  status: LandingBackgroundStatus;
  updatedAt: number;
  version: 1;
}

type LandingBackgroundJobListener = () => void;

interface LandingBackgroundJobRuntime {
  activePromise: Promise<LandingBackgroundCreationResult> | null;
  listeners: Set<LandingBackgroundJobListener>;
  snapshot: LandingBackgroundJobSnapshot | null;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __MASTERSELECTS_LANDING_BACKGROUND_JOB__?: LandingBackgroundJobRuntime;
};

function readPersistedJob(): LandingBackgroundJobSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LANDING_BACKGROUND_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LandingBackgroundJobSnapshot>;
    if (
      parsed.version !== 1
      || typeof parsed.id !== 'string'
      || typeof parsed.prompt !== 'string'
      || !isJobState(parsed.state)
      || !isCreationPhase(parsed.phase)
      || !isLandingStatus(parsed.status)
      || !Array.isArray(parsed.sourceFileIds)
    ) {
      return null;
    }
    return parsed as LandingBackgroundJobSnapshot;
  } catch {
    return null;
  }
}

const runtime: LandingBackgroundJobRuntime = runtimeGlobal.__MASTERSELECTS_LANDING_BACKGROUND_JOB__ ?? {
  activePromise: null,
  listeners: new Set<LandingBackgroundJobListener>(),
  snapshot: readPersistedJob(),
};
runtimeGlobal.__MASTERSELECTS_LANDING_BACKGROUND_JOB__ = runtime;

function isJobState(value: unknown): value is LandingBackgroundJobState {
  return value === 'queued'
    || value === 'running'
    || value === 'completed'
    || value === 'failed';
}

function isCreationPhase(value: unknown): value is LandingBackgroundCreationPhase {
  return value === 'preparing' || value === 'editing' || value === 'rendering';
}

function isLandingStatus(value: unknown): value is LandingBackgroundStatus {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { label?: unknown }).label === 'string',
  );
}

function persistSnapshot(snapshot: LandingBackgroundJobSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LANDING_BACKGROUND_JOB_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // The in-memory job still remains usable when storage is unavailable.
  }
}

function publishSnapshot(snapshot: LandingBackgroundJobSnapshot): void {
  runtime.snapshot = snapshot;
  persistSnapshot(snapshot);
  runtime.listeners.forEach((listener) => listener());
}

function updateSnapshot(
  id: string,
  patch: Partial<LandingBackgroundJobSnapshot>,
): LandingBackgroundJobSnapshot | null {
  const current = runtime.snapshot;
  if (!current || current.id !== id) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  publishSnapshot(next);
  return next;
}

function createJobId(): string {
  return `landing-${Date.now().toString(36)}-${globalThis.crypto.randomUUID()}`;
}

function sourceFileIds(): string[] {
  return useMediaStore.getState().files
    .filter((file) => (
      file.type === 'video'
      && !file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX)
    ))
    .map((file) => file.id);
}

function canResumeJob(snapshot: LandingBackgroundJobSnapshot): boolean {
  const media = useMediaStore.getState();
  if (media.isLoading) return false;
  if (
    snapshot.projectId
    && media.currentProjectId
    && snapshot.projectId !== media.currentProjectId
  ) {
    return false;
  }
  return snapshot.sourceFileIds.every((id) => (
    media.files.some((file) => file.id === id)
  ));
}

async function executeJob(
  snapshot: LandingBackgroundJobSnapshot,
  externalReporter?: LandingBackgroundStatusReporter,
): Promise<LandingBackgroundCreationResult> {
  const reportStatus: LandingBackgroundStatusReporter = (status) => {
    updateSnapshot(snapshot.id, { state: 'running', status });
    externalReporter?.(status);
  };

  updateSnapshot(snapshot.id, {
    state: 'running',
    status: snapshot.state === 'queued'
      ? { label: 'Thinking…' }
      : { label: 'Resuming…' },
  });

  try {
    if (snapshot.phase === 'rendering') {
      const existingOutput = useMediaStore.getState().files.find((file) => (
        file.type === 'video'
        && file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX)
        && file.createdAt >= snapshot.createdAt
      ));
      if (existingOutput) {
        const result = { renderedFileId: existingOutput.id, response: '' };
        updateSnapshot(snapshot.id, {
          outputFileId: existingOutput.id,
          state: 'completed',
          status: { label: 'Video ready' },
        });
        return result;
      }
    }

    const result = await runLandingBackgroundCreation(
      snapshot.prompt,
      reportStatus,
      {
        idempotencyKey: snapshot.id,
        resumeFrom: snapshot.phase,
        onPhaseChange: (phase) => updateSnapshot(snapshot.id, { phase }),
      },
    );
    updateSnapshot(snapshot.id, {
      ...(result.renderedFileId === undefined
        ? {}
        : { outputFileId: result.renderedFileId }),
      state: 'completed',
      status: { label: result.renderedFileId ? 'Video ready' : 'Done' },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateSnapshot(snapshot.id, {
      error: message,
      state: 'failed',
      status: { detail: message, label: 'Something went wrong' },
    });
    throw error;
  } finally {
    runtime.activePromise = null;
  }
}

export function getLandingBackgroundJobSnapshot(): LandingBackgroundJobSnapshot | null {
  return runtime.snapshot;
}

export function subscribeLandingBackgroundJob(listener: LandingBackgroundJobListener): () => void {
  runtime.listeners.add(listener);
  return () => runtime.listeners.delete(listener);
}

export function startLandingBackgroundJob(
  prompt: string,
  onStatus?: LandingBackgroundStatusReporter,
): Promise<LandingBackgroundCreationResult> {
  const visiblePrompt = prompt.trim();
  if (!visiblePrompt) return Promise.reject(new Error('Please enter a prompt.'));
  if (runtime.activePromise) return runtime.activePromise;

  const media = useMediaStore.getState();
  const createdAt = Date.now();
  const snapshot: LandingBackgroundJobSnapshot = {
    createdAt,
    id: createJobId(),
    phase: 'preparing',
    projectId: media.currentProjectId,
    prompt: visiblePrompt,
    sourceFileIds: sourceFileIds(),
    state: 'queued',
    status: { label: 'Thinking…' },
    updatedAt: createdAt,
    version: 1,
  };
  publishSnapshot(snapshot);
  runtime.activePromise = executeJob(snapshot, onStatus);
  return runtime.activePromise;
}

export function resumeLandingBackgroundJob(): Promise<LandingBackgroundCreationResult> | null {
  const snapshot = runtime.snapshot;
  if (
    runtime.activePromise
    || !snapshot
    || (snapshot.state !== 'queued' && snapshot.state !== 'running')
    || !canResumeJob(snapshot)
  ) {
    return runtime.activePromise;
  }

  runtime.activePromise = executeJob(snapshot);
  return runtime.activePromise;
}
