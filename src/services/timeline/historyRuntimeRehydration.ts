import type { TimelineClip } from '../../types';
import {
  createTimelineMathSceneCanvasRuntime,
  createTimelineSolidCanvasRuntime,
  createTimelineTransitionOverlayCanvasRuntime,
  renderTimelineTextCanvasRuntime,
  type TimelineGeneratedCanvasDimensions,
} from './timelineGeneratedCanvasRuntime';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
} from './runtimeResourceReporting';

const HISTORY_REHYDRATE_POLICY_ID = 'interactive' as const;
const HISTORY_REHYDRATE_OWNER_PREFIX = 'history-rehydrate';
const reportedOwnerIds = new Set<string>();

function createGeneratedCanvasRuntime(
  clip: TimelineClip,
  dimensions?: TimelineGeneratedCanvasDimensions,
): HTMLCanvasElement | null {
  if (clip.source?.textCanvas) return clip.source.textCanvas;

  if (clip.source?.type === 'text' && clip.textProperties) {
    return renderTimelineTextCanvasRuntime({
      textProperties: clip.textProperties,
      dimensions,
    });
  }
  if (clip.source?.type === 'solid' && clip.solidColor) {
    return createTimelineSolidCanvasRuntime({ color: clip.solidColor, dimensions });
  }
  if (clip.source?.type === 'math-scene' && clip.mathScene) {
    return createTimelineMathSceneCanvasRuntime({
      mathScene: clip.mathScene,
      duration: clip.duration,
      dimensions,
    });
  }
  if (clip.source?.type === 'transition-overlay' && clip.transitionOverlay) {
    return createTimelineTransitionOverlayCanvasRuntime({
      overlay: clip.transitionOverlay,
      dimensions,
    });
  }

  return null;
}

/**
 * History snapshots intentionally contain data only. Recreate generated canvas
 * sources synchronously before the restored state reaches LayerBuilder so an
 * undo/redo frame cannot transiently omit text, solids, math scenes, or
 * transition overlays.
 */
export function rehydrateHistoryGeneratedTimelineRuntimes(
  clips: readonly TimelineClip[],
  dimensions?: TimelineGeneratedCanvasDimensions,
): TimelineClip[] {
  let changed = false;
  const rehydrated = clips.map((clip) => {
    const textCanvas = createGeneratedCanvasRuntime(clip, dimensions);
    if (!textCanvas || clip.source?.textCanvas === textCanvas || !clip.source) return clip;
    changed = true;
    return {
      ...clip,
      source: {
        ...clip.source,
        textCanvas,
      },
    };
  });

  return changed ? rehydrated : [...clips];
}

function getHistoryRehydrateOwnerId(clipId: string): string {
  return `${HISTORY_REHYDRATE_OWNER_PREFIX}:${clipId}`;
}

/**
 * Only live handles occupy the interactive budget here. A runtime binding alone is a key: no element or
 * decoder stands behind it until its clip enters the warm window, and that path reserves its own resources.
 * Reporting every bound clip made a 500-piece cut hold 500 sessions against a limit of 64, which refused
 * every new media element and decoder for as long as the project stayed open.
 */
function hasReportableRuntimeSource(clip: TimelineClip): boolean {
  const source = clip.source;
  if (!source) return false;
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
