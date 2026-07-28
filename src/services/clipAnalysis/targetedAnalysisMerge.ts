import type { FrameAnalysisData } from '../../types/clipMetadata';

export type ClipAnalysisTarget = 'all' | 'metrics' | 'faces';
export type AnalysisSourceRange = readonly [start: number, end: number];

function frameKey(timestamp: number): number {
  return Math.round(timestamp * 1000);
}

function preserveFaces(
  generated: FrameAnalysisData,
  current: FrameAnalysisData | undefined,
): FrameAnalysisData {
  if (!current) return generated;
  const merged = {
    ...generated,
    faceCount: current.faceCount,
  };
  if (current.faces) merged.faces = current.faces;
  else delete merged.faces;
  if (current.faceModelVersion) merged.faceModelVersion = current.faceModelVersion;
  else delete merged.faceModelVersion;
  return merged;
}

function preserveMetrics(
  generated: FrameAnalysisData,
  current: FrameAnalysisData | undefined,
): FrameAnalysisData {
  if (!current) return generated;
  return {
    ...generated,
    motion: current.motion,
    globalMotion: current.globalMotion,
    localMotion: current.localMotion,
    focus: current.focus,
    brightness: current.brightness,
    isSceneCut: current.isSceneCut,
  };
}

function isInsideRanges(
  timestamp: number,
  ranges: readonly AnalysisSourceRange[],
): boolean {
  return ranges.some(([start, end]) => timestamp >= start && timestamp < end);
}

function nearestGeneratedFrame(
  timestamp: number,
  frames: readonly FrameAnalysisData[],
): FrameAnalysisData | undefined {
  let nearest: FrameAnalysisData | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const distance = Math.abs(frame.timestamp - timestamp);
    if (distance < nearestDistance) {
      nearest = frame;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function clearFaces(frame: FrameAnalysisData): FrameAnalysisData {
  const cleared = { ...frame, faceCount: 0 };
  delete cleared.faces;
  delete cleared.faceModelVersion;
  return cleared;
}

/**
 * Replaces generated timestamps while retaining frames outside the analyzed
 * source range and the non-target channel at matching timestamps.
 */
export function mergeTargetedAnalysisFrames(
  currentFrames: readonly FrameAnalysisData[],
  generatedFrames: readonly FrameAnalysisData[],
  target: ClipAnalysisTarget,
  analyzedRanges: readonly AnalysisSourceRange[] = [],
): FrameAnalysisData[] {
  const merged = new Map<number, FrameAnalysisData>();
  for (const current of currentFrames) {
    if (!isInsideRanges(current.timestamp, analyzedRanges)) {
      merged.set(frameKey(current.timestamp), current);
      continue;
    }
    if (target === 'all') continue;
    if (target === 'faces') {
      merged.set(frameKey(current.timestamp), clearFaces(current));
      continue;
    }

    const hasFaceChannel = current.faceModelVersion !== undefined || current.faces !== undefined;
    const nearest = nearestGeneratedFrame(current.timestamp, generatedFrames);
    if (hasFaceChannel && nearest) {
      merged.set(
        frameKey(current.timestamp),
        preserveFaces({ ...nearest, timestamp: current.timestamp }, current),
      );
    }
  }

  for (const generated of generatedFrames) {
    const key = frameKey(generated.timestamp);
    const current = merged.get(key);
    const next = target === 'metrics'
      ? preserveFaces(generated, current)
      : target === 'faces'
        ? preserveMetrics(generated, current)
        : generated;
    merged.set(key, next);
  }

  return [...merged.values()].toSorted((a, b) => a.timestamp - b.timestamp);
}
