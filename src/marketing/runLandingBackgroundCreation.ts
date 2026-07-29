import { useMediaStore } from '../stores/mediaStore';
import { appendFlashBoardPromptHistoryEntry } from '../stores/flashboardStore/activeGenerationRecords';
import { useTimelineStore } from '../stores/timeline';
import { findFlashBoardChatRunByIdempotencyKey } from '../services/flashboard/FlashBoardChatRunAudit';
import { renderHostPort } from '../services/render/renderHostPort';

export const LANDING_FINAL_OUTPUT_PREFIX = 'MasterSelects Final';

export interface LandingBackgroundCreationResult {
  renderedFileId?: string;
  response: string;
}

export interface LandingBackgroundStatus {
  detail?: string;
  label: string;
  progress?: number;
}

export type LandingBackgroundStatusReporter = (status: LandingBackgroundStatus) => void;

export type LandingBackgroundCreationPhase = 'preparing' | 'editing' | 'rendering';

export interface LandingBackgroundCreationOptions {
  idempotencyKey?: string;
  onPhaseChange?: (phase: LandingBackgroundCreationPhase) => void;
  resumeFrom?: LandingBackgroundCreationPhase;
}

function findSingleSourceVideo() {
  const sourceVideos = useMediaStore.getState().files.filter((file) => (
    file.type === 'video'
    && !file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX)
  ));
  return sourceVideos.length === 1 ? sourceVideos[0] : undefined;
}

async function ensureSingleVideoTimelineClip(
  onStatus?: LandingBackgroundStatusReporter,
): Promise<string | undefined> {
  const sourceVideo = findSingleSourceVideo();
  if (!sourceVideo) return undefined;

  const timeline = useTimelineStore.getState();
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
  return useTimelineStore.getState().addClip(
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
): Promise<void> {
  const initialClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  const sourceVideo = findSingleSourceVideo();
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
  const unsubscribe = useTimelineStore.subscribe((state) => {
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
    const { transcribeClip } = await import('../services/clipTranscriber');
    await transcribeClip(clipId, 'auto');
  } finally {
    unsubscribe();
  }

  const completedClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  if (completedClip?.transcriptStatus === 'error') {
    throw new Error(completedClip.transcriptMessage || 'Video transcription failed.');
  }
  const completedSource = findSingleSourceVideo();
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
): Promise<void> {
  const sourceVideo = findSingleSourceVideo();
  if (sourceVideo?.hasAudio === false) return;

  onStatus?.({ label: 'Analysing audio…' });
  let lastProgress = -1;
  let lastMessage = '';
  const unsubscribe = useTimelineStore.subscribe((state) => {
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
    await useTimelineStore.getState().generateAudioIntelligenceForClip(clipId);
  } finally {
    unsubscribe();
  }

  const refs = useTimelineStore.getState().clips.find(
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
): Promise<void> {
  const clipId = await ensureSingleVideoTimelineClip(onStatus);
  if (!clipId) return;

  await transcribeSingleVideo(clipId, onStatus);
  await analyseSingleVideoAudio(clipId, onStatus);
}

function evenDimension(value: number, fallback: number): number {
  const rounded = Math.max(2, Math.round(Number.isFinite(value) ? value : fallback));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveRenderRange(): { startTime: number; endTime: number } | null {
  const timeline = useTimelineStore.getState();
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
  const timeline = useTimelineStore.getState();
  timeline.pause();
  timeline.setPlayheadPosition(startTime);
  renderHostPort.clearScrubbingCache();
  renderHostPort.clearVideoCache();
  renderHostPort.clearCompositeCache();
  renderHostPort.requestNewFrameRender();
}

async function renderCurrentTimeline(
  onStatus?: LandingBackgroundStatusReporter,
): Promise<string | undefined> {
  const range = resolveRenderRange();
  if (!range) return undefined;

  onStatus?.({ label: 'Preparing the render…' });
  const { FrameExporter } = await import('../engine/export');
  const mediaState = useMediaStore.getState();
  const composition = mediaState.compositions.find(
    (candidate) => candidate.id === mediaState.activeCompositionId,
  );
  const width = evenDimension(composition?.width ?? 1920, 1920);
  const height = evenDimension(composition?.height ?? 1080, 1080);
  const fps = Math.max(1, Math.min(60, Math.round(finitePositive(composition?.frameRate ?? 30, 30))));
  const timeline = useTimelineStore.getState();
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

  try {
    const blob = await exporter.export((progress) => {
      useTimelineStore.getState().setExportProgress(progress.percent, progress.currentTime);
      onStatus?.({
        label: 'Rendering video…',
        progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
      });
    });
    if (!blob) throw new Error('The finished video could not be rendered.');

    onStatus?.({ label: 'Finishing video…' });
    const file = new File([blob], filename, {
      lastModified: Date.now(),
      type: blob.type || 'video/mp4',
    });
    const imported = await useMediaStore.getState().importFile(file, null);
    return imported.type === 'video' ? imported.id : undefined;
  } finally {
    useTimelineStore.getState().endExport();
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

  let response = '';
  if (options.resumeFrom !== 'rendering') {
    if (options.resumeFrom !== 'editing') {
      options.onPhaseChange?.('preparing');
      onStatus?.({ label: 'Thinking…' });
      await prepareSingleVideoForAI(onStatus);
    }

    options.onPhaseChange?.('editing');
    onStatus?.({ label: 'Thinking…' });
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
      const chatResult = await runFlashBoardBridgeChatTurn({
        ...(options.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        persistToChat: true,
        prompt: visiblePrompt,
        runSource: 'ui',
        toolExecutionMode: 'normal',
        onPhase: () => onStatus?.({ label: 'Thinking…' }),
        onKernelProgress: (progress) => onStatus?.({
          label: `${progress.label}…`,
          ...(progress.detail === undefined ? {} : { detail: progress.detail }),
          ...(progress.current && progress.total
            ? { progress: Math.round((progress.current / progress.total) * 100) }
            : {}),
        }),
        onExecutedToolCalls: (toolCalls) => {
          if (toolCalls.length > 0) onStatus?.({ label: 'Applying the edit…' });
        },
      });
      response = chatResult.response;
    }
  }

  options.onPhaseChange?.('rendering');
  const renderedFileId = await renderCurrentTimeline(onStatus);
  onStatus?.({ label: renderedFileId ? 'Video ready' : 'Done' });

  return {
    renderedFileId,
    response,
  };
}
