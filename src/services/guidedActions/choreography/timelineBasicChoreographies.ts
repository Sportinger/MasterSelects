import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import {
  clipTarget,
  createCustomConfirmation,
  createExecutionAction,
  formatMaybeNumber,
  formatToolName,
  readNumber,
  readNumberArray,
  readString,
  readStringArray,
} from './choreographyShared';

export function compileBasicTimelineEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'timeline-edit';
  const clipIds = getTimelineClipIds(toolCall);
  const primaryClipId = clipIds[0];
  const primaryTarget = primaryClipId ? clipTarget(primaryClipId) : undefined;
  const splitTime = getTimelineTime(toolCall);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (primaryTarget) {
    actions.push(
      { type: 'resolveTarget', target: primaryTarget, required: false, family },
      { type: 'highlightTarget', target: primaryTarget, tone: getTimelineTone(toolCall.tool), durationMs: 420, family },
    );
  }

  if (typeof splitTime === 'number') {
    const timeTarget: GuidedTargetRef = { kind: 'timelineTime', time: splitTime };
    actions.push(
      { type: 'setPlayheadVisual', time: splitTime, family, label: `Move playhead to ${splitTime}s` },
      { type: 'scrollIntoView', target: timeTarget, block: 'center', family, label: `Reveal ${splitTime}s` },
      { type: 'moveCursorTo', target: timeTarget, durationMs: 260, family, label: `Point at ${splitTime}s` },
      { type: 'highlightTarget', target: timeTarget, tone: getTimelineTone(toolCall.tool), durationMs: 260, family },
    );
  }

  actions.push({
    type: 'callout',
    title: formatToolName(toolCall.tool),
    body: describeTimelineEdit(toolCall),
    target: primaryTarget,
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function getTimelineClipIds(toolCall: GuidedToolCall): string[] {
  const direct = readString(toolCall.args.clipId);
  if (direct) {
    return [direct];
  }
  return readStringArray(toolCall.args.clipIds);
}

function getTimelineTime(toolCall: GuidedToolCall): number | null {
  return readNumber(toolCall.args.splitTime)
    ?? readNumber(toolCall.args.newStartTime)
    ?? readNumber(toolCall.args.timelineStart)
    ?? null;
}

function getTimelineTone(tool: string): 'primary' | 'warning' | 'danger' {
  if (tool === 'deleteClip' || tool === 'deleteClips') {
    return 'danger';
  }
  if (tool === 'trimClip') {
    return 'warning';
  }
  return 'primary';
}

function describeTimelineEdit(toolCall: GuidedToolCall): string {
  switch (toolCall.tool) {
    case 'splitClip':
      return `Split at ${formatMaybeNumber(readNumber(toolCall.args.splitTime))}.`;
    case 'splitClipEvenly':
      return `Split into ${formatMaybeNumber(readNumber(toolCall.args.parts))} parts.`;
    case 'splitClipAtTimes':
      return `Split at ${readNumberArray(toolCall.args.times).length} timeline times.`;
    case 'moveClip':
      return `Move to ${formatMaybeNumber(readNumber(toolCall.args.newStartTime))}.`;
    case 'trimClip':
      return 'Adjust clip in/out points.';
    case 'deleteClip':
    case 'deleteClips':
      return 'Remove selected timeline media.';
    default:
      return 'Apply timeline edit.';
  }
}
