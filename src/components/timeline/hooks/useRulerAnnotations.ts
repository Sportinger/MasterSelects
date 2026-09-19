// Annotation state and interactions for the timeline ruler: projection of
// composition/clip annotations into ruler coordinates, pointer drag/trim,
// keyboard nudging, creation, clip linking, and the expanded reader.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { SourceAnnotation } from '../../../types/sourceAnnotation';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineRulerActionMenuState } from '../TimelineRulerActionMenu';

export type AnnotationDragMode = 'move' | 'trim-start' | 'trim-end';
export type RulerAnnotationScope = 'composition' | 'clip';

interface AnnotationDragState {
  annotationId: string;
  compositionId: string;
  mode: AnnotationDragMode;
  pointerId: number;
  startClientX: number;
  originalStartTime: number;
  originalEndTime: number;
  scope: RulerAnnotationScope;
  clipStartTime: number;
  minimumTime: number;
  maximumTime: number;
}

export interface ProjectedRulerAnnotation {
  annotation: SourceAnnotation;
  displayStartTime: number;
  displayEndTime: number;
  scope: RulerAnnotationScope;
  clipStartTime: number;
  minimumTime: number;
  maximumTime: number;
}

export interface PendingAnnotationClipLink {
  annotationId: string;
  candidateClipIds: string[];
  time: number;
  initialX: number;
  initialY: number;
}

export interface ExpandedRulerAnnotation {
  annotationId: string;
  bottom: number;
  displayEndTime: number;
  displayStartTime: number;
  left: number;
  maxHeight: number;
  scope: RulerAnnotationScope;
  width: number;
}

const DEFAULT_ANNOTATION_LENGTH_SECONDS = 2;
const READER_MAX_WIDTH_PX = 560;
const READER_MAX_HEIGHT_PX = 440;
const READER_MIN_HEIGHT_PX = 170;
const READER_MARGIN_PX = 16;

function quantizeAnnotationTime(time: number, frameRate: number): number {
  const frameDuration = 1 / Math.max(1, frameRate);
  return Math.round(time / frameDuration) * frameDuration;
}

function createRulerAnnotationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `annotation-${crypto.randomUUID()}`;
  }
  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface UseRulerAnnotationsInput {
  actionMenu: TimelineRulerActionMenuState | null;
  duration: number;
  frameRate: number;
  rulerRef: RefObject<HTMLDivElement | null>;
  setActionMenu: (menu: TimelineRulerActionMenuState | null) => void;
  visibleEndTime: number;
  visibleStartTime: number;
  zoom: number;
}

