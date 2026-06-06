import type { TimelineClip } from '../../types';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
} from './runtimeResourceReporting';

const HISTORY_REHYDRATE_POLICY_ID = 'interactive' as const;
const HISTORY_REHYDRATE_OWNER_PREFIX = 'history-rehydrate';
const reportedOwnerIds = new Set<string>();

function getHistoryRehydrateOwnerId(clipId: string): string {
  return `${HISTORY_REHYDRATE_OWNER_PREFIX}:${clipId}`;
}

function hasReportableRuntimeSource(clip: TimelineClip): boolean {
  const source = clip.source;
  if (!source) return false;
  if (source.runtimeSourceId && source.runtimeSessionKey) return true;
  return Boolean(
    source.videoElement ||
      source.audioElement ||
      source.imageElement ||
      source.textCanvas
  );
}

export function releaseHistoryRehydratedTimelineRuntimeResources(): void {
  for (const ownerId of reportedOwnerIds) {
    releaseReportedClipRuntimeResources(HISTORY_REHYDRATE_POLICY_ID, ownerId);
  }
  reportedOwnerIds.clear();
}

export function syncHistoryRehydratedTimelineRuntimeResources(
  clips: readonly TimelineClip[]
): void {
  releaseHistoryRehydratedTimelineRuntimeResources();

  for (const clip of clips) {
    if (!hasReportableRuntimeSource(clip)) continue;

    const ownerId = getHistoryRehydrateOwnerId(clip.id);
    reportClipRuntimeResources({
      policyId: HISTORY_REHYDRATE_POLICY_ID,
      ownerId,
      clip,
      label: 'History rehydrated runtime',
      tags: ['history-rehydrate', clip.source?.type ?? 'unknown'],
    });
    reportedOwnerIds.add(ownerId);
  }
}
