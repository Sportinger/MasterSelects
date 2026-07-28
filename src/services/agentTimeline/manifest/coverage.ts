import type {
  AgentTimelineArtifactRef,
  AgentTimelineChannel,
  AgentTimelineChannelManifest,
  AgentTimelineCoverageSummary,
  AgentTimelineProfile,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from '../../../types/agentTimeline/manifest';
import { isValidHalfOpenRange } from './eventSemantics';

const PROFILE_RANK: Record<Exclude<AgentTimelineProfile, 'custom'>, number> = {
  quick: 0,
  balanced: 1,
  deep: 2,
};

export interface ArtifactCompatibilityRequest {
  profile: AgentTimelineProfile;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  schemaVersion?: string;
  analyzerId?: string;
  analyzerVersion?: string;
}

export function isProfileCompatible(artifact: AgentTimelineProfile, requested: AgentTimelineProfile): boolean {
  if (artifact === 'custom' || requested === 'custom') return artifact === requested;
  return PROFILE_RANK[artifact] >= PROFILE_RANK[requested];
}

export function isArtifactCompatible(artifact: AgentTimelineArtifactRef, request: ArtifactCompatibilityRequest): boolean {
  if (!isProfileCompatible(artifact.profile, request.profile)) return false;
  if (artifact.timeDomain !== request.timeDomain) return false;
  if (request.schemaVersion && artifact.schemaVersion !== request.schemaVersion) return false;
  if (request.analyzerId && artifact.analyzerId !== request.analyzerId) return false;
  if (request.analyzerVersion && artifact.analyzerVersion !== request.analyzerVersion) return false;
  if (artifact.timeDomain !== 'source') return Boolean(request.stateHash && artifact.stateHash === request.stateHash);
  return artifact.stateHash === undefined;
}

export function mergeHalfOpenRanges(ranges: AgentTimelineRange[]): AgentTimelineRange[] {
  const sorted = ranges
    .filter(isValidHalfOpenRange)
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push(range);
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

export function intersectCoverage(ranges: AgentTimelineRange[], query: AgentTimelineRange): AgentTimelineRange[] {
  if (!isValidHalfOpenRange(query)) return [];
  return mergeHalfOpenRanges(ranges
    .map((range) => ({ start: Math.max(range.start, query.start), end: Math.min(range.end, query.end) }))
    .filter(isValidHalfOpenRange));
}

export function findMissingCoverage(covered: AgentTimelineRange[], query: AgentTimelineRange): AgentTimelineRange[] {
  if (!isValidHalfOpenRange(query)) return [];
  const missing: AgentTimelineRange[] = [];
  let cursor = query.start;
  for (const range of intersectCoverage(covered, query)) {
    if (cursor < range.start) missing.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < query.end) missing.push({ start: cursor, end: query.end });
  return missing;
}

export function summarizeChannelCoverage(
  channel: AgentTimelineChannel,
  channelManifest: AgentTimelineChannelManifest,
  query: AgentTimelineRange,
  compatibility: ArtifactCompatibilityRequest,
): AgentTimelineCoverageSummary {
  const compatible = channelManifest.artifacts.filter((artifact) => isArtifactCompatible(artifact, compatibility));
  const stale = channelManifest.artifacts.filter((artifact) => !compatible.includes(artifact));
  const covered = intersectCoverage(compatible.flatMap((artifact) => artifact.coverage), query);
  const missing = findMissingCoverage(covered, query);
  let status: AgentTimelineCoverageSummary['status'];
  if (channelManifest.status === 'failed' && compatible.length === 0) status = 'failed';
  else if (missing.length === 0) status = 'complete';
  else if (covered.length > 0) status = 'partial';
  else if (stale.length > 0) status = 'stale';
  else status = 'missing';
  return {
    channel,
    status,
    covered,
    missing,
    artifactRefs: compatible.map((artifact) => artifact.artifactRef).sort(),
    staleArtifactRefs: stale.map((artifact) => artifact.artifactRef).sort(),
    error: status === 'failed' ? channelManifest.error : undefined,
  };
}