export function useRulerAnnotations({
  actionMenu,
  duration,
  frameRate,
  rulerRef,
  setActionMenu,
  visibleEndTime,
  visibleStartTime,
  zoom,
}: UseRulerAnnotationsInput) {
  const [annotationDrag, setAnnotationDrag] = useState<AnnotationDragState | null>(null);
  const [contextAnnotationId, setContextAnnotationId] = useState<string | null>(null);
  const [pendingClipLink, setPendingClipLink] = useState<PendingAnnotationClipLink | null>(null);
  const [expandedAnnotation, setExpandedAnnotation] = useState<ExpandedRulerAnnotation | null>(null);
  const clipLinkTooltipRef = useRef<HTMLDivElement | null>(null);
  const expandedAnnotationRef = useRef<HTMLDivElement | null>(null);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const activeComposition = useMediaStore((state) => (
    state.compositions.find((composition) => composition.id === activeCompositionId) ?? null
  ));
  const timelineClips = useTimelineStore((state) => state.clips);
  const clipDragPreview = useTimelineStore((state) => state.clipDragPreview);
  const rulerAnnotationsVisible = useAnnotationStore((state) => state.rulerAnnotationsVisible);
  const contextAnnotation = activeComposition?.annotations?.find(
    (annotation) => annotation.id === contextAnnotationId,
  ) ?? null;
  const expandedAnnotationData = activeComposition?.annotations?.find(
    (annotation) => annotation.id === expandedAnnotation?.annotationId,
  ) ?? null;
  const frameDuration = 1 / Math.max(1, frameRate);

  const resolveClipStartTime = (clipId: string): number | null => {
    const clip = timelineClips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;
    return clipDragPreview?.patches[clip.id]?.startTime ?? clip.startTime;
  };

  const visibleAnnotations = rulerAnnotationsVisible
    ? (activeComposition?.annotations ?? [])
      .flatMap((annotation): ProjectedRulerAnnotation[] => {
        if (annotation.scope !== 'clip' || !annotation.clipId) {
          return [{
            annotation,
            displayStartTime: Math.max(0, Math.min(duration, annotation.startTime)),
            displayEndTime: Math.max(0, Math.min(duration, annotation.endTime)),
            scope: 'composition',
            clipStartTime: 0,
            minimumTime: 0,
            maximumTime: duration,
          }];
        }
        const clip = timelineClips.find((candidate) => candidate.id === annotation.clipId);
        if (!clip) return [];
        const clipStartTime = clipDragPreview?.patches[clip.id]?.startTime ?? clip.startTime;
        const clipEndTime = Math.min(duration, clipStartTime + clip.duration);
        return [{
          annotation,
          displayStartTime: Math.max(clipStartTime, Math.min(clipEndTime, clipStartTime + annotation.startTime)),
          displayEndTime: Math.max(clipStartTime, Math.min(clipEndTime, clipStartTime + annotation.endTime)),
          scope: 'clip',
          clipStartTime,
          minimumTime: clipStartTime,
          maximumTime: clipEndTime,
        }];
      })
      .filter((projected) => (
        projected.displayEndTime > projected.displayStartTime
        && projected.displayEndTime >= visibleStartTime
        && projected.displayStartTime <= visibleEndTime
      ))
    : [];

  const updateAnnotation = (
    compositionId: string,
    annotationId: string,
    updates: Partial<Pick<SourceAnnotation, 'startTime' | 'endTime' | 'scope' | 'clipId'>>,
  ) => {
    const mediaState = useMediaStore.getState();
    const composition = mediaState.compositions.find((candidate) => candidate.id === compositionId);
    if (!composition?.annotations) return;
    mediaState.updateComposition(compositionId, {
      annotations: composition.annotations.map((annotation) => (
        annotation.id === annotationId ? { ...annotation, ...updates } : annotation
      )),
    });
  };

  /** Applies a display-time range to an annotation, converting to clip-relative storage when linked. */
  const commitDisplayRange = (
    target: Pick<ProjectedRulerAnnotation, 'scope' | 'clipStartTime'> & { annotationId: string; compositionId: string },
    range: { endTime?: number; startTime?: number },
  ) => {
    const offset = target.scope === 'clip' ? target.clipStartTime : 0;
    updateAnnotation(target.compositionId, target.annotationId, {
      ...(range.startTime !== undefined ? { startTime: range.startTime - offset } : {}),
      ...(range.endTime !== undefined ? { endTime: range.endTime - offset } : {}),
    });
  };

  const beginAnnotationDrag = (
    event: ReactPointerEvent<HTMLElement>,
    projected: ProjectedRulerAnnotation,
    mode: AnnotationDragMode,
  ) => {
    if (!activeComposition || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnnotationDrag({
      annotationId: projected.annotation.id,
      compositionId: activeComposition.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originalStartTime: projected.displayStartTime,
      originalEndTime: projected.displayEndTime,
      scope: projected.scope,
      clipStartTime: projected.clipStartTime,
      minimumTime: projected.minimumTime,
      maximumTime: projected.maximumTime,
    });
  };

  const updateAnnotationDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!annotationDrag || event.pointerId !== annotationDrag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaTime = (event.clientX - annotationDrag.startClientX) / Math.max(zoom, 0.001);

    if (annotationDrag.mode === 'move') {
      const annotationDuration = annotationDrag.originalEndTime - annotationDrag.originalStartTime;
      const startTime = quantizeAnnotationTime(
        Math.max(
          annotationDrag.minimumTime,
          Math.min(annotationDrag.maximumTime - annotationDuration, annotationDrag.originalStartTime + deltaTime),
        ),
        frameRate,
      );
      commitDisplayRange(annotationDrag, {
        endTime: Math.min(annotationDrag.maximumTime, startTime + annotationDuration),
        startTime,
      });
      return;
    }

    if (annotationDrag.mode === 'trim-start') {
      commitDisplayRange(annotationDrag, {
        startTime: quantizeAnnotationTime(
          Math.max(
            annotationDrag.minimumTime,
            Math.min(annotationDrag.originalEndTime - frameDuration, annotationDrag.originalStartTime + deltaTime),
          ),
          frameRate,
        ),
      });
      return;
    }

    commitDisplayRange(annotationDrag, {
      endTime: quantizeAnnotationTime(
        Math.max(
          annotationDrag.originalStartTime + frameDuration,
          Math.min(annotationDrag.maximumTime, annotationDrag.originalEndTime + deltaTime),
        ),
        frameRate,
      ),
    });
  };

  const endAnnotationDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!annotationDrag || event.pointerId !== annotationDrag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setAnnotationDrag(null);
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.classList.contains('timeline-ruler-annotation-handle')) {
        activeElement.blur();
      }
    }, 0);
  };

  /** Keyboard counterpart of the pointer drag: one frame per arrow key press. */
  const nudgeAnnotation = (
    event: ReactKeyboardEvent<HTMLElement>,
    projected: ProjectedRulerAnnotation,
    mode: AnnotationDragMode,
  ) => {
    if (!activeComposition || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * frameDuration * (event.shiftKey ? 10 : 1);
    const target = { annotationId: projected.annotation.id, clipStartTime: projected.clipStartTime, compositionId: activeComposition.id, scope: projected.scope };
    const length = projected.displayEndTime - projected.displayStartTime;
    if (mode === 'move') {
      const startTime = Math.max(projected.minimumTime, Math.min(projected.maximumTime - length, projected.displayStartTime + delta));
      commitDisplayRange(target, { endTime: startTime + length, startTime });
    } else if (mode === 'trim-start') {
      commitDisplayRange(target, {
        startTime: Math.max(projected.minimumTime, Math.min(projected.displayEndTime - frameDuration, projected.displayStartTime + delta)),
      });
    } else {
      commitDisplayRange(target, {
        endTime: Math.max(projected.displayStartTime + frameDuration, Math.min(projected.maximumTime, projected.displayEndTime + delta)),
      });
    }
  };

  const addCompositionAnnotation = (time: number) => {
    if (!activeComposition) return;
    const text = window.prompt('Annotation text');
    if (!text?.trim()) return;
    const endTime = Math.min(duration, time + DEFAULT_ANNOTATION_LENGTH_SECONDS);
    const startTime = endTime > time ? time : Math.max(0, duration - DEFAULT_ANNOTATION_LENGTH_SECONDS);
    useMediaStore.getState().updateComposition(activeComposition.id, {
      annotations: [
        ...(activeComposition.annotations ?? []),
        {
          id: createRulerAnnotationId(),
          text: text.trim(),
          startTime,
          endTime,
          createdAt: Date.now(),
          scope: 'composition',
        },
      ],
    });
  };

  const linkAnnotationToClip = (annotationId: string, clipId: string, anchorTime: number) => {
    if (!activeComposition) return;
    const annotation = activeComposition.annotations?.find((candidate) => candidate.id === annotationId);
    const clip = timelineClips.find((candidate) => candidate.id === clipId);
    if (!annotation || !clip) return;

    const clipStartTime = clipDragPreview?.patches[clip.id]?.startTime ?? clip.startTime;
    const clipEndTime = Math.min(duration, clipStartTime + clip.duration);
    const linkedOffset = annotation.scope === 'clip' && annotation.clipId
      ? resolveClipStartTime(annotation.clipId) ?? 0
      : 0;
    const absoluteStartTime = linkedOffset + annotation.startTime;
    const absoluteEndTime = linkedOffset + annotation.endTime;
    let linkedStartTime = Math.max(clipStartTime, Math.min(clipEndTime, absoluteStartTime));
    let linkedEndTime = Math.max(clipStartTime, Math.min(clipEndTime, absoluteEndTime));

    if (linkedEndTime <= linkedStartTime) {
      linkedStartTime = Math.max(clipStartTime, Math.min(clipEndTime, anchorTime));
      linkedEndTime = Math.min(clipEndTime, linkedStartTime + Math.max(frameDuration, DEFAULT_ANNOTATION_LENGTH_SECONDS));
      if (linkedEndTime <= linkedStartTime) {
        linkedStartTime = Math.max(clipStartTime, clipEndTime - frameDuration);
        linkedEndTime = clipEndTime;
      }
    }

    updateAnnotation(activeComposition.id, annotationId, {
      startTime: linkedStartTime - clipStartTime,
      endTime: linkedEndTime - clipStartTime,
      scope: 'clip',
      clipId,
    });
  };
  // The clip-link effect below runs against the latest closure via this ref,
  // so clips moved while the picker is open link against current positions.
  const linkAnnotationToClipRef = useRef(linkAnnotationToClip);
  useEffect(() => {
    linkAnnotationToClipRef.current = linkAnnotationToClip;
  });

  const linkContextAnnotationToClip = (time: number) => {
    if (!contextAnnotation || contextAnnotation.scope === 'clip') return;
    const candidateClips = timelineClips.filter((clip) => {
      const clipStartTime = clipDragPreview?.patches[clip.id]?.startTime ?? clip.startTime;
      return time >= clipStartTime && time <= clipStartTime + clip.duration;
    });
    if (candidateClips.length === 1) {
      linkAnnotationToClip(contextAnnotation.id, candidateClips[0].id, time);
      return;
    }
    if (candidateClips.length > 1) {
      setPendingClipLink({
        annotationId: contextAnnotation.id,
        candidateClipIds: candidateClips.map((clip) => clip.id),
        time,
        initialX: actionMenu?.x ?? 0,
        initialY: actionMenu?.y ?? 0,
      });
    }
  };

  const convertContextAnnotationToComposition = () => {
    if (!activeComposition || contextAnnotation?.scope !== 'clip' || !contextAnnotation.clipId) return;
    const clipStartTime = resolveClipStartTime(contextAnnotation.clipId);
    if (clipStartTime === null) return;
    updateAnnotation(activeComposition.id, contextAnnotation.id, {
      startTime: clipStartTime + contextAnnotation.startTime,
      endTime: clipStartTime + contextAnnotation.endTime,
      scope: 'composition',
      clipId: undefined,
    });
  };

  const openExpandedAnnotation = (anchor: HTMLElement, clientX: number, projected: ProjectedRulerAnnotation) => {
    const anchorRect = anchor.getBoundingClientRect();
    const panelWidth = Math.min(READER_MAX_WIDTH_PX, window.innerWidth - READER_MARGIN_PX * 2);
    const left = Math.max(
      READER_MARGIN_PX,
      Math.min(window.innerWidth - panelWidth - READER_MARGIN_PX, clientX - panelWidth / 2),
    );
    setExpandedAnnotation({
      annotationId: projected.annotation.id,
      bottom: Math.max(READER_MARGIN_PX, window.innerHeight - anchorRect.top + 8),
      displayEndTime: projected.displayEndTime,
      displayStartTime: projected.displayStartTime,
      left,
      maxHeight: Math.max(READER_MIN_HEIGHT_PX, Math.min(READER_MAX_HEIGHT_PX, anchorRect.top - 24)),
      scope: projected.scope,
      width: panelWidth,
    });
  };

  const openAnnotationContextMenu = (event: ReactMouseEvent<HTMLDivElement>, projected: ProjectedRulerAnnotation) => {
    event.preventDefault();
    event.stopPropagation();
    setContextAnnotationId(projected.annotation.id);
    const rulerLeft = rulerRef.current?.getBoundingClientRect().left ?? 0;
    setActionMenu({
      time: Math.max(0, Math.min(duration, (event.clientX - rulerLeft) / Math.max(zoom, 0.001))),
      x: event.clientX,
      y: event.clientY,
    });
  };

  const closeActionMenu = () => {
    setActionMenu(null);
    setContextAnnotationId(null);
  };

  useEffect(() => {
    if (!pendingClipLink) return undefined;

    const moveTooltip = (event: PointerEvent) => {
      if (!clipLinkTooltipRef.current) return;
      clipLinkTooltipRef.current.style.transform = `translate3d(${event.clientX + 18}px, ${event.clientY + 18}px, 0)`;
    };
    const finishLink = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.timeline-body-content')) return;
      window.setTimeout(() => {
        const timelineState = useTimelineStore.getState();
        const selectedClipId = timelineState.primarySelectedClipId
          && timelineState.selectedClipIds.has(timelineState.primarySelectedClipId)
          ? timelineState.primarySelectedClipId
          : timelineState.selectedClipIds.size > 0
            ? [...timelineState.selectedClipIds][0]
            : null;
        if (!selectedClipId || !pendingClipLink.candidateClipIds.includes(selectedClipId)) return;
        linkAnnotationToClipRef.current(pendingClipLink.annotationId, selectedClipId, pendingClipLink.time);
        setPendingClipLink(null);
      }, 0);
    };
    const cancelLink = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingClipLink(null);
    };

    window.addEventListener('pointermove', moveTooltip);
    window.addEventListener('pointerup', finishLink);
    window.addEventListener('keydown', cancelLink);
    return () => {
      window.removeEventListener('pointermove', moveTooltip);
      window.removeEventListener('pointerup', finishLink);
      window.removeEventListener('keydown', cancelLink);
    };
  }, [pendingClipLink]);

  useEffect(() => {
    if (!expandedAnnotation) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && expandedAnnotationRef.current?.contains(event.target)) return;
      setExpandedAnnotation(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedAnnotation(null);
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('pointerdown', closeOnOutsidePointer);
    }, 0);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedAnnotation]);

  return {
    addCompositionAnnotation,
    beginAnnotationDrag,
    clearContextAnnotation: () => setContextAnnotationId(null),
    clipLinkTooltipRef,
    closeActionMenu,
    closeExpandedAnnotation: () => setExpandedAnnotation(null),
    contextAnnotation,
    convertContextAnnotationToComposition,
    draggingAnnotationId: annotationDrag?.annotationId ?? null,
    endAnnotationDrag,
    expandedAnnotation,
    expandedAnnotationData,
    expandedAnnotationRef,
    linkContextAnnotationToClip,
    nudgeAnnotation,
    openAnnotationContextMenu,
    openExpandedAnnotation,
    pendingClipLink,
    updateAnnotationDrag,
    visibleAnnotations,
  };
}
