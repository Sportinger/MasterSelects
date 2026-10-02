// Background audio-sync jobs for the AI tools. Reading hour-long stems and
// extracting camera audio proxies takes minutes, longer than one tool call
// should block; a job runs the timeline store's undoable sync and keeps its
// progress and report for status calls. Jobs live only for this page session.

import { useTimelineStore } from '../../stores/timeline';
import type { AudioSyncConfidence, TimelineAudioSyncProgress, TimelineAudioSyncReport } from '../audioSync';

export type AudioSyncJobStatus = 'running' | 'completed' | 'failed';

export interface AudioSyncJob {
  jobId: string;
  status: AudioSyncJobStatus;
  clipIds: string[];
  masterClipId?: string;
  startedAt: number;
  finishedAt?: number;
  progress: TimelineAudioSyncProgress | null;
  report?: TimelineAudioSyncReport;
  error?: string;
}

const MAX_KEPT_JOBS = 20;

interface AudioSyncJobRegistry {
  jobs: Map<string, AudioSyncJob>;
  waiters: Map<string, Set<() => void>>;
  nextJobNumber: number;
}

// A running job outlives a hot update of this module: the registry is parked in HMR data.
const hotData = import.meta.hot?.data as { audioSyncJobs?: AudioSyncJobRegistry } | undefined;
const registry: AudioSyncJobRegistry = hotData?.audioSyncJobs ?? { jobs: new Map(), waiters: new Map(), nextJobNumber: 1 };
if (hotData) hotData.audioSyncJobs = registry;
const { jobs, waiters } = registry;

function settle(job: AudioSyncJob, update: Partial<AudioSyncJob>): void {
  Object.assign(job, update, { finishedAt: Date.now() });
  waiters.get(job.jobId)?.forEach((wake) => wake());
  waiters.delete(job.jobId);
}

function pruneFinishedJobs(): void {
  const finished = [...jobs.values()].filter((job) => job.status !== 'running');
  for (const job of finished.slice(0, Math.max(0, jobs.size - MAX_KEPT_JOBS))) jobs.delete(job.jobId);
}

/** The running job over the same clip set, so a repeated request joins it. */
function findRunningJob(clipIds: readonly string[]): AudioSyncJob | undefined {
  const key = [...clipIds].toSorted().join('|');
  return [...jobs.values()].find((job) => job.status === 'running' && job.clipIds.toSorted().join('|') === key);
}

export function startAudioSyncJob(input: {
  clipIds: string[];
  masterClipId?: string;
  minConfidence?: AudioSyncConfidence;
}): AudioSyncJob {
  const running = findRunningJob(input.clipIds);
  if (running) return running;
  pruneFinishedJobs();
  const job: AudioSyncJob = {
    jobId: `audio-sync-${Date.now().toString(36)}-${registry.nextJobNumber++}`,
    status: 'running',
    clipIds: [...input.clipIds],
    ...(input.masterClipId ? { masterClipId: input.masterClipId } : {}),
    startedAt: Date.now(),
    progress: null,
  };
  jobs.set(job.jobId, job);

  let rejection: string | undefined;
  void useTimelineStore.getState().syncClipsViaAudio(job.clipIds, input.masterClipId, {
    minConfidence: input.minConfidence,
    onProgress: (_percent, detail) => { if (detail) job.progress = detail; },
    onRejected: (reason) => { rejection = reason; },
  }).then((report) => {
    if (report) settle(job, { status: 'completed', report });
    else settle(job, { status: 'failed', error: rejection ?? 'Audio sync did not produce a result.' });
  }, (error: unknown) => {
    settle(job, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
  });
  return job;
}

export function getAudioSyncJob(jobId: string): AudioSyncJob | undefined {
  return jobs.get(jobId);
}

/** Resolves when the job finishes or `timeoutMs` passes, whichever is first. */
export async function waitForAudioSyncJob(jobId: string, timeoutMs: number): Promise<AudioSyncJob | undefined> {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running' || timeoutMs <= 0) return job;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const set = waiters.get(jobId) ?? new Set<() => void>();
    waiters.set(jobId, set);
    set.add(done);
    function done() {
      clearTimeout(timer);
      set.delete(done);
      resolve();
    }
  });
  return jobs.get(jobId);
}
