import type {
  AgentTimelineAnalysisEstimate,
  AgentTimelineAnalysisEstimateRequest,
  AgentTimelineChannelEstimate,
} from '../../../types/agentTimeline/analysisEstimate';
import type {
  AgentTimelineChannel,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import {
  findCoverageHoles,
  mergeSourceTimeRanges,
} from '../artifacts/artifactShardIndex';
import { validateAgentTimelineProfileSettings } from './analysisProfiles';

function assertRanges(ranges: readonly AgentTimelineRange[]): AgentTimelineRange[] {
  if (ranges.length === 0) throw new RangeError('Analysis estimate scope needs at least one range');
  return mergeSourceTimeRanges(ranges);
}

function rangeDuration(ranges: readonly AgentTimelineRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}

function uncachedRanges(
  scope: readonly AgentTimelineRange[],
  coverage: readonly AgentTimelineRange[],
): AgentTimelineRange[] {
  const mergedCoverage = mergeSourceTimeRanges(coverage);
  return scope.flatMap((range) => findCoverageHoles(range, mergedCoverage));
}

function workEstimate(
  channel: AgentTimelineChannel,
  uncachedDuration: number,
  request: AgentTimelineAnalysisEstimateRequest,
): Pick<AgentTimelineChannelEstimate, 'estimatedWorkItems' | 'workItemKind'> {
  const settings = request.profile;
  if (channel === 'cuts' && request.sourceFrameRate !== undefined) {
    return {
      estimatedWorkItems: Math.ceil(uncachedDuration * request.sourceFrameRate),
      workItemKind: 'frames',
    };
  }
  if (channel === 'quality') {
    return {
      estimatedWorkItems: Math.ceil(uncachedDuration * settings.metricSamplesPerSecond),
      workItemKind: 'samples',
    };
  }
  if (channel === 'camera-motion') {
    return {
      estimatedWorkItems: Math.ceil(uncachedDuration * settings.cameraSamplesPerSecond),
      workItemKind: 'samples',
    };
  }
  if (channel === 'people') {
    return {
      estimatedWorkItems: Math.ceil(uncachedDuration * settings.faceSamplesPerSecond),
      workItemKind: 'samples',
    };
  }
  if (channel === 'audio') {
    return {
      estimatedWorkItems: Math.ceil(uncachedDuration / settings.audioHopSeconds),
      workItemKind: 'windows',
    };
  }
  if (channel === 'text') {
    const shots = request.uncachedShotCount ?? request.shotCount;
    return shots === undefined ? {} : {
      estimatedWorkItems: Math.ceil(shots * settings.ocrKeyframesPerShot),
      workItemKind: 'keyframes',
    };
  }
  if (channel === 'active-speaker' && settings.activeSpeakerCandidateSamplesPerSecond > 0) {
    return {
      estimatedWorkItems: Math.ceil(
        Math.max(0, request.ambiguousSpeechSeconds ?? 0)
        * settings.activeSpeakerCandidateSamplesPerSecond,
      ),
      workItemKind: 'candidate-samples',
    };
  }
  return {};
}

function costClass(
  profile: AgentTimelineAnalysisEstimateRequest['profile']['profile'],
): AgentTimelineAnalysisEstimate['relativeCost'] {
  if (profile === 'quick') return 'low';
  if (profile === 'balanced') return 'moderate';
  if (profile === 'deep') return 'high';
  return 'custom';
}

function validateOptionalPositive(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
}

function validateOptionalCount(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

export function estimateAgentTimelineAnalysis(
  request: AgentTimelineAnalysisEstimateRequest,
): AgentTimelineAnalysisEstimate {
  validateAgentTimelineProfileSettings(request.profile);
  validateOptionalPositive(request.sourceFrameRate, 'sourceFrameRate');
  validateOptionalCount(request.shotCount, 'shotCount');
  validateOptionalCount(request.uncachedShotCount, 'uncachedShotCount');
  if (request.ambiguousSpeechSeconds !== undefined
    && (!Number.isFinite(request.ambiguousSpeechSeconds)
      || request.ambiguousSpeechSeconds < 0)) {
    throw new RangeError('ambiguousSpeechSeconds must be finite and non-negative');
  }
  const scopeRanges = assertRanges(request.scope.sourceRanges);
  const totalDurationSeconds = rangeDuration(scopeRanges);
  const channels = [...new Set(request.channels)].toSorted();
  if (channels.length === 0) throw new TypeError('Analysis estimate needs at least one channel');
  const coverageByChannel = new Map(
    request.cachedCoverage.map((item) => [item.channel, item.ranges] as const),
  );
  const channelPlans = channels.map((channel) => {
    const missing = uncachedRanges(scopeRanges, coverageByChannel.get(channel) ?? []);
    const uncachedDurationSeconds = rangeDuration(missing);
    return {
      missing,
      estimate: {
        channel,
        totalDurationSeconds,
        uncachedDurationSeconds,
        reusableDurationSeconds: totalDurationSeconds - uncachedDurationSeconds,
        ...workEstimate(channel, uncachedDurationSeconds, request),
      } satisfies AgentTimelineChannelEstimate,
    };
  });
  const channelEstimates = channelPlans.map((plan) => plan.estimate);
  const uncachedDurationSeconds = rangeDuration(
    mergeSourceTimeRanges(channelPlans.flatMap((plan) => plan.missing)),
  );
  const downloads = [...(request.downloads ?? [])].map((download) => ({ ...download }));
  for (const download of downloads) {
    if (!Number.isSafeInteger(download.bytes) || download.bytes < 0) {
      throw new RangeError(`Download ${download.id} has invalid byte size`);
    }
  }
  const notes: string[] = [
    'Estimate is read-only and does not start analysis.',
    request.benchmark
      ? 'Wall-time range uses a measured rate supplied for this device class.'
      : 'Wall time is unavailable until a matching real-device benchmark exists.',
  ];
  if (request.profile.profile === 'deep') {
    notes.push('Deep face and camera density remains candidate-gated; no continuous high-density scan is implied.');
  }
  const benchmark = request.benchmark;
  if (benchmark && benchmark.profile !== request.profile.profile) {
    throw new TypeError('Benchmark profile does not match the requested analysis profile');
  }
  if (benchmark && (
    !Number.isFinite(benchmark.minimumSecondsPerMediaSecond)
    || !Number.isFinite(benchmark.maximumSecondsPerMediaSecond)
    || benchmark.minimumSecondsPerMediaSecond < 0
    || benchmark.maximumSecondsPerMediaSecond < benchmark.minimumSecondsPerMediaSecond
  )) {
    throw new RangeError('Benchmark rates must be finite, non-negative, and ordered');
  }
  return {
    scope: request.scope.kind,
    profile: request.profile.profile,
    channels: channelEstimates,
    totalDurationSeconds,
    uncachedDurationSeconds,
    relativeCost: costClass(request.profile.profile),
    estimatedWallTimeSeconds: benchmark ? {
      minimum: uncachedDurationSeconds * benchmark.minimumSecondsPerMediaSecond,
      maximum: uncachedDurationSeconds * benchmark.maximumSecondsPerMediaSecond,
      platform: benchmark.platform,
      deviceClass: benchmark.deviceClass,
    } : undefined,
    downloads: {
      requiredBytes: downloads
        .filter((download) => !download.cached)
        .reduce((sum, download) => sum + download.bytes, 0),
      reusableBytes: downloads
        .filter((download) => download.cached)
        .reduce((sum, download) => sum + download.bytes, 0),
      items: downloads,
    },
    notes,
  };
}
