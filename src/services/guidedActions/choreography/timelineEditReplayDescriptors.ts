import type { TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import type { GuidedAction, GuidedTargetRef, GuidedTone } from '../types';

export interface TimelineReplayTarget {
  target: GuidedTargetRef;
  label?: string;
  tone?: GuidedTone;
}

export interface TimelineReplayPoint {
  target: GuidedTargetRef;
  durationMs?: number;
  label?: string;
}

export interface TimelineReplayLabel {
  title: string;
  body?: string;
  target?: GuidedTargetRef;
}

export interface TimelineEditReplayDescriptor {
  operationId: string;
  operationType: TimelineEditOperation['type'];
  toolId: TimelineToolId;
  targets: TimelineReplayTarget[];
  pointerPath?: TimelineReplayPoint[];
  overlayLabels?: TimelineReplayLabel[];
  durationMs?: number;
}

export function createTimelineEditReplayDescriptor(
  operation: TimelineEditOperation,
): TimelineEditReplayDescriptor {
  const toolId = getTimelineReplayToolId(operation);
  const targets = getTimelineReplayTargets(operation);
  const pointerPath = getTimelineReplayPointerPath(operation, targets);
  const overlayLabels = [{
    title: formatOperationTitle(operation),
    body: formatOperationBody(operation),
    target: targets[0]?.target,
  }];

  return {
    operationId: operation.id,
    operationType: operation.type,
    toolId,
    targets,
    ...(pointerPath.length > 0 ? { pointerPath } : {}),
    overlayLabels,
    durationMs: getTimelineReplayDurationMs(operation),
  };
}

export function compileTimelineEditReplayDescriptor(
  descriptor: TimelineEditReplayDescriptor,
): GuidedAction[] {
  const family = 'timeline-edit' as const;
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  for (const target of descriptor.targets) {
    actions.push(
      { type: 'resolveTarget', target: target.target, required: false, optional: true, family, label: target.label },
      { type: 'highlightTarget', target: target.target, tone: target.tone ?? 'primary', durationMs: 280, optional: true, family, label: target.label },
    );
  }

  for (const point of descriptor.pointerPath ?? []) {
    actions.push({
      type: 'moveCursorTo',
      target: point.target,
      durationMs: point.durationMs ?? 320,
      optional: true,
      family,
      label: point.label,
    });
  }

  for (const label of descriptor.overlayLabels ?? []) {
    actions.push({
      type: 'callout',
      title: label.title,
      body: label.body,
      target: label.target,
      family,
      label: label.title,
    });
  }

  actions.push({
    type: 'confirmState',
    check: {
      kind: 'custom',
      id: `timeline-replay:${descriptor.operationType}`,
      label: descriptor.overlayLabels?.[0]?.title ?? descriptor.operationType,
      data: {
        operationId: descriptor.operationId,
        operationType: descriptor.operationType,
        toolId: descriptor.toolId,
      },
    },
    family,
    label: 'Confirm timeline replay',
  });

  return actions;
}

export function getTimelineReplayToolId(operation: TimelineEditOperation): TimelineToolId {
  switch (operation.type) {
    case 'split-at-time':
    case 'split-at-times':
      return 'blade';
    case 'split-all-at-time':
      return 'blade-all-tracks';
    case 'merge-midi-clips':
      return 'glue';
    case 'select-clips-from-time':
      if (operation.trackIds === undefined && operation.direction === 'forward') return 'track-select-forward-all';
      return operation.direction === 'backward' ? 'track-select-backward' : 'track-select-forward';
    case 'ripple-delete-selection':
      return 'ripple-delete';
    case 'delete-gap-at-time':
    case 'delete-all-gaps':
      return 'delete-gap';
    case 'trim-clip':
    case 'trim-edge-to-time':
      return 'edge-trim';
    case 'ripple-trim-edge-to-time':
      return 'ripple-trim';
    case 'rolling-edit':
      return 'rolling-edit';
    case 'slip-clip':
      return 'slip';
    case 'slide-clip':
      return 'slide';
    case 'rate-stretch-clip':
      return 'rate-stretch';
    case 'place-timeline-range':
      return operation.mode;
    case 'lift-range':
      return 'lift-range';
    case 'extract-range':
      return 'extract-range';
    case 'move-clips':
    case 'move-clips-resolved':
      return 'position-overwrite';
    case 'keyframe-transaction-begin':
    case 'keyframe-transaction-update':
    case 'keyframe-transaction-commit':
    case 'keyframe-transaction-cancel':
      return 'pen-keyframe';
    case 'delete-clips':
    case 'fade-transaction-begin':
    case 'fade-transaction-update':
    case 'fade-transaction-commit':
    case 'fade-transaction-cancel':
    case 'keyboard-delete-command':
    case 'keyboard-cycle-blend-mode-command':
    case 'transition-apply':
    case 'transition-remove':
    case 'transition-update-duration':
    case 'transition-update-offset':
    case 'transition-update-type':
    case 'transition-update-params':
    case 'transition-preview-drop':
    case 'transition-clear-preview':
      return 'select';
  }
}

function getTimelineReplayTargets(operation: TimelineEditOperation): TimelineReplayTarget[] {
  const targets: TimelineReplayTarget[] = [];
  const clipId = getPrimaryClipId(operation);
  const trackId = getPrimaryTrackId(operation);
  const time = getPrimaryTimelineTime(operation);

  if (clipId) {
    targets.push({
      target: clipTarget(clipId),
      label: `Clip ${clipId}`,
      tone: getToneForOperation(operation),
    });
  }

  if (operation.type === 'split-at-times') {
    for (const splitTime of operation.times) {
      targets.push({
        target: timelineTimeTarget(splitTime, trackId),
        label: `Time ${formatTime(splitTime)}`,
        tone: getToneForOperation(operation),
      });
    }
    return targets;
  }

  if (typeof time === 'number') {
    targets.push({
      target: timelineTimeTarget(time, trackId),
      label: `Time ${formatTime(time)}`,
      tone: getToneForOperation(operation),
    });
  }

  if (operation.type === 'lift-range' || operation.type === 'extract-range') {
    const range = operation.range;
    if (range) {
      targets.push(
        {
          target: timelineTimeTarget(range.startTime, range.trackIds[0]),
          label: `Range start ${formatTime(range.startTime)}`,
          tone: getToneForOperation(operation),
        },
        {
          target: timelineTimeTarget(range.endTime, range.trackIds[0]),
          label: `Range end ${formatTime(range.endTime)}`,
          tone: getToneForOperation(operation),
        },
      );
    }
  }

  return targets;
}

function getTimelineReplayPointerPath(
  operation: TimelineEditOperation,
  targets: TimelineReplayTarget[],
): TimelineReplayPoint[] {
  if (operation.type === 'split-at-times') {
    const clipId = getPrimaryClipId(operation);
    const trackId = getPrimaryTrackId(operation);
    return [
      ...(clipId ? [{ target: clipTarget(clipId), label: `Clip ${clipId}`, durationMs: 260 }] : []),
      ...operation.times.map((time): TimelineReplayPoint => ({
        target: timelineTimeTarget(time, trackId),
        label: `Cut at ${formatTime(time)}`,
        durationMs: 280,
      })),
    ];
  }

  if (
    operation.type === 'trim-edge-to-time' ||
    operation.type === 'ripple-trim-edge-to-time' ||
    operation.type === 'rolling-edit' ||
    operation.type === 'rate-stretch-clip'
  ) {
    const clipId = getPrimaryClipId(operation);
    const time = getPrimaryTimelineTime(operation);
    if (clipId && typeof time === 'number') {
      return [
        { target: trimHandleTarget(clipId, operation.edge), label: `${operation.edge} edge`, durationMs: 280 },
        { target: timelineTimeTarget(time), label: `Drag to ${formatTime(time)}`, durationMs: 420 },
      ];
    }
  }

  if (operation.type === 'move-clips' || operation.type === 'move-clips-resolved') {
    const firstMove = operation.type === 'move-clips'
      ? operation.moves[0]
      : operation.resolvedMoves[0]
        ? {
          clipId: operation.resolvedMoves[0].clipId,
          startTime: operation.resolvedMoves[0].resolvedStartTime,
          trackId: operation.resolvedMoves[0].resolvedTrackId,
        }
        : undefined;
    if (firstMove) {
      return [
        { target: clipTarget(firstMove.clipId), label: 'Move clip', durationMs: 260 },
        { target: timelineTimeTarget(firstMove.startTime, firstMove.trackId), label: `Drop at ${formatTime(firstMove.startTime)}`, durationMs: 520 },
      ];
    }
  }

  return targets.map((target) => ({
    target: target.target,
    label: target.label,
    durationMs: 300,
  }));
}

function getPrimaryClipId(operation: TimelineEditOperation): string | undefined {
  switch (operation.type) {
    case 'split-at-time':
      return operation.clipIds[0];
    case 'split-at-times':
    case 'trim-clip':
    case 'rolling-edit':
    case 'slip-clip':
    case 'slide-clip':
    case 'rate-stretch-clip':
      return operation.clipId;
    case 'trim-edge-to-time':
    case 'ripple-trim-edge-to-time':
      return operation.clipIds?.[0];
    case 'ripple-delete-selection':
    case 'delete-clips':
    case 'keyboard-delete-command':
      return operation.clipIds?.[0];
    case 'keyboard-cycle-blend-mode-command':
      return operation.anchorClipId;
    case 'transition-apply':
      return operation.clipAId;
    case 'transition-remove':
    case 'transition-update-duration':
      return operation.clipId;
    case 'transition-preview-drop':
      return operation.junction?.clipAId;
    case 'fade-transaction-begin':
    case 'fade-transaction-update':
    case 'fade-transaction-commit':
    case 'fade-transaction-cancel':
    case 'keyframe-transaction-begin':
    case 'keyframe-transaction-update':
    case 'keyframe-transaction-commit':
    case 'keyframe-transaction-cancel':
      return operation.clipId;
    case 'move-clips':
      return operation.moves[0]?.clipId;
    case 'move-clips-resolved':
      return operation.resolvedMoves[0]?.clipId;
    case 'split-all-at-time':
    case 'select-clips-from-time':
    case 'delete-gap-at-time':
    case 'delete-all-gaps':
    case 'place-timeline-range':
    case 'lift-range':
    case 'extract-range':
      return undefined;
  }
}

function getPrimaryTrackId(operation: TimelineEditOperation): string | undefined {
  switch (operation.type) {
    case 'split-at-time':
    case 'split-at-times':
      return operation.scope?.trackIds?.[0];
    case 'split-all-at-time':
    case 'select-clips-from-time':
    case 'delete-gap-at-time':
    case 'delete-all-gaps':
      return operation.trackIds?.[0];
    case 'place-timeline-range':
      return operation.trackIds?.[0];
    case 'lift-range':
    case 'extract-range':
      return operation.range?.trackIds[0];
    case 'move-clips':
      return operation.moves[0]?.trackId;
    case 'move-clips-resolved':
      return operation.resolvedMoves[0]?.resolvedTrackId;
    case 'transition-apply':
      return operation.junction.trackId;
    case 'transition-update-duration':
      return operation.junction?.trackId;
    case 'transition-preview-drop':
      return operation.junction?.trackId;
    default:
      return undefined;
  }
}

function getPrimaryTimelineTime(operation: TimelineEditOperation): number | undefined {
  switch (operation.type) {
    case 'split-at-time':
    case 'split-all-at-time':
    case 'select-clips-from-time':
    case 'delete-gap-at-time':
    case 'trim-edge-to-time':
    case 'ripple-trim-edge-to-time':
    case 'rolling-edit':
    case 'rate-stretch-clip':
      return operation.time;
    case 'split-at-times':
      return operation.times[0];
    case 'trim-clip':
      return operation.startTime;
    case 'place-timeline-range':
      return operation.startTime;
    case 'move-clips':
      return operation.moves[0]?.startTime;
    case 'move-clips-resolved':
      return operation.resolvedMoves[0]?.resolvedStartTime;
    case 'lift-range':
    case 'extract-range':
      return operation.range?.startTime;
    case 'ripple-delete-selection':
    case 'delete-clips':
    case 'keyboard-delete-command':
    case 'delete-all-gaps':
    case 'fade-transaction-begin':
    case 'fade-transaction-update':
    case 'fade-transaction-commit':
    case 'fade-transaction-cancel':
    case 'keyframe-transaction-begin':
    case 'keyframe-transaction-update':
    case 'keyframe-transaction-commit':
    case 'keyframe-transaction-cancel':
    case 'slip-clip':
    case 'slide-clip':
    case 'keyboard-cycle-blend-mode-command':
    case 'transition-remove':
    case 'transition-clear-preview':
      return undefined;
    case 'transition-apply':
      return operation.junction.junctionTime;
    case 'transition-update-duration':
      return operation.junction?.junctionTime;
    case 'transition-preview-drop':
      return operation.junction?.junctionTime;
  }
}

function getTimelineReplayDurationMs(operation: TimelineEditOperation): number {
  if (operation.type === 'move-clips' || operation.type === 'move-clips-resolved' || operation.type === 'place-timeline-range') return 1100;
  if (operation.type === 'split-at-times' && operation.times.length > 1) return 1200;
  return 900;
}

function getToneForOperation(operation: TimelineEditOperation): GuidedTone {
  switch (operation.type) {
    case 'delete-clips':
    case 'ripple-delete-selection':
    case 'delete-gap-at-time':
    case 'delete-all-gaps':
    case 'keyboard-delete-command':
    case 'lift-range':
    case 'extract-range':
      return 'danger';
    case 'place-timeline-range':
    case 'move-clips':
    case 'move-clips-resolved':
    case 'transition-apply':
    case 'transition-update-duration':
      return 'success';
    default:
      return 'primary';
  }
}

function formatOperationTitle(operation: TimelineEditOperation): string {
  if (operation.type === 'transition-apply') return 'Apply Transition';
  if (operation.type === 'transition-remove') return 'Remove Transition';
  if (operation.type === 'transition-update-duration') return 'Update Transition';
  if (operation.type === 'transition-preview-drop') return 'Preview Transition Drop';
  if (operation.type === 'transition-clear-preview') return 'Clear Transition Preview';
  if (operation.type === 'fade-transaction-begin') return 'Begin Fade';
  if (operation.type === 'fade-transaction-update') return 'Update Fade';
  if (operation.type === 'fade-transaction-commit') return 'Commit Fade';
  if (operation.type === 'fade-transaction-cancel') return 'Cancel Fade';
  if (operation.type === 'keyframe-transaction-begin') return 'Begin Keyframe Edit';
  if (operation.type === 'keyframe-transaction-update') return 'Update Keyframes';
  if (operation.type === 'keyframe-transaction-commit') return 'Commit Keyframes';
  if (operation.type === 'keyframe-transaction-cancel') return 'Cancel Keyframe Edit';
  return getTimelineReplayToolId(operation)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatOperationBody(operation: TimelineEditOperation): string {
  switch (operation.type) {
    case 'split-at-time':
    case 'split-all-at-time':
      return `Cut at ${formatTime(operation.time)}.`;
    case 'split-at-times':
      return `Cut ${operation.times.length} time${operation.times.length === 1 ? '' : 's'}.`;
    case 'select-clips-from-time':
      return `Select ${operation.direction} from ${formatTime(operation.time)}.`;
    case 'delete-all-gaps':
      if (operation.startTime !== undefined) {
        return operation.trackIds?.length
          ? `Close gaps from ${formatTime(operation.startTime)} on ${operation.trackIds.length} track${operation.trackIds.length === 1 ? '' : 's'}.`
          : `Close timeline gaps from ${formatTime(operation.startTime)}.`;
      }
      return operation.trackIds?.length
        ? `Close all gaps on ${operation.trackIds.length} track${operation.trackIds.length === 1 ? '' : 's'}.`
        : 'Close all timeline gaps.';
    case 'place-timeline-range':
      return operation.startTime !== undefined
        ? `Place source at ${formatTime(operation.startTime)}.`
        : 'Place source in the timeline.';
    case 'move-clips':
      return `${operation.moves.length} clip move${operation.moves.length === 1 ? '' : 's'}.`;
    case 'move-clips-resolved':
      return `${operation.resolvedMoves.length} resolved clip move${operation.resolvedMoves.length === 1 ? '' : 's'}.`;
    case 'slip-clip':
      return `Slip source by ${formatSignedSeconds(operation.sourceDelta)}.`;
    case 'slide-clip':
      return `Slide by ${formatSignedSeconds(operation.timelineDelta)}.`;
    case 'keyboard-delete-command':
      return operation.keyframeIds.length > 0
        ? `Delete ${operation.keyframeIds.length} keyframe${operation.keyframeIds.length === 1 ? '' : 's'}.`
        : `Delete ${operation.clipIds.length} clip${operation.clipIds.length === 1 ? '' : 's'}.`;
    case 'keyboard-cycle-blend-mode-command':
      return `Set ${operation.clipIds.length} clip${operation.clipIds.length === 1 ? '' : 's'} to ${operation.nextBlendMode}.`;
    case 'transition-apply':
      return `Apply ${operation.transitionType} for ${formatTime(operation.requestedDuration)}.`;
    case 'transition-remove':
      return `Remove ${operation.edge} transition.`;
    case 'transition-update-duration':
      return `Set ${operation.edge} transition to ${formatTime(operation.requestedDuration)}.`;
    case 'transition-preview-drop':
      return operation.junction
        ? `Preview ${operation.transitionType} for ${formatTime(operation.requestedDuration)}.`
        : `Preview blocked ${operation.transitionType} drop.`;
    case 'transition-clear-preview':
      return `Clear transition preview after ${operation.reason}.`;
    case 'fade-transaction-begin':
      return `Begin ${operation.edge} fade from ${formatTime(operation.originalFadeDuration)}.`;
    case 'fade-transaction-update':
      return `Preview ${operation.edge} fade at ${formatTime(operation.resolvedFadeDuration)}.`;
    case 'fade-transaction-commit':
      return `Set ${operation.edge} fade to ${formatTime(operation.finalFadeDuration)}.`;
    case 'fade-transaction-cancel':
      return `Cancel ${operation.edge} fade edit.`;
    case 'keyframe-transaction-begin':
      return `Begin keyframe edit for ${operation.keyframeIds.length} keyframe${operation.keyframeIds.length === 1 ? '' : 's'}.`;
    case 'keyframe-transaction-update':
      return `Preview ${operation.operations.length} keyframe operation${operation.operations.length === 1 ? '' : 's'}.`;
    case 'keyframe-transaction-commit':
      return `Commit ${operation.operations.length} keyframe operation${operation.operations.length === 1 ? '' : 's'}.`;
    case 'keyframe-transaction-cancel':
      return `Cancel keyframe edit and discard ${operation.discardKeyframeIds.length} keyframe${operation.discardKeyframeIds.length === 1 ? '' : 's'}.`;
    default:
      return `Replay ${operation.type}.`;
  }
}

function clipTarget(clipId: string): GuidedTargetRef {
  return { kind: 'timelineClip', clipId };
}

function trimHandleTarget(clipId: string, edge: 'start' | 'end'): GuidedTargetRef {
  return { kind: 'timelineTrimHandle', clipId, edge };
}

function timelineTimeTarget(time: number, trackId?: string): GuidedTargetRef {
  return {
    kind: 'timelineTime',
    time,
    ...(trackId ? { trackId } : {}),
  };
}

function formatTime(time: number): string {
  return `${time.toFixed(Math.abs(time) < 10 ? 2 : 1)}s`;
}

function formatSignedSeconds(seconds: number): string {
  const prefix = seconds >= 0 ? '+' : '';
  return `${prefix}${formatTime(seconds)}`;
}
