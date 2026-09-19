import { useMediaStore } from '../stores/mediaStore';
import {
  LANDING_FINAL_OUTPUT_PREFIX,
  runLandingBackgroundCreation,
  type LandingBackgroundCreationPhase,
  type LandingBackgroundCreationResult,
  type LandingBackgroundStatus,
  type LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';
import {
  beginLandingEditTurn,
  createLandingEditSession,
  isLandingEditSession,
  selectLandingEditVariant,
  settleLandingEditTurn,
  type LandingEditSession,
  type LandingReviewPromptMode,
} from './landingEditSession';
import { cloneTranscriptReviewEdits } from '../services/captions/transcriptReviewEdits';
import { cloneCompositionGraphForVariant } from '../services/storyboard/variants/compositionGraphClone';

const LANDING_BACKGROUND_JOB_STORAGE_KEY = 'masterselects.landing.background-job.v1';

export type LandingBackgroundJobState =
  | 'queued'
  | 'running'
  | 'awaiting-review'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface LandingBackgroundJobSnapshot {
  createdAt: number;
  editSession?: LandingEditSession;
  error?: string;
  id: string;
  outputFileId?: string;
  phase: LandingBackgroundCreationPhase;
  preproductionRunId?: string;
  projectId: string | null;
  prompt: string;
  requestHistoryMessageIds?: string[];
  reviewBeforeRender?: boolean;
  reviewCompositionId?: string;
  sourceFileIds: string[];
  state: LandingBackgroundJobState;
  status: LandingBackgroundStatus;
  targetVariantId?: string;
  updatedAt: number;
  version: 1;
  workspaceCompositionId?: string;
}

export interface LandingBackgroundJobStartOptions {
  idempotencyKey?: string;
  preproductionRunId?: string;
  reviewBeforeRender?: boolean;
  reviewMode?: LandingReviewPromptMode;
  sourceFileIds?: string[];
  targetCompositionId?: string;
}

type LandingBackgroundJobListener = () => void;

interface LandingBackgroundJobRuntime {
  activeAbortController: AbortController | null;
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
      || parsed.sourceFileIds.some((id) => typeof id !== 'string' || id.length > 200)
      || (parsed.workspaceCompositionId !== undefined
        && (typeof parsed.workspaceCompositionId !== 'string'
          || parsed.workspaceCompositionId.length > 200))
      || (parsed.preproductionRunId !== undefined
        && !/^seedance-preproduction-[A-Za-z0-9._:-]{8,180}$/.test(parsed.preproductionRunId))
      || (parsed.reviewBeforeRender !== undefined
        && typeof parsed.reviewBeforeRender !== 'boolean')
      || (parsed.reviewCompositionId !== undefined
        && (typeof parsed.reviewCompositionId !== 'string'
          || parsed.reviewCompositionId.length > 200))
      || (parsed.editSession !== undefined && !isLandingEditSession(parsed.editSession))
      || (parsed.requestHistoryMessageIds !== undefined
        && (
          !Array.isArray(parsed.requestHistoryMessageIds)
          || parsed.requestHistoryMessageIds.length > 400
          || parsed.requestHistoryMessageIds.some(
            id => typeof id !== 'string' || id.length > 240,
          )
        ))
      || (parsed.targetVariantId !== undefined
        && (typeof parsed.targetVariantId !== 'string'
          || parsed.targetVariantId.length > 240))
    ) {
      return null;
    }
    return parsed as LandingBackgroundJobSnapshot;
  } catch {
    return null;
  }
}

const runtime: LandingBackgroundJobRuntime = runtimeGlobal.__MASTERSELECTS_LANDING_BACKGROUND_JOB__ ?? {
  activeAbortController: null,
  activePromise: null,
  listeners: new Set<LandingBackgroundJobListener>(),
  snapshot: readPersistedJob(),
};
runtime.activeAbortController ??= null;
runtimeGlobal.__MASTERSELECTS_LANDING_BACKGROUND_JOB__ = runtime;

function isJobState(value: unknown): value is LandingBackgroundJobState {
  return value === 'queued'
    || value === 'running'
    || value === 'awaiting-review'
    || value === 'completed'
    || value === 'failed'
    || value === 'stopped';
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

function availableSourceFileIds(): string[] {
  return useMediaStore.getState().files
    .filter((file) => (
      !file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX)
    ))
    .map((file) => file.id);
}

