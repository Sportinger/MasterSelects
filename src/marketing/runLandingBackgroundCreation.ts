import { appendFlashBoardPromptHistoryEntry } from '../stores/flashboardStore/activeGenerationRecords';
import { useFlashBoardStore } from '../stores/flashboardStore';
import { findFlashBoardChatRunByIdempotencyKey } from '../services/flashboard/FlashBoardChatRunAudit';
import type { KernelProgressStage } from '../services/kernelClient/runProgress';
import { renderHostPort } from '../services/render/renderHostPort';
import {
  readSeedanceMediaStore,
  readSeedancePreproductionStore,
  readSeedanceTimelineStore,
  subscribeSeedanceTimelineStore,
} from '../services/seedancePreproduction/storeRuntime';

export const LANDING_FINAL_OUTPUT_PREFIX = 'MasterSelects Final';

export interface LandingBackgroundCreationResult {
  readyForReview?: boolean;
  reviewCompositionId?: string;
  renderedFileId?: string;
  response: string;
}

export interface LandingBackgroundStatus {
  detail?: string;
  label: string;
  progress?: number;
  stage?: KernelProgressStage;
  steps?: string[];
}

export type LandingBackgroundStatusReporter = (status: LandingBackgroundStatus) => void;

export type LandingBackgroundCreationPhase = 'preparing' | 'editing' | 'rendering';

export interface LandingBackgroundCreationOptions {
  historyMessageIds?: string[];
  idempotencyKey?: string;
  onPhaseChange?: (phase: LandingBackgroundCreationPhase) => void;
  onReviewCompositionChange?: (compositionId: string) => void;
  onWorkspaceCompositionChange?: (compositionId: string) => void;
  pauseBeforeRender?: boolean;
  preproductionRunId?: string;
  resumeFrom?: LandingBackgroundCreationPhase;
  reviewCompositionId?: string;
  signal?: AbortSignal;
  sourceFileIds?: string[];
  workspaceCompositionId?: string;
}

const MAX_VISIBLE_STATUS_STEPS = 6;

function visibleStepLabel(label: string): string {
  return label.trim().replace(/(?:\.\.\.|\u2026)$/u, '');
}

function createLandingStatusReporter(
  reporter?: LandingBackgroundStatusReporter,
): LandingBackgroundStatusReporter {
  let steps: string[] = [];
  return (status) => {
    if (!reporter) return;
    const step = visibleStepLabel(status.label);
    if (step && steps.at(-1) !== step) {
      steps = [...steps, step].slice(-MAX_VISIBLE_STATUS_STEPS);
    }
    reporter({ ...status, steps: [...steps] });
  };
}

function selectedSourceVideos(sourceFileIds?: readonly string[]) {
  const selected = sourceFileIds === undefined ? null : new Set(sourceFileIds);
  return readSeedanceMediaStore().files.filter((file) => (
    file.type === 'video'
    && !file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX)
    && (selected === null || selected.has(file.id))
  ));
}

function findSingleSourceVideo(sourceFileIds?: readonly string[]) {
  const sourceVideos = selectedSourceVideos(sourceFileIds);
  return sourceVideos.length === 1 ? sourceVideos[0] : undefined;
}

async function ensureSingleVideoTimelineClip(
  onStatus?: LandingBackgroundStatusReporter,
  sourceFileIds?: readonly string[],
): Promise<string | undefined> {
  const sourceVideo = findSingleSourceVideo(sourceFileIds);
  if (!sourceVideo) return undefined;

  const timeline = readSeedanceTimelineStore();
  const existingClip = timeline.clips.find((clip) => (
    clip.source?.type === 'video'
    && (clip.source.mediaFileId === sourceVideo.id || clip.mediaFileId === sourceVideo.id)
  ));
  if (existingClip) return existingClip.id;
  if (!sourceVideo.file) {
    throw new Error('The source video is unavailable for background analysis.');
  }

  const targetTrack = timeline.tracks.find((track) => (
    track.type === 'video' && !track.locked
  ));
  if (!targetTrack) throw new Error('No available video track was found.');

  onStatus?.({ label: 'Preparing video…' });
  return readSeedanceTimelineStore().addClip(
    targetTrack.id,
    sourceVideo.file,
    0,
    sourceVideo.duration,
    sourceVideo.id,
    'video',
  );
}

