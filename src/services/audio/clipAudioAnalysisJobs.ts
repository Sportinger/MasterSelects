import type {
  AudioAnalysisArtifactKind,
  ClipAudioAnalysisJobKind,
  ClipAudioAnalysisJobPhase,
  ClipAudioAnalysisJobState,
} from '../../types/audio';

export interface CreateClipAudioAnalysisJobStateInput {
  kind: ClipAudioAnalysisJobKind;
  label: string;
  artifactKinds: AudioAnalysisArtifactKind[];
  processed: boolean;
  now?: string;
}

export interface UpdateClipAudioAnalysisJobStateInput {
  phase?: ClipAudioAnalysisJobPhase;
  progress?: number;
  message?: string;
  now?: string;
}

function createJobId(kind: ClipAudioAnalysisJobKind): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `audio-analysis:${kind}:${randomId}`;
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
}

export function createClipAudioAnalysisJobState(
  input: CreateClipAudioAnalysisJobStateInput,
): ClipAudioAnalysisJobState {
  const timestamp = input.now ?? new Date().toISOString();
  return {
    jobId: createJobId(input.kind),
    kind: input.kind,
    label: input.label,
    artifactKinds: [...input.artifactKinds],
    processed: input.processed,
    phase: 'queued',
    progress: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateClipAudioAnalysisJobState(
  job: ClipAudioAnalysisJobState,
  input: UpdateClipAudioAnalysisJobStateInput,
): ClipAudioAnalysisJobState {
  return {
    ...job,
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.progress !== undefined ? { progress: clampProgress(input.progress) } : {}),
    ...(input.message !== undefined ? { message: input.message } : {}),
    updatedAt: input.now ?? new Date().toISOString(),
  };
}