function requestedSourceFileIds(requested: readonly string[] | undefined): string[] {
  const available = new Set(availableSourceFileIds());
  if (requested === undefined) return [...available];
  const selected = [...new Set(requested)];
  if (selected.some((id) => !available.has(id))) {
    throw new Error('One or more selected source files are no longer available.');
  }
  return selected;
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
  if (
    snapshot.reviewCompositionId
    && !media.compositions.some((composition) => composition.id === snapshot.reviewCompositionId)
  ) return false;
  return snapshot.sourceFileIds.every((id) => (
    media.files.some((file) => file.id === id)
  ));
}

async function executeJob(
  snapshot: LandingBackgroundJobSnapshot,
  abortController: AbortController,
  externalReporter?: LandingBackgroundStatusReporter,
): Promise<LandingBackgroundCreationResult> {
  const reportStatus: LandingBackgroundStatusReporter = (status) => {
    if (abortController.signal.aborted) return;
    updateSnapshot(snapshot.id, { state: 'running', status });
    externalReporter?.(status);
  };

  updateSnapshot(snapshot.id, {
    state: 'running',
    status: snapshot.phase === 'rendering'
      ? { label: 'Preparing the render…' }
      : snapshot.state === 'queued'
      ? { label: 'Starting AI…' }
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
        ...(snapshot.preproductionRunId === undefined
          ? {}
          : { preproductionRunId: snapshot.preproductionRunId }),
        ...(snapshot.requestHistoryMessageIds === undefined
          ? {}
          : { historyMessageIds: snapshot.requestHistoryMessageIds }),
        pauseBeforeRender: snapshot.reviewBeforeRender === true,
        ...(snapshot.reviewCompositionId === undefined
          ? {}
          : { reviewCompositionId: snapshot.reviewCompositionId }),
        sourceFileIds: snapshot.sourceFileIds,
        ...(snapshot.workspaceCompositionId === undefined
          ? {}
          : { workspaceCompositionId: snapshot.workspaceCompositionId }),
        resumeFrom: snapshot.phase,
        signal: abortController.signal,
        onPhaseChange: (phase) => updateSnapshot(snapshot.id, { phase }),
        onReviewCompositionChange: (reviewCompositionId) => {
          updateSnapshot(snapshot.id, { reviewCompositionId });
        },
        onWorkspaceCompositionChange: (workspaceCompositionId) => {
          updateSnapshot(snapshot.id, { workspaceCompositionId });
        },
      },
    );
    const currentSession = runtime.snapshot?.id === snapshot.id
      ? runtime.snapshot.editSession
      : snapshot.editSession;
    const settledSession = result.readyForReview
      && result.reviewCompositionId
      && snapshot.targetVariantId
      && currentSession
      ? settleLandingEditTurn({
          compositionId: result.reviewCompositionId,
          session: currentSession,
          status: 'ready',
          targetVariantId: snapshot.targetVariantId,
        })
      : currentSession;
    updateSnapshot(snapshot.id, {
      ...(settledSession === undefined ? {} : { editSession: settledSession }),
      ...(result.renderedFileId === undefined
        ? {}
        : { outputFileId: result.renderedFileId }),
      ...(result.reviewCompositionId === undefined
        ? {}
        : { reviewCompositionId: result.reviewCompositionId }),
      state: result.readyForReview ? 'awaiting-review' : 'completed',
      status: {
        label: result.readyForReview
          ? 'Edit ready for review'
          : result.renderedFileId ? 'Video ready' : 'Done',
      },
    });
    return result;
  } catch (error) {
    if (abortController.signal.aborted) {
      updateSnapshot(snapshot.id, {
        error: undefined,
        state: 'stopped',
        status: { label: 'Stopped' },
      });
      throw abortController.signal.reason instanceof Error
        ? abortController.signal.reason
        : new DOMException('AI task stopped.', 'AbortError');
    }
    const message = error instanceof Error ? error.message : String(error);
    const current = runtime.snapshot?.id === snapshot.id ? runtime.snapshot : snapshot;
    const selectedCompositionId = current.reviewCompositionId
      ?? current.editSession?.variants.find(
        variant => variant.id === current.targetVariantId,
      )?.compositionId;
    const failedSession = current.editSession
      && current.targetVariantId
      && selectedCompositionId
      ? settleLandingEditTurn({
          compositionId: selectedCompositionId,
          session: current.editSession,
          status: 'failed',
          targetVariantId: current.targetVariantId,
        })
      : current.editSession;
    updateSnapshot(snapshot.id, {
      ...(failedSession === undefined ? {} : { editSession: failedSession }),
      error: message,
      state: 'failed',
      status: { detail: message, label: 'Something went wrong' },
    });
    throw error;
  } finally {
    runtime.activePromise = null;
    if (runtime.activeAbortController === abortController) {
      runtime.activeAbortController = null;
    }
  }
}

export function getLandingBackgroundJobSnapshot(): LandingBackgroundJobSnapshot | null {
  return runtime.snapshot;
}

