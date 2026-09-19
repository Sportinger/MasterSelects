import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { useMediaStore } from '../../stores/mediaStore';
import { Logger } from '../logger';

const log = Logger.create('ThumbnailRenderer');

export function getSegmentSampleTimes(boundaries: number[], duration: number, targetCount: number): number[] {
  const allBoundaries = [0, ...boundaries.filter(b => b > 0 && b < 1), 1].sort((a, b) => a - b);

  const uniqueBoundaries: number[] = [allBoundaries[0]];
  for (let i = 1; i < allBoundaries.length; i++) {
    if (allBoundaries[i] - uniqueBoundaries[uniqueBoundaries.length - 1] > 0.01) {
      uniqueBoundaries.push(allBoundaries[i]);
    }
  }

  log.debug(`Segment boundaries (${uniqueBoundaries.length}):`, uniqueBoundaries.map(b => (b * 100).toFixed(1) + '%'));

  const segmentCount = uniqueBoundaries.length - 1;
  if (segmentCount <= 0) {
    return getEvenSampleTimes(duration, targetCount);
  }

  const samplesPerSegment = Math.max(1, Math.ceil(targetCount / segmentCount));
  const times: number[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const segStart = uniqueBoundaries[i];
    const segEnd = uniqueBoundaries[i + 1];
    const segDuration = segEnd - segStart;

    for (let j = 0; j < samplesPerSegment; j++) {
      const t = samplesPerSegment > 1
        ? (j + 0.5) / samplesPerSegment
        : 0.5;

      const normalizedTime = segStart + t * segDuration;
      times.push(normalizedTime * duration);
    }
  }

  if (times.length > targetCount) {
    const step = times.length / targetCount;
    const sampled: number[] = [];
    for (let i = 0; i < targetCount; i++) {
      sampled.push(times[Math.floor(i * step)]);
    }
    log.info(`Segment-based sample times (${sampled.length}):`, sampled.map(t => t.toFixed(2) + 's'));
    return sampled;
  }

  log.info(`Segment-based sample times (${times.length}):`, times.map(t => t.toFixed(2) + 's'));
  return times;
}

export function getContentAwareSampleTimes(compositionId: string, duration: number, count: number): number[] {
  const composition = useMediaStore.getState().compositions.find(
    (c: { id: string }) => c.id === compositionId
  );

  if (!composition?.timelineData?.clips || composition.timelineData.clips.length === 0) {
    log.debug(`No clips found for ${compositionId}, using even distribution`);
    return getEvenSampleTimes(duration, count);
  }

  const clips = composition.timelineData.clips;
  const tracks = composition.timelineData.tracks || [];

  log.debug(`Analyzing ${clips.length} clips, ${tracks.length} tracks for ${compositionId}`);

  const videoTrackIds = new Set(
    tracks
      .filter((t: { type: string; visible?: boolean }) => t.type === 'video' && t.visible !== false)
      .map((t: { id: string }) => t.id)
  );

  const videoClips = clips.filter((c: { trackId: string; sourceType?: string }) => {
    const isOnVideoTrack = videoTrackIds.has(c.trackId);
    const isVisualType =
      !c.sourceType ||
      c.sourceType === 'video' ||
      c.sourceType === 'image' ||
      c.sourceType === 'text' ||
      c.sourceType === 'solid' ||
      c.sourceType === 'math-scene' ||
      c.sourceType === 'flock' ||
      isVectorAnimationSourceType(c.sourceType);
    return isOnVideoTrack && isVisualType;
  });

  log.debug(`Found ${videoClips.length} visual clips on video tracks`);

  if (videoClips.length === 0) {
    return getEvenSampleTimes(duration, count);
  }

  const timePoints = new Set<number>();
  timePoints.add(0);

  for (const clip of videoClips) {
    const clipStart = clip.startTime ?? 0;
    const clipDuration = clip.duration ?? 0;
    const clipEnd = clipStart + clipDuration;

    log.debug(`Clip boundary: ${clipStart.toFixed(2)}s - ${clipEnd.toFixed(2)}s`);

    if (clipStart >= 0 && clipStart < duration) {
      timePoints.add(clipStart);
      const insideStart = Math.min(clipStart + 0.05, clipEnd - 0.05);
      if (insideStart > clipStart) {
        timePoints.add(insideStart);
      }
    }

    if (clipEnd > 0 && clipEnd <= duration) {
      const insideEnd = Math.max(clipEnd - 0.05, clipStart + 0.05);
      if (insideEnd < clipEnd) {
        timePoints.add(insideEnd);
      }
      timePoints.add(clipEnd);
    }
  }

  timePoints.add(Math.max(0, duration - 0.01));

  let sortedTimes = Array.from(timePoints).sort((a, b) => a - b);
  log.debug(`Initial time points (${sortedTimes.length}):`, sortedTimes.map(t => t.toFixed(2)));

  while (sortedTimes.length < count) {
    let maxGap = 0;
    let maxGapIndex = 0;

    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const gap = sortedTimes[i + 1] - sortedTimes[i];
      if (gap > maxGap) {
        maxGap = gap;
        maxGapIndex = i;
      }
    }

    if (maxGap < 0.1) break;

    const midpoint = (sortedTimes[maxGapIndex] + sortedTimes[maxGapIndex + 1]) / 2;
    sortedTimes.splice(maxGapIndex + 1, 0, midpoint);
  }

  if (sortedTimes.length > count) {
    const sampled: number[] = [sortedTimes[0]];
    for (let i = 1; i < count - 1; i++) {
      const idx = Math.round((i / (count - 1)) * (sortedTimes.length - 1));
      sampled.push(sortedTimes[idx]);
    }
    sampled.push(sortedTimes[sortedTimes.length - 1]);
    sortedTimes = sampled;
  }

  log.info(`Content-aware sample times for ${compositionId} (${sortedTimes.length} points):`,
    sortedTimes.map(t => t.toFixed(2)).join(', '));
  return sortedTimes;
}

export function getEvenSampleTimes(duration: number, count: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    times.push(count > 1 ? (i / (count - 1)) * duration : 0);
  }
  return times;
}