async function transcribeSingleVideo(
  clipId: string,
  onStatus?: LandingBackgroundStatusReporter,
  signal?: AbortSignal,
  sourceFileIds?: readonly string[],
): Promise<void> {
  signal?.throwIfAborted();
  const initialClip = readSeedanceTimelineStore().clips.find((clip) => clip.id === clipId);
  const sourceVideo = findSingleSourceVideo(sourceFileIds);
  const transcriptReady = (
    initialClip?.transcriptStatus === 'ready'
    && Boolean(initialClip.transcript?.length)
  ) || (
    sourceVideo?.transcriptStatus === 'ready'
    && Boolean(sourceVideo.transcript?.length)
  );
  if (transcriptReady || sourceVideo?.hasAudio === false) return;

  onStatus?.({ label: 'Transcribing video…' });
  let lastProgress = -1;
  let lastMessage = '';
  const unsubscribe = subscribeSeedanceTimelineStore((state) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    const progress = Math.max(0, Math.min(100, Math.round(clip?.transcriptProgress ?? 0)));
    const detail = clip?.transcriptMessage?.trim() ?? '';
    if (progress === lastProgress && detail === lastMessage) return;
    lastProgress = progress;
    lastMessage = detail;
    onStatus?.({
      label: 'Transcribing video…',
      ...(detail ? { detail } : {}),
      ...(progress > 0 ? { progress } : {}),
    });
  });

  try {
    const { cancelTranscription, transcribeClip } = await import('../services/clipTranscriber');
    const cancel = () => cancelTranscription(clipId);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      await transcribeClip(clipId, 'auto');
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  } finally {
    unsubscribe();
  }

  const completedClip = readSeedanceTimelineStore().clips.find((clip) => clip.id === clipId);
  if (completedClip?.transcriptStatus === 'error') {
    throw new Error(completedClip.transcriptMessage || 'Video transcription failed.');
  }
  const completedSource = findSingleSourceVideo(sourceFileIds);
  const transcriptCompleted = (
    completedClip?.transcriptStatus === 'ready'
    && Boolean(completedClip.transcript?.length)
  ) || (
    completedSource?.transcriptStatus === 'ready'
    && Boolean(completedSource.transcript?.length)
  );
  if (!transcriptCompleted) {
    throw new Error('Video transcription did not produce a usable transcript.');
  }
}

async function analyseSingleVideoAudio(
  clipId: string,
  onStatus?: LandingBackgroundStatusReporter,
  signal?: AbortSignal,
  sourceFileIds?: readonly string[],
): Promise<void> {
  signal?.throwIfAborted();
  const sourceVideo = findSingleSourceVideo(sourceFileIds);
  if (sourceVideo?.hasAudio === false) return;

  onStatus?.({ label: 'Analysing audio…' });
  let lastProgress = -1;
  let lastMessage = '';
  const unsubscribe = subscribeSeedanceTimelineStore((state) => {
    const job = state.clips.find((candidate) => candidate.id === clipId)?.audioAnalysisJob;
    if (!job || job.kind !== 'audio-intelligence') return;
    const progress = Math.max(0, Math.min(100, Math.round(job.progress)));
    const detail = job.message?.trim() ?? '';
    if (progress === lastProgress && detail === lastMessage) return;
    lastProgress = progress;
    lastMessage = detail;
    onStatus?.({
      label: 'Analysing audio…',
      ...(detail ? { detail } : {}),
      ...(progress > 0 ? { progress } : {}),
    });
  });

  try {
    const cancel = () => readSeedanceTimelineStore().cancelAudioAnalysisForClip(clipId);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      signal?.throwIfAborted();
      await readSeedanceTimelineStore().generateAudioIntelligenceForClip(clipId);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  } finally {
    unsubscribe();
  }

  const refs = readSeedanceTimelineStore().clips.find(
    (candidate) => candidate.id === clipId,
  )?.audioState?.sourceAnalysisRefs;
  if (
    !refs?.voiceActivityId
    || !refs.transcriptTimingId
    || !refs.speechMarkersId
    || !refs.prosodyContourId
    || !refs.roomToneProfileId
  ) {
    throw new Error('Audio intelligence did not finish successfully.');
  }
}

async function prepareSingleVideoForAI(
  onStatus?: LandingBackgroundStatusReporter,
  signal?: AbortSignal,
  sourceFileIds?: readonly string[],
): Promise<void> {
  signal?.throwIfAborted();
  const clipId = await ensureSingleVideoTimelineClip(onStatus, sourceFileIds);
  if (!clipId) return;

  await transcribeSingleVideo(clipId, onStatus, signal, sourceFileIds);
  await analyseSingleVideoAudio(clipId, onStatus, signal, sourceFileIds);
}