export function subscribeLandingBackgroundJob(listener: LandingBackgroundJobListener): () => void {
  runtime.listeners.add(listener);
  return () => runtime.listeners.delete(listener);
}

function launchJobSnapshot(
  snapshot: LandingBackgroundJobSnapshot,
  onStatus?: LandingBackgroundStatusReporter,
): Promise<LandingBackgroundCreationResult> {
  publishSnapshot(snapshot);
  const abortController = new AbortController();
  runtime.activeAbortController = abortController;
  runtime.activePromise = executeJob(snapshot, abortController, onStatus);
  return runtime.activePromise;
}

export function startLandingBackgroundJob(
  prompt: string,
  onStatus?: LandingBackgroundStatusReporter,
  options: LandingBackgroundJobStartOptions = {},
): Promise<LandingBackgroundCreationResult> {
  const visiblePrompt = prompt.trim();
  if (!visiblePrompt) return Promise.reject(new Error('Please enter a prompt.'));
  if (runtime.activePromise) return runtime.activePromise;

  const media = useMediaStore.getState();
  const targetCompositionId = options.targetCompositionId?.trim();
  if (targetCompositionId && !media.compositions.some(({ id }) => id === targetCompositionId)) {
    return Promise.reject(new Error('The selected sequence is no longer available.'));
  }
  const createdAt = Date.now();
  const jobId = options.idempotencyKey ?? createJobId();
  if (runtime.snapshot?.id === jobId && runtime.snapshot.state === 'completed') {
    return Promise.resolve({
      ...(runtime.snapshot.outputFileId === undefined
        ? {}
        : { renderedFileId: runtime.snapshot.outputFileId }),
      response: '',
    });
  }
  let selectedSourceFileIds: string[];
  try {
    selectedSourceFileIds = requestedSourceFileIds(options.sourceFileIds);
  } catch (error) {
    return Promise.reject(error);
  }
  const editTurn = options.reviewBeforeRender === true
    ? createLandingEditSession(jobId, visiblePrompt, createdAt)
    : undefined;
  const snapshot: LandingBackgroundJobSnapshot = {
    createdAt,
    ...(editTurn === undefined ? {} : { editSession: editTurn.session }),
    id: jobId,
    phase: 'preparing',
    ...(options.preproductionRunId === undefined
      ? {}
      : { preproductionRunId: options.preproductionRunId }),
    projectId: media.currentProjectId,
    prompt: visiblePrompt,
    ...(editTurn === undefined
      ? {}
      : {
          requestHistoryMessageIds: editTurn.requestHistoryMessageIds,
          targetVariantId: editTurn.targetVariantId,
        }),
    ...(options.reviewBeforeRender === undefined
      ? {}
      : { reviewBeforeRender: options.reviewBeforeRender }),
    ...(targetCompositionId ? { reviewCompositionId: targetCompositionId } : {}),
    sourceFileIds: selectedSourceFileIds,
    state: 'queued',
    status: { label: 'Starting AI…' },
    updatedAt: createdAt,
    version: 1,
  };
  return launchJobSnapshot(snapshot, onStatus);
}

