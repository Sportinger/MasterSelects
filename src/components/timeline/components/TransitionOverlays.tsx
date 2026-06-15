// Transition overlay elements (junction highlight + existing transitions)

import { useMemo } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { getRuntimeTransition } from '../../../transitions';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../../stores/timeline/editOperations/transitionPlanner';
import { buildTransitionToolPreviewGhostRanges } from '../../../stores/timeline/editOperations/transitionToolPreview';
import { createTransitionMediaDurationResolver } from '../../../stores/timeline/editOperations/transitionMediaDurationResolver';

interface TransitionOverlaysProps {
  activeJunction: { trackId: string; junctionTime: number } | null;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  timeToPixel: (time: number) => number;
  isTrackExpanded: (trackId: string) => boolean;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  getTrackHeight?: (track: TimelineTrack) => number;
}

function clampDuration(value: number, minDuration: number): number {
  return Math.max(minDuration, value);
}

const TRANSITION_SNAP_PX = 10;
const TRANSITION_SNAP_SECONDS_MIN = 1 / 120;
const TRANSITION_SNAP_SECONDS_MAX = 0.12;
const TRANSITION_DRAG_ACTIVATION_PX = 2;

interface TransitionHandleSnapLimits {
  incomingHandleAvailable: number;
  outgoingHandleAvailable: number;
}

interface TransitionSnapTimesInput {
  clips: readonly TimelineClip[];
  currentTransitionId: string;
  getMediaDuration: (mediaFileId: string) => number | undefined;
}

function getTransitionSnapThresholdSeconds(pixelsPerSecond: number): number {
  return Math.min(
    TRANSITION_SNAP_SECONDS_MAX,
    Math.max(TRANSITION_SNAP_SECONDS_MIN, TRANSITION_SNAP_PX / pixelsPerSecond),
  );
}

function uniqueFiniteTargets(targets: readonly number[]): number[] {
  const result: number[] = [];
  for (const target of targets) {
    if (!Number.isFinite(target)) continue;
    if (result.some(candidate => Math.abs(candidate - target) < 0.0005)) continue;
    result.push(Math.abs(target) < 0.0005 ? 0 : target);
  }
  return result;
}

function snapToTargets(value: number, targets: readonly number[], threshold: number): number {
  let snapped = value;
  let bestDistance = threshold;

  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance > bestDistance) continue;

    bestDistance = distance;
    snapped = Math.abs(target) < 0.0005 ? 0 : target;
  }

  return snapped;
}

function getOtherTransitionSnapTimes({
  clips,
  currentTransitionId,
  getMediaDuration,
}: TransitionSnapTimesInput): number[] {
  const targets: number[] = [];

  for (const outgoingClip of clips) {
    const transition = outgoingClip.transitionOut;
    if (!transition || transition.id === currentTransitionId) continue;

    const incomingClip = clips.find(candidate => candidate.id === transition.linkedClipId);
    if (!incomingClip) continue;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime: outgoingClip.startTime + outgoingClip.duration,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration,
    });
    if (!plan) continue;

    targets.push(
      plan.bodyStart,
      (plan.bodyStart + plan.bodyEnd) * 0.5,
      plan.bodyEnd,
    );
  }

  return uniqueFiniteTargets(targets);
}

function getOffsetSnapTargets(
  duration: number,
  limits: TransitionHandleSnapLimits,
  junctionTime: number,
  otherTransitionTimes: readonly number[],
): number[] {
  const halfDuration = duration * 0.5;
  return uniqueFiniteTargets([
    0,
    halfDuration - limits.incomingHandleAvailable,
    limits.outgoingHandleAvailable - halfDuration,
    ...otherTransitionTimes.flatMap(targetTime => [
      targetTime - junctionTime + halfDuration,
      targetTime - junctionTime,
      targetTime - junctionTime - halfDuration,
    ]),
  ]);
}