async function ensureSeedanceEditWorkspace(
  options: LandingBackgroundCreationOptions,
  onStatus?: LandingBackgroundStatusReporter,
): Promise<void> {
  if (!options.preproductionRunId) return;
  options.signal?.throwIfAborted();
  const media = readSeedanceMediaStore();
  const existing = options.workspaceCompositionId
    ? media.compositions.find((composition) => composition.id === options.workspaceCompositionId)
    : undefined;
  if (existing) {
    if (media.activeCompositionId !== existing.id) {
      onStatus?.({ label: 'Opening Story edit workspace…' });
      await media.openCompositionTab(existing.id, { skipAnimation: true });
    }
    return;
  }

  const active = media.getActiveComposition();
  const preproductionRun = readSeedancePreproductionStore().runs[options.preproductionRunId];
  const duration = Math.max(1, Math.min(86_400, Math.round(
    preproductionRun?.story?.totalDurationSeconds
      ?? preproductionRun?.ideas.find((idea) => idea.id === preproductionRun.selectedIdeaId)
        ?.targetDurationSeconds
      ?? 30,
  )));
  onStatus?.({ label: 'Creating clean Story edit workspace…' });
  const workspace = media.createComposition('Story edit', {
    backgroundColor: active?.backgroundColor ?? '#000000',
    duration,
    frameRate: active?.frameRate ?? 30,
    height: active?.height ?? 1080,
    width: active?.width ?? 1920,
  });
  options.onWorkspaceCompositionChange?.(workspace.id);
  await readSeedanceMediaStore().openCompositionTab(workspace.id, { skipAnimation: true });
  options.signal?.throwIfAborted();
}

async function ensureReviewComposition(
  compositionId: string | undefined,
  onStatus?: LandingBackgroundStatusReporter,
): Promise<void> {
  if (!compositionId) return;
  const media = readSeedanceMediaStore();
  const composition = media.compositions.find((candidate) => candidate.id === compositionId);
  if (!composition) throw new Error('The composition created by this chat run is no longer available.');
  if (media.activeCompositionId === compositionId) return;
  onStatus?.({ label: 'Opening reviewed edit…' });
  await media.openCompositionTab(compositionId, { skipAnimation: true });
}

function evenDimension(value: number, fallback: number): number {
  const rounded = Math.max(2, Math.round(Number.isFinite(value) ? value : fallback));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveRenderRange(): { startTime: number; endTime: number } | null {
  const timeline = readSeedanceTimelineStore();
  if (!Array.isArray(timeline.clips) || timeline.clips.length === 0) return null;

  const firstClipStart = Math.min(...timeline.clips.map((clip) => clip.startTime));
  const lastClipEnd = Math.max(...timeline.clips.map((clip) => clip.startTime + clip.duration));
  const startTime = timeline.inPoint === null
    ? Math.max(0, firstClipStart)
    : Math.max(0, timeline.inPoint);
  const endTime = timeline.outPoint === null
    ? lastClipEnd
    : Math.min(timeline.outPoint, lastClipEnd);

  return endTime > startTime
    ? { startTime, endTime }
    : null;
}

function createOutputFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
  return `${LANDING_FINAL_OUTPUT_PREFIX} ${timestamp}.mp4`;
}

function prepareTimelineForEditorHandoff(startTime: number): void {
  const timeline = readSeedanceTimelineStore();
  timeline.pause();
  timeline.setPlayheadPosition(startTime);
  renderHostPort.clearScrubbingCache();
  renderHostPort.clearVideoCache();
  renderHostPort.clearCompositeCache();
  renderHostPort.requestNewFrameRender();
}

