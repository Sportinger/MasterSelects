import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptStatus,
  TranscriptWord,
} from '../../types/clipMetadata';
import { updateClipTranscript, type ClipTranscriptUpdate } from './artifactPersistence';
import { terminateTranscriptionWorker } from './workerClient';
import {
  findTimelineAnalysisClip,
  updateTimelineAnalysisMediaFiles,
} from '../timeline/timelineRuntimeCoordinator';

interface ActiveTranscriptionRun {
  clipId: string;
  clipSnapshot: {
    message?: string;
    progress: number;
    status: TranscriptStatus;
    words?: TranscriptWord[];
  };
  controller: AbortController;
  mediaFileId?: string;
  mediaSnapshot?: {
    artifact?: TranscriptFusionArtifact;
    progress?: TranscriptFusionProgress;
    status?: TranscriptStatus;
    words?: TranscriptWord[];
  };
}

type TranscriptionRunInput = Omit<ActiveTranscriptionRun, 'controller'>;

let activeRun: ActiveTranscriptionRun | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.activeTranscriptionRun) {
    activeRun = import.meta.hot.data.activeTranscriptionRun as ActiveTranscriptionRun;
  }
  import.meta.hot.dispose((data) => {
    data.activeTranscriptionRun = activeRun;
  });
}

function restoreRun(run: ActiveTranscriptionRun): void {
  updateClipTranscript(run.clipId, {
    message: run.clipSnapshot.message,
    progress: run.clipSnapshot.progress,
    status: run.clipSnapshot.status,
    words: run.clipSnapshot.words,
  });
  if (!run.mediaFileId || !run.mediaSnapshot) return;
  updateTimelineAnalysisMediaFiles(files =>
    files.map(file => file.id === run.mediaFileId
      ? {
          ...file,
          transcript: run.mediaSnapshot?.words,
          transcriptArtifact: run.mediaSnapshot?.artifact,
          transcriptFusionProgress: run.mediaSnapshot?.progress,
          transcriptStatus: run.mediaSnapshot?.status,
        }
      : file)
  );
}

function recoverOrphanedRun(clipId: string): void {
  const clip = findTimelineAnalysisClip(clipId);
  const words = clip?.transcript;
  const status: TranscriptStatus = words?.length ? 'ready' : 'none';
  updateClipTranscript(clipId, {
    status,
    progress: status === 'ready' ? 100 : 0,
    message: undefined,
  });
  const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
  if (!mediaFileId) return;
  updateTimelineAnalysisMediaFiles(files =>
    files.map(file => file.id === mediaFileId
      ? {
          ...file,
          transcriptStatus: status,
          transcriptFusionProgress: file.transcriptArtifact
            ? {
                stage: 'complete',
                range: [
                  file.transcriptArtifact.words[0]?.start ?? 0,
                  file.transcriptArtifact.words.at(-1)?.end ?? 0,
                ],
                providers: { deepgram: 'complete', openai: 'complete' },
                conflictCount: file.transcriptArtifact.conflicts.filter(
                  conflict => conflict.status === 'needs-review',
                ).length,
                resolvedCount: file.transcriptArtifact.conflicts.filter(
                  conflict => conflict.status !== 'needs-review',
                ).length,
                updatedAt: Date.now(),
              }
            : undefined,
        }
      : file)
  );
}

export function hasActiveTranscriptionRun(): boolean {
  return activeRun !== null;
}

export function beginTranscriptionRun(input: TranscriptionRunInput): ActiveTranscriptionRun {
  const run = { ...input, controller: new AbortController() };
  activeRun = run;
  return run;
}

export function isActiveTranscriptionRun(run: ActiveTranscriptionRun): boolean {
  return activeRun === run && !run.controller.signal.aborted;
}

export function publishTranscriptionRunUpdate(
  run: ActiveTranscriptionRun,
  data: ClipTranscriptUpdate,
): void {
  if (isActiveTranscriptionRun(run)) {
    updateClipTranscript(run.clipId, data);
  }
}

/**
 * Move the cancellation/reload restore point forward after a durable chunk
 * checkpoint. Cancelling a later chunk then keeps all previously saved words.
 */
export function commitTranscriptionRunCheckpoint(
  run: ActiveTranscriptionRun,
  checkpoint: {
    artifact?: TranscriptFusionArtifact;
    clipWords: TranscriptWord[];
    mediaWords?: TranscriptWord[];
  },
): void {
  if (!isActiveTranscriptionRun(run)) return;

  run.clipSnapshot = {
    message: undefined,
    progress: 100,
    status: checkpoint.clipWords.length > 0 ? 'ready' : 'none',
    words: checkpoint.clipWords,
  };
  if (run.mediaFileId) {
    run.mediaSnapshot = {
      artifact: checkpoint.artifact,
      progress: undefined,
      status: checkpoint.mediaWords?.length ? 'ready' : 'none',
      words: checkpoint.mediaWords,
    };
  }
}

export function restoreActiveTranscriptionRun(run: ActiveTranscriptionRun): void {
  if (activeRun === run) restoreRun(run);
}

export function finishTranscriptionRun(run: ActiveTranscriptionRun): void {
  if (activeRun === run) activeRun = null;
}

export function isTranscriptionAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

export function cancelTranscriptionRun(clipId?: string): void {
  const run = activeRun;
  if (run && (!clipId || run.clipId === clipId)) {
    run.controller.abort();
    terminateTranscriptionWorker();
    restoreRun(run);
    activeRun = null;
    return;
  }

  terminateTranscriptionWorker();
  if (clipId) recoverOrphanedRun(clipId);
}
