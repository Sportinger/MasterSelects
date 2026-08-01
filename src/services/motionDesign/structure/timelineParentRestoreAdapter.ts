import type { TimelineClip } from '../../../types/timeline';
import type { MotionParentFailure } from './contracts';
import { sanitizeTimelineParentGraph } from './timelineParentGraphSanitizer';

export interface TimelineParentRestoreDiagnostic {
  readonly compositionId: string;
  readonly clipPath: readonly string[];
  readonly failure: MotionParentFailure;
}

export interface TimelineParentRestoreResult {
  readonly clips: TimelineClip[];
  readonly diagnostics: readonly TimelineParentRestoreDiagnostic[];
  readonly changed: boolean;
}

/**
 * Applies the frozen parent-graph sanitizer to a restored timeline and every
 * embedded composition tree. TimelineClip.compositionId identifies the source
 * of a nested composition, so it is intentionally never passed as a node owner.
 */
export function sanitizeTimelineParentRestoreTree(
  compositionId: string,
  clips: readonly TimelineClip[],
  clipPath: readonly string[] = [],
): TimelineParentRestoreResult {
  const sanitized = sanitizeTimelineParentGraph(
    compositionId,
    clips.map((clip) => ({
      id: clip.id,
      ...(clip.parentClipId ? { parentClipId: clip.parentClipId } : {}),
      ...(clip.is3D === true ? { is3D: true } : {}),
    })),
  );
  const assignments = sanitized.ok
    ? new Map(sanitized.assignments.map((assignment) => [
        assignment.clipId,
        assignment.parentClipId,
      ]))
    : new Map<string, string | undefined>();
  const diagnostics: TimelineParentRestoreDiagnostic[] = sanitized.diagnostics.map(
    (failure) => ({ compositionId, clipPath: [...clipPath], failure }),
  );
  let changed = false;
  const nextClips = clips.map((clip) => {
    const nextParentClipId = assignments.get(clip.id);
    let nextNestedClips = clip.nestedClips;
    if (clip.nestedClips) {
      const nestedCompositionId = clip.compositionId
        ?? `${compositionId}:nested:${clip.id}`;
      const nested = sanitizeTimelineParentRestoreTree(
        nestedCompositionId,
        clip.nestedClips,
        [...clipPath, clip.id],
      );
      diagnostics.push(...nested.diagnostics);
      if (nested.changed) nextNestedClips = nested.clips;
    }
    if (
      nextParentClipId === clip.parentClipId
      && nextNestedClips === clip.nestedClips
    ) {
      return clip;
    }
    changed = true;
    return {
      ...clip,
      parentClipId: nextParentClipId,
      ...(nextNestedClips ? { nestedClips: nextNestedClips } : {}),
    };
  });

  return {
    clips: changed ? nextClips : clips as TimelineClip[],
    diagnostics,
    changed,
  };
}
