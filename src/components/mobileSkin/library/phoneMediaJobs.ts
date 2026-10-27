// The media job list of the phone ('mediaJobs' sheet): every background job the editor runs per media
// file (import, proxy, audio proxy, waveform, scene cuts, analysis, faces, scene descriptions,
// transcript), derived from the media store's own status fields. Pure: no React, no store writes.
import type { MediaFile } from '../../../stores/mediaStore/types';

export type PhoneMediaJobKind =
  | 'import' | 'proxy' | 'audioProxy' | 'waveform' | 'sceneCuts' | 'analysis' | 'faces' | 'sceneDescriptions' | 'transcript';

export type PhoneMediaJobState = 'waiting' | 'running' | 'failed' | 'done';

/** What a person can do with a job from the phone; each maps to an existing editor command. */
export type PhoneMediaJobAction = 'stop' | 'retry' | 'show';

export interface PhoneMediaJob {
  id: string;
  fileId: string;
  fileName: string;
  kind: PhoneMediaJobKind;
  label: string;
  state: PhoneMediaJobState;
  /** 0..100 while running, when the editor reports it. */
  progress: number | null;
  message: string | null;
  actions: PhoneMediaJobAction[];
}

export const PHONE_MEDIA_JOB_LABELS: Record<PhoneMediaJobKind, string> = {
  import: 'Import',
  proxy: 'Proxy',
  audioProxy: 'Audio proxy',
  waveform: 'Waveform',
  sceneCuts: 'Scene cuts',
  analysis: 'Analysis',
  faces: 'Faces',
  sceneDescriptions: 'Scene descriptions',
  transcript: 'Transcript',
};

type RawState = string | undefined;

function stateOf(raw: RawState): PhoneMediaJobState | null {
  switch (raw) {
    case 'generating': case 'analyzing': case 'transcribing': case 'describing': case 'running': return 'running';
    case 'queued': case 'pending': case 'waiting': return 'waiting';
    case 'error': case 'failed': return 'failed';
    case 'ready': case 'done': return 'done';
    default: return null;
  }
}

function percent(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  // Some jobs report 0..1, others 0..100.
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** Commands the phone has for a job kind in a state (stop/retry only where the editor has them). */
function actionsFor(kind: PhoneMediaJobKind, state: PhoneMediaJobState, file: MediaFile): PhoneMediaJobAction[] {
  const actions: PhoneMediaJobAction[] = [];
  if (kind === 'proxy') {
    if (state === 'running') actions.push('stop');
    if ((state === 'failed' || state === 'done') && file.type === 'video') actions.push('retry');
  }
  if (kind === 'waveform' && (state === 'failed' || state === 'done')) actions.push('retry');
  if (state === 'done') actions.push('show');
  return actions;
}

function job(file: MediaFile, kind: PhoneMediaJobKind, raw: RawState, progress?: number, message?: string): PhoneMediaJob | null {
  const state = stateOf(raw);
  if (!state) return null;
  return {
    id: `${file.id}:${kind}`,
    fileId: file.id,
    fileName: file.name,
    kind,
    label: PHONE_MEDIA_JOB_LABELS[kind],
    state,
    progress: state === 'running' ? percent(progress) : null,
    message: message ?? null,
    actions: actionsFor(kind, state, file),
  };
}

/** Jobs of one file, in a stable order. */
export function phoneMediaJobsOf(file: MediaFile): PhoneMediaJob[] {
  const jobs = [
    file.isImporting ? job(file, 'import', 'running', file.importProgress) : null,
    file.decodeError ? job(file, 'import', 'error', undefined, file.decodeError) : null,
    job(file, 'proxy', file.proxyStatus, file.proxyProgress),
    job(file, 'audioProxy', file.audioProxyStatus, file.audioProxyProgress),
    job(file, 'waveform', file.waveformStatus === 'skipped' ? undefined : file.waveformStatus, file.waveformProgress),
    job(file, 'sceneCuts', file.sceneCutStatus, file.sceneCutProgress),
    job(file, 'analysis', file.analysisStatus, file.analysisProgress),
    job(file, 'faces', file.faceAnalysisStatus, file.faceAnalysisProgress, file.faceAnalysisMessage),
    job(file, 'sceneDescriptions', file.sceneDescriptionStatus, file.sceneDescriptionProgress, file.sceneDescriptionMessage),
    job(file, 'transcript', file.transcriptStatus),
  ];
  return jobs.filter((entry): entry is PhoneMediaJob => entry !== null);
}

const STATE_ORDER: Record<PhoneMediaJobState, number> = { running: 0, waiting: 1, failed: 2, done: 3 };

/** Every job of the project: running first, then waiting, failed and finished; finished ones can be hidden. */
export function phoneMediaJobs(files: readonly MediaFile[], { hideDone = false } = {}): PhoneMediaJob[] {
  return files
    .flatMap(phoneMediaJobsOf)
    .filter((entry) => !(hideDone && entry.state === 'done'))
    .toSorted((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.fileName.localeCompare(b.fileName) || a.kind.localeCompare(b.kind));
}

export function countRunningPhoneMediaJobs(files: readonly MediaFile[]): number {
  return files.flatMap(phoneMediaJobsOf).filter((entry) => entry.state === 'running' || entry.state === 'waiting').length;
}
