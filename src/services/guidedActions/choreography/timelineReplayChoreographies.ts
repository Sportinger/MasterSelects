import type { TimelineToolGroupId } from '../../../stores/timeline/types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import { createTimelineEditReplayDescriptor } from './timelineEditReplayDescriptors';
import {
  createCustomConfirmation,
  createExecutionAction,
  describeTimelineEdit,
  formatMaybeNumber,
  formatToolName,
  timelineTimeTarget,
} from './choreographyShared';

export function compileTimelineEditReplayToolCall(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
  operation: TimelineEditOperation,
): GuidedAction[] {
  const family: GuidedActionFamily = 'timeline-edit';
  const descriptor = createTimelineEditReplayDescriptor(operation);
  if (operation.type === 'split-at-times') {
    return compileMultiSplitTimelineReplay(toolCall, context, operation, descriptor);
  }

  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];
  const toolTarget = getTimelineToolButtonTarget(descriptor.toolId);
  const shouldShowBladeClicks = descriptor.toolId === 'blade' || descriptor.toolId === 'blade-all-tracks';

  if (toolTarget) {
    actions.push(
      { type: 'moveCursorTo', target: toolTarget, durationMs: 320, optional: true, family, label: `Move to ${descriptor.toolId}` },
      {
        target: toolTarget,
        type: 'clickVisual',
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: 'Select category',
        optional: true,
        family,
        label: 'Select tool category',
      },
      {
        target: toolTarget,
        type: 'clickVisual',
        button: 'right',
        gestureLabel: 'RMB',
        gestureDetail: 'Open tools',
        optional: true,
        family,
        label: 'Right-click tool group',
      },
      {
        type: 'openTimelineToolGroupVisual',
        groupId: getTimelineToolGroupId(descriptor.toolId) ?? 'cut',
        targetToolId: descriptor.toolId,
        target: toolTarget,
        optional: true,
        family,
        label: 'Open tool menu',
      },
      { type: 'moveCursorTo', target: getTimelineToolItemTarget(descriptor.toolId), durationMs: 260, optional: true, family, label: `Move to ${descriptor.toolId}` },
      {
        type: 'clickVisual',
        target: getTimelineToolItemTarget(descriptor.toolId),
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: `Select ${descriptor.toolId}`,
        optional: true,
        family,
        label: `Select ${descriptor.toolId}`,
      },
      { type: 'setTimelineToolVisual', toolId: descriptor.toolId, family, label: `Set ${descriptor.toolId}` },
    );
  }

  for (const point of descriptor.pointerPath ?? []) {
    if (point.target.kind === 'timelineTime') {
      actions.push(
        { type: 'scrollIntoView', target: point.target, block: 'center', optional: true, family, label: point.label },
        { type: 'setPlayheadVisual', time: point.target.time, family, label: point.label ?? `Move playhead to ${point.target.time}s` },
        { type: 'moveCursorTo', target: point.target, durationMs: point.durationMs ?? 300, optional: true, family, label: point.label },
      );
      if (shouldShowBladeClicks) {
        actions.push({
          type: 'clickVisual',
          target: point.target,
          button: 'left',
          gestureLabel: 'LMB',
          gestureDetail: 'Cut',
          optional: true,
          family,
          label: point.label ?? 'Cut',
        });
      }
      continue;
    }

    actions.push({
      type: 'moveCursorTo',
      target: point.target,
      durationMs: point.durationMs ?? 300,
      optional: true,
      family,
      label: point.label,
    });
  }

  actions.push({
    type: 'callout',
    title: formatToolName(toolCall.tool),
    body: describeTimelineEdit(toolCall),
    target: descriptor.targets[0]?.target,
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  if (toolTarget && shouldShowBladeClicks) {
    const selectToolTarget = getTimelineToolButtonTarget('select');
    const selectToolItemTarget = getTimelineToolItemTarget('select');
    const returnTarget = getReplayReturnTarget(descriptor);
    actions.push(
      { type: 'moveCursorTo', target: selectToolTarget, durationMs: 320, optional: true, family, label: 'Move to selection tool' },
      {
        type: 'clickVisual',
        target: selectToolTarget,
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: 'Select category',
        optional: true,
        family,
        label: 'Select selection category',
      },
      {
        type: 'clickVisual',
        target: selectToolTarget,
        button: 'right',
        gestureLabel: 'RMB',
        gestureDetail: 'Open tools',
        optional: true,
        family,
        label: 'Right-click selection tools',
      },
      {
        type: 'openTimelineToolGroupVisual',
        groupId: 'selection',
        targetToolId: 'select',
        target: selectToolTarget,
        optional: true,
        family,
        label: 'Open selection menu',
      },
      { type: 'moveCursorTo', target: selectToolItemTarget, durationMs: 260, optional: true, family, label: 'Move to Selection Tool' },
      {
        type: 'clickVisual',
        target: selectToolItemTarget,
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: 'Select tool',
        optional: true,
        family,
        label: 'Switch to select tool',
      },
      { type: 'setTimelineToolVisual', toolId: 'select', family, label: 'Set select tool' },
    );
    if (returnTarget) {
      actions.push({
        type: 'moveCursorTo',
        target: returnTarget,
        durationMs: 360,
        optional: true,
        family,
        label: 'Return to timeline',
      });
    }
  }

  return actions;
}

function compileMultiSplitTimelineReplay(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
  operation: Extract<TimelineEditOperation, { type: 'split-at-times' }>,
  descriptor: ReturnType<typeof createTimelineEditReplayDescriptor>,
): GuidedAction[] {
  const family: GuidedActionFamily = 'timeline-edit';
  const trackId = operation.scope?.trackIds?.[0];
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];
  const cutGroupTarget = getTimelineToolButtonTarget('blade');
  const bladeItemTarget = getTimelineToolItemTarget('blade');
  actions.push(
    { type: 'moveCursorTo', target: cutGroupTarget, durationMs: 320, optional: true, family, label: 'Move to blade tools' },
    {
      target: cutGroupTarget,
      type: 'clickVisual',
      button: 'left',
      gestureLabel: 'LMB',
      gestureDetail: 'Select category',
      optional: true,
      family,
      label: 'Select cut category',
    },
    {
      target: cutGroupTarget,
      type: 'clickVisual',
      button: 'right',
      gestureLabel: 'RMB',
      gestureDetail: 'Open tools',
      optional: true,
      family,
      label: 'Right-click blade tools',
    },
    {
      type: 'openTimelineToolGroupVisual',
      groupId: 'cut',
      targetToolId: 'blade',
      target: cutGroupTarget,
      optional: true,
      family,
      label: 'Open blade menu',
    },
    { type: 'moveCursorTo', target: bladeItemTarget, durationMs: 260, optional: true, family, label: 'Move to Blade / Razor' },
    {
      type: 'clickVisual',
      target: bladeItemTarget,
      button: 'left',
      gestureLabel: 'LMB',
      gestureDetail: 'Select Blade',
      optional: true,
      family,
      label: 'Select Blade',
    },
    { type: 'setTimelineToolVisual', toolId: 'blade', family, label: 'Set blade tool' },
  );

  const clipPoint = descriptor.pointerPath?.find((point) => point.target.kind === 'timelineClip');
  if (clipPoint) {
    actions.push({
      type: 'moveCursorTo',
      target: clipPoint.target,
      durationMs: clipPoint.durationMs ?? 260,
      optional: true,
      family,
      label: clipPoint.label,
    });
  }

  let timelineReturnTarget: GuidedTargetRef | null = null;
  for (const time of operation.times) {
    const target = timelineTimeTarget(time, trackId);
    timelineReturnTarget = target;
    actions.push(
      { type: 'scrollIntoView', target, block: 'center', optional: true, family, label: `Reveal ${formatMaybeNumber(time)}` },
      { type: 'setPlayheadVisual', time, family, label: `Move playhead to ${formatMaybeNumber(time)}` },
      { type: 'moveCursorTo', target, durationMs: 280, optional: true, family, label: `Move to cut ${formatMaybeNumber(time)}` },
      {
        type: 'clickVisual',
        target,
        button: 'left',
        gestureLabel: 'LMB',
        gestureDetail: 'Cut',
        optional: true,
        family,
        label: `Cut ${formatMaybeNumber(time)}`,
      },
      createExecutionAction({
        id: `${toolCall.id ?? toolCall.tool}:split:${time}`,
        tool: 'splitClip',
        args: {
          clipId: operation.clipId,
          splitTime: time,
          withLinked: operation.includeLinked,
          guidedResolveClipAtTimeTrackId: trackId,
        },
      }, family),
    );
  }

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  const selectToolTarget = getTimelineToolButtonTarget('select');
  const selectToolItemTarget = getTimelineToolItemTarget('select');
  actions.push(
    { type: 'moveCursorTo', target: selectToolTarget, durationMs: 320, optional: true, family, label: 'Move to selection tool' },
    {
      type: 'clickVisual',
      target: selectToolTarget,
      button: 'left',
      gestureLabel: 'LMB',
      gestureDetail: 'Select category',
      optional: true,
      family,
      label: 'Select selection category',
    },
    {
      type: 'clickVisual',
      target: selectToolTarget,
      button: 'right',
      gestureLabel: 'RMB',
      gestureDetail: 'Open tools',
      optional: true,
      family,
      label: 'Right-click selection tools',
    },
    {
      type: 'openTimelineToolGroupVisual',
      groupId: 'selection',
      targetToolId: 'select',
      target: selectToolTarget,
      optional: true,
      family,
      label: 'Open selection menu',
    },
    { type: 'moveCursorTo', target: selectToolItemTarget, durationMs: 260, optional: true, family, label: 'Move to Selection Tool' },
    {
      type: 'clickVisual',
      target: selectToolItemTarget,
      button: 'left',
      gestureLabel: 'LMB',
      gestureDetail: 'Select tool',
      optional: true,
      family,
      label: 'Switch to select tool',
    },
    { type: 'setTimelineToolVisual', toolId: 'select', family, label: 'Set select tool' },
  );
  if (timelineReturnTarget) {
    actions.push({
      type: 'moveCursorTo',
      target: timelineReturnTarget,
      durationMs: 360,
      optional: true,
      family,
      label: 'Return to timeline',
    });
  }

  return actions;
}


function getReplayReturnTarget(
  descriptor: ReturnType<typeof createTimelineEditReplayDescriptor>,
): GuidedTargetRef | null {
  const pointerPath = descriptor.pointerPath ?? [];
  for (let index = pointerPath.length - 1; index >= 0; index -= 1) {
    const target = pointerPath[index]?.target;
    if (target?.kind === 'timelineTime') {
      return target;
    }
  }

  if (pointerPath.length > 0) {
    return pointerPath[pointerPath.length - 1]?.target ?? null;
  }

  return descriptor.targets[0]?.target ?? null;
}

function getTimelineToolButtonTarget(toolId: string): GuidedTargetRef {
  const groupId = getTimelineToolGroupId(toolId);
  return {
    kind: 'button',
    id: groupId ? `timeline-tool-group:${groupId}` : `timeline-tool:${toolId}`,
  };
}

function getTimelineToolItemTarget(toolId: string): GuidedTargetRef {
  return { kind: 'button', id: `timeline-tool:${toolId}` };
}

function getTimelineToolGroupId(toolId: string): TimelineToolGroupId | null {
  if (toolId === 'select') return 'selection';
  if (toolId === 'blade' || toolId === 'blade-all-tracks') return 'cut';
  return null;
}