async function renderCurrentTimeline(
  onStatus?: LandingBackgroundStatusReporter,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  const range = resolveRenderRange();
  if (!range) return undefined;

  onStatus?.({ label: 'Preparing the render…' });
  const { FrameExporter } = await import('../engine/export');
  const mediaState = readSeedanceMediaStore();
  const composition = mediaState.compositions.find(
    (candidate) => candidate.id === mediaState.activeCompositionId,
  );
  const width = evenDimension(composition?.width ?? 1920, 1920);
  const height = evenDimension(composition?.height ?? 1080, 1080);
  const fps = Math.max(1, Math.min(60, Math.round(finitePositive(composition?.frameRate ?? 30, 30))));
  const timeline = readSeedanceTimelineStore();
  const filename = createOutputFilename();
  const exporter = new FrameExporter({
    width,
    height,
    fps,
    codec: 'h264',
    container: 'mp4',
    bitrate: FrameExporter.getRecommendedBitrate(width, height, fps),
    rateControl: 'vbr',
    startTime: range.startTime,
    endTime: range.endTime,
    includeAudio: true,
    audioSampleRate: 48000,
    audioBitrate: 256_000,
    normalizeAudio: false,
    exportMode: 'fast',
  });

  timeline.startExport(range.startTime, range.endTime);
  const cancelExport = () => exporter.cancel();
  signal?.addEventListener('abort', cancelExport, { once: true });

  try {
    signal?.throwIfAborted();
    const blob = await exporter.export((progress) => {
      readSeedanceTimelineStore().setExportProgress(progress.percent, progress.currentTime);
      onStatus?.({
        label: 'Rendering video…',
        progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    });
    signal?.throwIfAborted();
    if (!blob) throw new Error('The finished video could not be rendered.');

    onStatus?.({ label: 'Finishing video…' });
    const file = new File([blob], filename, {
      lastModified: Date.now(),
      type: blob.type || 'video/mp4',
    });
    const imported = await readSeedanceMediaStore().importFile(file, null);
    return imported.type === 'video' ? imported.id : undefined;
  } finally {
    signal?.removeEventListener('abort', cancelExport);
    readSeedanceTimelineStore().endExport();
    prepareTimelineForEditorHandoff(range.startTime);
  }
}

export async function runLandingBackgroundCreation(
  prompt: string,
  onStatus?: LandingBackgroundStatusReporter,
  options: LandingBackgroundCreationOptions = {},
): Promise<LandingBackgroundCreationResult> {
  const visiblePrompt = prompt.trim();
  if (!visiblePrompt) throw new Error('Please enter a prompt.');
  options.signal?.throwIfAborted();
  const reportStatus = createLandingStatusReporter(onStatus);
  await ensureSeedanceEditWorkspace(options, reportStatus);
  if (options.reviewCompositionId) {
    await ensureReviewComposition(options.reviewCompositionId, reportStatus);
  }

  let response = '';
  if (options.resumeFrom !== 'rendering') {
    if (options.resumeFrom !== 'editing') {
      options.onPhaseChange?.('preparing');
      reportStatus({ label: 'Preparing project…' });
      await prepareSingleVideoForAI(reportStatus, options.signal, options.sourceFileIds);
    }

    options.signal?.throwIfAborted();
    options.onPhaseChange?.('editing');
    reportStatus({ label: 'Starting AI…' });
    const completedRun = options.idempotencyKey
      ? await findFlashBoardChatRunByIdempotencyKey(options.idempotencyKey)
      : null;
    if (completedRun?.status === 'succeeded') {
      response = completedRun.response ?? '';
    } else {
      if (!completedRun) {
        appendFlashBoardPromptHistoryEntry({ kind: 'chat', prompt: visiblePrompt });
      }
      const { runFlashBoardBridgeChatTurn } = await import(
        '../services/flashboard/FlashBoardChatBridgeRunner'
      );
      const historyMessages = options.historyMessageIds === undefined
        ? undefined
        : (() => {
            const messagesById = new Map(
              useFlashBoardStore.getState().chatMessages.map(message => [message.id, message]),
            );
            return options.historyMessageIds
              ?.map(id => messagesById.get(id))
              .filter(message => message !== undefined);
          })();
      let hasDetailedAgentProgress = false;
      const chatResult = await runFlashBoardBridgeChatTurn({
        ...(historyMessages === undefined ? {} : { historyMessages }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        persistToChat: true,
        ...(options.preproductionRunId === undefined
          ? {}
          : { preproductionRunId: options.preproductionRunId }),
        prompt: visiblePrompt,
        runSource: 'ui',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        toolExecutionMode: 'normal',
        onPhase: (phase) => {
          if (hasDetailedAgentProgress) return;
          reportStatus({
            label: phase === 'kernel' ? 'Reading project…' : 'Planning the edit…',
          });
        },
        onKernelProgress: (progress) => {
          hasDetailedAgentProgress = true;
          reportStatus({
            label: `${progress.label}…`,
            stage: progress.stage,
            ...(progress.detail === undefined ? {} : { detail: progress.detail }),
            ...(progress.current && progress.total
              ? { progress: Math.round((progress.current / progress.total) * 100) }
              : {}),
          });
        },
        onExecutedToolCalls: (toolCalls) => {
          if (toolCalls.length > 0 && !hasDetailedAgentProgress) {
            reportStatus({ label: 'Applying the edit…', stage: 'executing' });
          }
        },
      });
      response = chatResult.response;
    }
  }

  options.signal?.throwIfAborted();
  if (options.pauseBeforeRender && options.resumeFrom !== 'rendering') {
    const reviewCompositionId = readSeedanceMediaStore().activeCompositionId;
    if (!reviewCompositionId) {
      throw new Error('The chat edit did not produce a composition to review.');
    }
    options.onReviewCompositionChange?.(reviewCompositionId);
    const range = resolveRenderRange();
    if (range) prepareTimelineForEditorHandoff(range.startTime);
    reportStatus({ label: 'Edit ready for review' });
    return {
      readyForReview: true,
      reviewCompositionId,
      response,
    };
  }

  options.onPhaseChange?.('rendering');
  const renderedFileId = await renderCurrentTimeline(reportStatus, options.signal);
  reportStatus({ label: renderedFileId ? 'Video ready' : 'Done' });

  return {
    renderedFileId,
    response,
  };
}
