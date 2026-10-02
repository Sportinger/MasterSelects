// Multicam tool handlers: audio sync of timeline clips (a background job, see
// audioSyncJobs) and turning the active composition into a multicam edit.

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TimelineClip } from '../../../types';
import type { ToolResult } from '../types';
import type { AudioSyncConfidence } from '../../audioSync';
import {
  getAudioSyncJob,
  startAudioSyncJob,
  waitForAudioSyncJob,
  type AudioSyncJob,
} from '../../multicam/audioSyncJobs';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const DEFAULT_START_WAIT_MS = 15_000;
const DEFAULT_STATUS_WAIT_MS = 60_000;
const MAX_WAIT_MS = 240_000;
const CONFIDENCES: readonly AudioSyncConfidence[] = ['low', 'medium', 'high'];

function waitMsArg(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(MAX_WAIT_MS, Math.max(0, Math.round(parsed)));
}

function clipName(clipId: string): string | undefined {
  return useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.name;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Compact job view for the model: progress with ETA while running, the applied result when done. */
function describeJob(job: AudioSyncJob): Record<string, unknown> {
  const elapsedSeconds = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  const base: Record<string, unknown> = { jobId: job.jobId, status: job.status, elapsedSeconds };
  if (job.status === 'running') {
    const progress = job.progress;
    const percent = progress?.percent ?? 0;
    return {
      ...base,
      percent,
      ...(progress ? {
        phase: progress.phase,
        clip: `${progress.clipIndex}/${progress.clipCount} ${progress.clipName}`,
        clipPercent: Math.round(progress.clipFraction * 100),
      } : {}),
      ...(percent >= 5 ? { etaSeconds: Math.round((elapsedSeconds * (100 - percent)) / percent) } : {}),
      instruction: 'Sync is still running. Call getAudioSyncStatus with this jobId to wait for the result; do not start it again.',
    };
  }
  if (job.status === 'failed') return { ...base, error: job.error };

  const report = job.report!;
  const clips = useTimelineStore.getState().clips;
  const aligned = report.alignments.map((alignment) => {
    const clip = clips.find((candidate) => candidate.id === alignment.audioClipId);
    return {
      clipId: alignment.audioClipId,
      name: clip?.name ?? clipName(alignment.audioClipId),
      startTime: clip ? round(clip.startTime) : round(alignment.targetStartTime),
      confidence: alignment.confidence,
      isMaster: alignment.audioClipId === report.masterAudioClipId,
    };
  });
  return {
    ...base,
    masterClipId: report.masterAudioClipId,
    alignedCount: aligned.length,
    failedCount: report.failures.length,
    aligned,
    failures: report.failures.map((failure) => ({ ...failure, name: clipName(failure.clipId) })),
    note: 'Aligned audio clips moved together with their linked video and now share one linked group. Clips in failures were not moved.',
  };
}

function audibleDuration(clip: TimelineClip): number {
  return clip.source?.type === 'audio' || clip.source?.type === 'video' ? clip.duration : 0;
}

export async function handleSyncClipsViaAudio(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipIds = Array.isArray(args.clipIds)
    ? [...new Set(args.clipIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (clipIds.length < 2) return { success: false, error: 'clipIds must list at least two timeline clips.' };
  const clips = clipIds.map((id) => timelineStore.clips.find((clip) => clip.id === id));
  const missing = clipIds.filter((_, index) => !clips[index]);
  if (missing.length) return { success: false, error: `Timeline clips not found: ${missing.join(', ')}` };
  const lockedTrackIds = new Set(timelineStore.tracks.filter((track) => track.locked).map((track) => track.id));
  const locked = clips.filter((clip) => clip && lockedTrackIds.has(clip.trackId)).map((clip) => clip!.id);
  if (locked.length) return { success: false, error: `Clips on locked tracks cannot be synced: ${locked.join(', ')}` };

  const masterArg = typeof args.masterClipId === 'string' ? args.masterClipId : undefined;
  if (masterArg && !clipIds.includes(masterArg)) {
    return { success: false, error: 'masterClipId must be one of clipIds.' };
  }
  // The longest recording overlaps the most material; it is the safest default reference.
  const masterClipId = masterArg ?? clips.toSorted((a, b) => audibleDuration(b!) - audibleDuration(a!))[0]!.id;
  const minConfidence = CONFIDENCES.includes(args.minConfidence as AudioSyncConfidence)
    ? args.minConfidence as AudioSyncConfidence
    : 'medium';

  const job = startAudioSyncJob({ clipIds, masterClipId, minConfidence });
  const settled = await waitForAudioSyncJob(job.jobId, waitMsArg(args.waitMs, DEFAULT_START_WAIT_MS));
  const view = describeJob(settled ?? job);
  return settled?.status === 'failed'
    ? { success: false, error: settled.error, data: view }
    : { success: true, data: view };
}

export async function handleGetAudioSyncStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!getAudioSyncJob(jobId)) {
    return { success: false, error: `Audio sync job not found: ${jobId}. Jobs do not survive a page reload.` };
  }
  const job = await waitForAudioSyncJob(jobId, waitMsArg(args.waitMs, DEFAULT_STATUS_WAIT_MS));
  return { success: true, data: describeJob(job!) };
}

export async function handleSetMulticamMode(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  if (typeof args.enabled !== 'boolean') return { success: false, error: 'enabled must be true or false.' };
  const mediaState = useMediaStore.getState();
  const compositionId = mediaState.activeCompositionId;
  if (!compositionId) return { success: false, error: 'No active composition.' };
  const wasBuilt = Boolean(mediaState.compositions.find((composition) => composition.id === compositionId)?.multicam);

  if (!timelineStore.setMulticamActive(args.enabled)) {
    return {
      success: false,
      error: args.enabled
        ? 'Multicam needs at least two unlocked video tracks that hold plain video clips (one track per camera, normal speed, not reversed).'
        : 'This composition has no multicam edit to turn off.',
    };
  }
  const multicam = useMediaStore.getState().compositions.find((composition) => composition.id === compositionId)?.multicam;
  return {
    success: true,
    data: {
      compositionId,
      active: multicam?.active ?? false,
      built: !wasBuilt && args.enabled,
      angles: multicam?.angles.map((angle, index) => ({
        key: index + 1,
        label: angle.label,
        trackId: angle.trackId,
        sourceClips: angle.sources.length,
      })) ?? [],
      note: args.enabled
        ? 'Keys 1..n switch cameras; the program initially shows the topmost camera that has material at each moment. Audio clips stay unchanged and linked.'
        : 'Cut mode is off; the program clips stay on the timeline.',
    },
  };
}