function getDurationSnapTargets(
  offset: number,
  minDuration: number,
  limits: TransitionHandleSnapLimits,
  junctionTime: number,
  resizeEdge: 'start' | 'end',
  otherTransitionTimes: readonly number[],
): number[] {
  const transitionCenter = junctionTime + offset;
  const transitionTimeTargets = otherTransitionTimes.map(targetTime =>
    resizeEdge === 'start'
      ? 2 * (transitionCenter - targetTime)
      : 2 * (targetTime - transitionCenter)
  );

  return uniqueFiniteTargets([
    2 * (offset + limits.incomingHandleAvailable),
    2 * (limits.outgoingHandleAvailable - offset),
    ...transitionTimeTargets,
  ]).filter(target => target >= minDuration);
}

export function TransitionOverlays({
  activeJunction,
  clips,
  tracks,
  timeToPixel,
  isTrackExpanded,
  getExpandedTrackHeight,
  getTrackHeight,
}: TransitionOverlaysProps) {
  const selectTransitionProperties = useTimelineStore(state => state.selectTransitionProperties);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);
  const setTimelineToolPreview = useTimelineStore(state => state.setTimelineToolPreview);
  const editPreview = useTimelineStore(state => state.transitionEditPreview);
  const setTransitionEditPreview = useTimelineStore(state => state.setTransitionEditPreview);
  const mediaFiles = useMediaStore(state => state.files);
  const getMediaDuration = useMemo(() => createTransitionMediaDurationResolver(mediaFiles), [mediaFiles]);
  const resolveTrackHeight = (track: TimelineTrack) => getTrackHeight
    ? getTrackHeight(track)
    : isTrackExpanded(track.id)
      ? getExpandedTrackHeight(track.id, track.height)
      : track.height;
  const getTrackTop = (track: TimelineTrack) => {
    const trackIndex = tracks.indexOf(track);
    return tracks
      .slice(0, trackIndex)
      .reduce((sum, candidate) => sum + resolveTrackHeight(candidate), 0);
  };
  const getTransitionHandleSnapLimits = (
    clipA: TimelineClip,
    clipB: TimelineClip,
    transitionType: string,
    requestedDuration: number,
    junctionTime: number,
  ): TransitionHandleSnapLimits => {
    const plan = planTransition({
      outgoingClip: clipA,
      incomingClip: clipB,
      transitionType,
      requestedDuration,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime,
      bodyOffset: 0,
      getMediaDuration,
    });

    return {
      incomingHandleAvailable: Math.max(0, plan?.incoming.handleAvailable ?? 0),
      outgoingHandleAvailable: Math.max(0, plan?.outgoing.handleAvailable ?? 0),
    };
  };
  const startTransitionResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    resizeEdge: 'start' | 'end',
    clipA: TimelineClip,
    clipB: TimelineClip,
    minDuration: number,
  ) => {
    const transition = clipA.transitionOut;
    if (!transition) return;

    const pixelsPerSecond = Math.abs(timeToPixel(1) - timeToPixel(0));
    if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    let hasDragged = false;
    const startDuration = transition.duration;
    const startOffset = transition.offset ?? 0;
    const junctionTime = clipA.startTime + clipA.duration;
    const snapThresholdSeconds = getTransitionSnapThresholdSeconds(pixelsPerSecond);
    const snapLimits = getTransitionHandleSnapLimits(
      clipA,
      clipB,
      transition.type,
      startDuration,
      junctionTime,
    );
    const otherTransitionSnapTimes = getOtherTransitionSnapTimes({
      clips,
      currentTransitionId: transition.id,
      getMediaDuration,
    });
    const durationSnapTargets = getDurationSnapTargets(
      startOffset,
      minDuration,
      snapLimits,
      junctionTime,
      resizeEdge,
      otherTransitionSnapTimes,
    );
    const snapDuration = (duration: number) => snapToTargets(
      clampDuration(duration, minDuration),
      durationSnapTargets,
      snapThresholdSeconds * 2,
    );
    const getDurationFromClientX = (clientX: number) => {
      const deltaSeconds = (clientX - startClientX) / pixelsPerSecond;
      return snapDuration(
        resizeEdge === 'start'
          ? startDuration - deltaSeconds * 2
          : startDuration + deltaSeconds * 2,
      );
    };
    const showResizePreview = (duration: number) => {
      const plan = planTransition({
        outgoingClip: clipA,
        incomingClip: clipB,
        transitionType: transition.type,
        requestedDuration: duration,
        params: transition.params,
        placement: DEFAULT_TRANSITION_PLACEMENT,
        edgePolicy: 'hold',
        junctionTime,
        bodyOffset: startOffset,
        getMediaDuration,
      });
      if (!plan) return;

      const idPrefix = `transition-resize-preview:${transition.id}`;
      setTimelineToolPreview({
        toolId: 'select',
        plane: 'section-scrolled',
        trackId: clipA.trackId,
        trackIds: [clipA.trackId],
        time: junctionTime,
        startTime: plan.bodyStart,
        endTime: plan.bodyEnd,
        label: transition.type,
        ghostRanges: buildTransitionToolPreviewGhostRanges(plan, idPrefix, transition.type),
        zIndex: 16,
      });
    };

    selectTransitionProperties(clipA.id, 'out', transition.id);
    setTransitionEditPreview({
      clipId: clipA.id,
      edge: 'out',
      transitionId: transition.id,
      duration: startDuration,
      offset: startOffset,
    });
    showResizePreview(startDuration);
    target.setPointerCapture(pointerId);

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    };
    const finishResize = (requestedDuration: number | null) => {
      cleanup();
      setTimelineToolPreview(null);
      if (!hasDragged || requestedDuration === null || Math.abs(requestedDuration - startDuration) < 0.001) {
        setTransitionEditPreview(null);
        return;
      }

      const operationId = `transition-resize:${transition.id}:${Date.now()}`;
      applyTimelineEditOperation({
        id: operationId,
        type: 'transition-update-duration',
        transactionId: operationId,
        historyBatchId: operationId,
        source: 'ui',
        clipId: clipA.id,
        edge: 'out',
        transitionId: transition.id,
        requestedDuration,
      }, {
        source: 'ui',
        historyLabel: 'Resize transition',
      });
      setTransitionEditPreview(null);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!hasDragged && Math.abs(moveEvent.clientX - startClientX) < TRANSITION_DRAG_ACTIVATION_PX) {
        return;
      }
      hasDragged = true;
      const duration = getDurationFromClientX(moveEvent.clientX);
      setTransitionEditPreview({
        clipId: clipA.id,
        edge: 'out',
        transitionId: transition.id,
        duration,
        offset: startOffset,
      });
      showResizePreview(duration);
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      finishResize(getDurationFromClientX(upEvent.clientX));
    };
    const handlePointerCancel = () => {
      finishResize(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  };
  const startTransitionMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    clipA: TimelineClip,
    clipB: TimelineClip,
  ) => {
    const transition = clipA.transitionOut;
    if (!transition) return;

    const pixelsPerSecond = Math.abs(timeToPixel(1) - timeToPixel(0));
    if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    let hasDragged = false;
    const startOffset = transition.offset ?? 0;
    const junctionTime = clipA.startTime + clipA.duration;
    const snapThresholdSeconds = getTransitionSnapThresholdSeconds(pixelsPerSecond);
    const snapLimits = getTransitionHandleSnapLimits(
      clipA,
      clipB,
      transition.type,
      transition.duration,
      junctionTime,
    );
    const otherTransitionSnapTimes = getOtherTransitionSnapTimes({
      clips,
      currentTransitionId: transition.id,
      getMediaDuration,
    });
    const offsetSnapTargets = getOffsetSnapTargets(
      transition.duration,
      snapLimits,
      junctionTime,
      otherTransitionSnapTimes,
    );
    const getOffsetFromClientX = (clientX: number) => {
      const offset = startOffset + ((clientX - startClientX) / pixelsPerSecond);
      return snapToTargets(offset, offsetSnapTargets, snapThresholdSeconds);
    };
    const showMovePreview = (offset: number) => {
      const plan = planTransition({
        outgoingClip: clipA,
        incomingClip: clipB,
        transitionType: transition.type,
        requestedDuration: transition.duration,
        params: transition.params,
        placement: DEFAULT_TRANSITION_PLACEMENT,
        edgePolicy: 'hold',
        junctionTime,
        bodyOffset: offset,
        getMediaDuration,
      });
      if (!plan) return;

      const idPrefix = `transition-move-preview:${transition.id}`;
      setTimelineToolPreview({
        toolId: 'select',
        plane: 'section-scrolled',
        trackId: clipA.trackId,
        trackIds: [clipA.trackId],
        time: junctionTime,
        startTime: plan.bodyStart,
        endTime: plan.bodyEnd,
        label: transition.type,
        ghostRanges: buildTransitionToolPreviewGhostRanges(plan, idPrefix, transition.type),
        zIndex: 16,
      });
    };

    selectTransitionProperties(clipA.id, 'out', transition.id);
    setTransitionEditPreview({
      clipId: clipA.id,
      edge: 'out',
      transitionId: transition.id,
      duration: transition.duration,
      offset: startOffset,
    });
    target.setPointerCapture(pointerId);

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    };
    const finishMove = (requestedOffset: number | null) => {
      cleanup();
      setTimelineToolPreview(null);
      if (!hasDragged || requestedOffset === null || Math.abs(requestedOffset - startOffset) < 0.001) {
        setTransitionEditPreview(null);
        return;
      }

      const operationId = `transition-move:${transition.id}:${Date.now()}`;
      applyTimelineEditOperation({
        id: operationId,
        type: 'transition-update-offset',
        transactionId: operationId,
        historyBatchId: operationId,
        source: 'ui',
        clipId: clipA.id,
        edge: 'out',
        transitionId: transition.id,
        requestedOffset,
      }, {
        source: 'ui',
        historyLabel: 'Move transition',
      });
      setTransitionEditPreview(null);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!hasDragged && Math.abs(moveEvent.clientX - startClientX) < TRANSITION_DRAG_ACTIVATION_PX) {
        return;
      }
      hasDragged = true;
      const offset = getOffsetFromClientX(moveEvent.clientX);
      setTransitionEditPreview({
        clipId: clipA.id,
        edge: 'out',
        transitionId: transition.id,
        duration: transition.duration,
        offset,
      });
      showMovePreview(offset);
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      finishMove(getOffsetFromClientX(upEvent.clientX));
    };
    const handlePointerCancel = () => {
      finishMove(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  };

  return (
    <>
      {/* Junction highlight for transition drop */}
      {activeJunction && (() => {
        const track = tracks.find(candidate => candidate.id === activeJunction.trackId);
        if (!track) return null;

        const trackTop = getTrackTop(track);
        const trackHeight = resolveTrackHeight(track);

        return (
          <div
            className="transition-junction-highlight"
            style={{
              position: 'absolute',
              left: timeToPixel(activeJunction.junctionTime) - 15,
              width: 30,
              top: trackTop + 4,
              height: Math.max(1, trackHeight - 8),
              background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.4), transparent)',
              pointerEvents: 'none',
              zIndex: 30,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                background: '#3b82f6',
                color: 'white',
                padding: '4px 10px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              Drop transition
            </div>
          </div>
        );
      })()}

      {/* Render existing transitions as junction elements */}
      {clips.filter(c => c.transitionOut).map(clipA => {
        const clipB = clips.find(c => c.id === clipA.transitionOut?.linkedClipId);
        if (!clipB || !clipA.transitionOut) return null;

        const track = tracks.find(t => t.id === clipA.trackId);
        if (!track) return null;

        // Calculate track position
        const trackTop = getTrackTop(track);
        const trackHeight = resolveTrackHeight(track);

        const transitionDefinition = getRuntimeTransition(clipA.transitionOut.type);
        const transitionName = transitionDefinition?.name ?? clipA.transitionOut.type;
        const displayDuration = editPreview?.transitionId === clipA.transitionOut.id
          ? editPreview.duration
          : clipA.transitionOut.duration;
        const displayOffset = editPreview?.transitionId === clipA.transitionOut.id
          ? editPreview.offset
          : clipA.transitionOut.offset ?? 0;
        const transitionEnd = clipA.startTime + clipA.duration;
        const plan = planTransition({
          outgoingClip: clipA,
          incomingClip: clipB,
          transitionType: clipA.transitionOut.type,
          requestedDuration: displayDuration,
          params: clipA.transitionOut.params,
          placement: DEFAULT_TRANSITION_PLACEMENT,
          edgePolicy: 'hold',
          junctionTime: transitionEnd,
          bodyOffset: displayOffset,
          getMediaDuration,
        });
        const transitionStart = plan?.bodyStart ?? transitionEnd - (displayDuration * 0.5);
        const bodyEnd = plan?.bodyEnd ?? transitionEnd + (displayDuration * 0.5);
        const transitionLeft = timeToPixel(transitionStart);
        const transitionWidth = timeToPixel(bodyEnd) - transitionLeft;
        const displayedTransitionWidth = Math.max(transitionWidth, 20);
        const transitionLabelFontSize = Math.max(
          10,
          Math.min(
            22,
            Math.max(10, trackHeight - 14),
            Math.max(10, (displayedTransitionWidth - 18) / Math.max(transitionName.length * 0.58, 1)),
          ),
        );
        const isSelected = propertiesSelection?.kind === 'transition' &&
          propertiesSelection.clipId === clipA.id &&
          propertiesSelection.edge === 'out' &&
          propertiesSelection.transitionId === clipA.transitionOut.id;
        const handleSelect = (event: MouseEvent | KeyboardEvent) => {
          event.stopPropagation();
          selectTransitionProperties(clipA.id, 'out', clipA.transitionOut!.id);
        };

        return (
          <div
            key={clipA.transitionOut.id}
            className={`timeline-transition ${isSelected ? 'selected' : ''}`}
            role="button"
            tabIndex={0}
            title={`${transitionName} ${displayDuration.toFixed(2)}s offset ${displayOffset.toFixed(2)}s`}
            onClick={handleSelect}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                handleSelect(event);
              }
            }}
            style={{
              position: 'absolute',
              left: transitionLeft,
              top: trackTop,
              width: displayedTransitionWidth,
              height: trackHeight,
              pointerEvents: 'auto',
              zIndex: 50,
              cursor: 'pointer',
            }}
          >
            {/* Transition visual */}
            <div
              style={{
                position: 'absolute',
                inset: 4,
                background: isSelected
                  ? 'linear-gradient(90deg, rgba(74, 158, 255, 0.68), rgba(255, 107, 74, 0.62))'
                  : 'linear-gradient(90deg, rgba(74, 158, 255, 0.54), rgba(255, 107, 74, 0.5))',
                borderRadius: 4,
                border: isSelected ? '1px solid rgba(255,255,255,0.86)' : '1px solid rgba(255,255,255,0.38)',
                boxShadow: isSelected
                  ? '0 0 0 1px rgba(59,130,246,0.78), 0 0 14px rgba(59,130,246,0.42)'
                  : '0 0 10px rgba(15,23,42,0.34)',
                opacity: 0.8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: editPreview?.transitionId === clipA.transitionOut.id ? 'grabbing' : 'grab',
              }}
              onPointerDown={(event) => startTransitionMove(event, clipA, clipB)}
            >
              <div
                className="timeline-transition-resize-handle start"
                title="Resize transition start"
                aria-label="Resize transition start"
                onPointerDown={(event) => startTransitionResize(
                  event,
                  'start',
                  clipA,
                  clipB,
                  transitionDefinition?.minDuration ?? 0.05,
                )}
                style={{
                  position: 'absolute',
                  left: -2,
                  top: 3,
                  bottom: 3,
                  width: 8,
                  borderRadius: 2,
                  background: isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
                  cursor: 'ew-resize',
                }}
              />
              <div
                className="timeline-transition-resize-handle end"
                title="Resize transition end"
                aria-label="Resize transition end"
                onPointerDown={(event) => startTransitionResize(
                  event,
                  'end',
                  clipA,
                  clipB,
                  transitionDefinition?.minDuration ?? 0.05,
                )}
                style={{
                  position: 'absolute',
                  right: -2,
                  top: 3,
                  bottom: 3,
                  width: 8,
                  borderRadius: 2,
                  background: isSelected ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
                  cursor: 'ew-resize',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: transitionLabelFontSize,
                  fontWeight: 750,
                  lineHeight: 1,
                  color: 'rgba(255,255,255,0.94)',
                  textAlign: 'center',
                  textShadow: '0 1px 3px rgba(0,0,0,0.78)',
                  pointerEvents: 'none',
                }}
              >
                {transitionName}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