export async function continueLandingBackgroundJob(
  prompt: string,
  mode: LandingReviewPromptMode,
  onStatus?: LandingBackgroundStatusReporter,
): Promise<LandingBackgroundCreationResult> {
  const visiblePrompt = prompt.trim();
  if (!visiblePrompt) throw new Error('Please enter a prompt.');
  if (runtime.activePromise) return runtime.activePromise;

  const previous = runtime.snapshot;
  if (
    !previous
    || previous.reviewBeforeRender !== true
    || (
      previous.state !== 'awaiting-review'
      && !(previous.state === 'failed' && previous.phase === 'editing')
    )
    || !previous.reviewCompositionId
    || !previous.editSession
  ) {
    throw new Error('There is no reviewed chat edit to continue.');
  }

  const media = useMediaStore.getState();
  const selected = previous.editSession.variants.find(
    variant => variant.id === previous.editSession?.activeVariantId,
  );
  if (!selected?.compositionId) {
    throw new Error('The selected chat edit version is no longer available.');
  }
  const selectedComposition = media.compositions.find(
    composition => composition.id === selected.compositionId,
  );
  if (!selectedComposition) {
    throw new Error('The selected chat edit composition was deleted.');
  }

  let targetCompositionId = selectedComposition.id;
  if (mode === 'variant') {
    const cloned = cloneCompositionGraphForVariant(media.compositions, selectedComposition.id);
    useMediaStore.setState(state => ({
      compositions: [...state.compositions, ...cloned.compositions],
    }));
    const duplicate = cloned.compositions.find(
      composition => composition.id === cloned.rootCompositionId,
    );
    if (!duplicate) throw new Error('The selected edit could not be duplicated.');
    const nextNumber = previous.editSession.variants.length + 1;
    media.updateComposition(duplicate.id, {
      name: `${selectedComposition.name.replace(/ · Version \d+$/u, '')} · Version ${nextNumber}`,
    });
    cloneTranscriptReviewEdits(selectedComposition.id, duplicate.id, {
      clipIds: Object.fromEntries(
        Object.entries(cloned.idMap.clipIds)
          .filter(([source]) => source.startsWith(`${selectedComposition.id}\u0000`))
          .map(([source, target]) => [source.slice(selectedComposition.id.length + 1), target]),
      ),
      trackIds: Object.fromEntries(
        Object.entries(cloned.idMap.trackIds)
          .filter(([source]) => source.startsWith(`${selectedComposition.id}\u0000`))
          .map(([source, target]) => [source.slice(selectedComposition.id.length + 1), target]),
      ),
    });
    targetCompositionId = duplicate.id;
  }
  if (media.activeCompositionId !== targetCompositionId) {
    await media.openCompositionTab(targetCompositionId, { skipAnimation: true });
  }

  const createdAt = Date.now();
  const jobId = createJobId();
  const editTurn = beginLandingEditTurn({
    compositionId: targetCompositionId,
    jobId,
    mode,
    now: createdAt,
    prompt: visiblePrompt,
    session: previous.editSession,
  });
  return launchJobSnapshot({
    createdAt,
    editSession: editTurn.session,
    id: jobId,
    phase: 'editing',
    projectId: media.currentProjectId,
    prompt: visiblePrompt,
    requestHistoryMessageIds: editTurn.requestHistoryMessageIds,
    reviewBeforeRender: true,
    reviewCompositionId: targetCompositionId,
    sourceFileIds: previous.sourceFileIds,
    state: 'queued',
    status: { label: mode === 'variant' ? 'Creating new versionâ€¦' : 'Updating editâ€¦' },
    targetVariantId: editTurn.targetVariantId,
    updatedAt: createdAt,
    version: 1,
  }, onStatus);
}

export async function selectLandingBackgroundJobVariant(variantId: string): Promise<boolean> {
  const snapshot = runtime.snapshot;
  if (runtime.activePromise || !snapshot?.editSession) return false;
  const session = selectLandingEditVariant(snapshot.editSession, variantId);
  if (!session) return false;
  const variant = session.variants.find(candidate => candidate.id === variantId);
  if (!variant?.compositionId) return false;
  const media = useMediaStore.getState();
  if (!media.compositions.some(composition => composition.id === variant.compositionId)) {
    return false;
  }
  if (media.activeCompositionId !== variant.compositionId) {
    await media.openCompositionTab(variant.compositionId, { skipAnimation: true });
  }
  updateSnapshot(snapshot.id, {
    editSession: session,
    reviewCompositionId: variant.compositionId,
  });
  return true;
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

  const abortController = new AbortController();
  runtime.activeAbortController = abortController;
  runtime.activePromise = executeJob(snapshot, abortController);
  return runtime.activePromise;
}

export function renderLandingBackgroundJob(): Promise<LandingBackgroundCreationResult> | null {
  const snapshot = runtime.snapshot;
  if (
    runtime.activePromise
    || !snapshot
    || snapshot.reviewBeforeRender !== true
    || !snapshot.reviewCompositionId
  ) {
    return runtime.activePromise;
  }
  const canStartRender = snapshot.state === 'awaiting-review'
    || (snapshot.state === 'failed' && snapshot.phase === 'rendering');
  if (!canStartRender || !canResumeJob(snapshot)) return null;

  const renderSnapshot = updateSnapshot(snapshot.id, {
    error: undefined,
    phase: 'rendering',
    state: 'queued',
    status: { label: 'Preparing the render…' },
  });
  if (!renderSnapshot) return null;

  const abortController = new AbortController();
  runtime.activeAbortController = abortController;
  runtime.activePromise = executeJob(renderSnapshot, abortController);
  return runtime.activePromise;
}

export function stopLandingBackgroundJob(): boolean {
  const snapshot = runtime.snapshot;
  const abortController = runtime.activeAbortController;
  if (
    !snapshot
    || (snapshot.state !== 'queued' && snapshot.state !== 'running')
    || !abortController
  ) return false;

  updateSnapshot(snapshot.id, {
    error: undefined,
    state: 'stopped',
    status: { label: 'Stopped' },
  });
  abortController.abort(new DOMException('AI task stopped.', 'AbortError'));
  return true;
}
