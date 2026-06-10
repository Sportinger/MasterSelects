import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';

export function createDefaultToolChoreography(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family = inferFallbackFamily(toolCall.tool);
  const actions: GuidedAction[] = [
    {
      type: 'callout',
      title: `Executing ${formatToolName(toolCall.tool)}`,
      body: 'Applying the requested edit.',
      family,
      label: `Execute ${toolCall.tool}`,
    },
    createExecutionAction(toolCall, family),
  ];

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

export function normalizeBatchToolCalls(actions: unknown): GuidedToolCall[] {
  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.flatMap((action, index) => {
    if (!isRecord(action) || typeof action.tool !== 'string') {
      return [];
    }

    const tool = action.tool;
    const args = isRecord(action.args)
      ? action.args
      : objectWithout(action, ['tool', 'args']);

    return [{
      id: typeof action.id === 'string' ? action.id : `batch-${index}-${tool}`,
      tool,
      args,
    }];
  });
}

export function stripExecutionActions(actions: GuidedAction[]): GuidedAction[] {
  return actions.filter((action) => (
    action.type !== 'executeTool'
    && action.type !== 'drawMaskPath'
    && action.type !== 'confirmState'
    && action.type !== 'waitForUserAction'
  ));
}

export function createExecutionAction(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
  return {
    type: 'executeTool',
    tool: toolCall.tool,
    args: toolCall.args,
    family,
    label: `Execute ${toolCall.tool}`,
  };
}

export function createCustomConfirmation(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
  return {
    type: 'confirmState',
    check: {
      kind: 'custom',
      id: `guided-tool:${toolCall.tool}`,
      label: `Confirm ${toolCall.tool}`,
      data: {
        tool: toolCall.tool,
        args: toolCall.args,
      },
    },
    family,
    label: `Confirm ${toolCall.tool}`,
  };
}

export function inferFallbackFamily(tool: string): GuidedActionFamily {
  if (tool.toLowerCase().includes('media') || tool === 'importLocalFiles') {
    return 'media';
  }
  if (tool.toLowerCase().includes('mask')) {
    return 'mask-edit';
  }
  if (tool.toLowerCase().includes('keyframe')) {
    return 'keyframes';
  }
  if (tool.toLowerCase().includes('clip') || tool.toLowerCase().includes('timeline')) {
    return 'timeline-edit';
  }
  return 'semantic';
}

export function clipTarget(clipId: string): GuidedTargetRef {
  return { kind: 'timelineClip', clipId };
}

export function mediaItemTarget(itemId: string): GuidedTargetRef {
  return { kind: 'mediaItem', itemId };
}

export function timelineTimeTarget(time: number, trackId?: string): GuidedTargetRef {
  return {
    kind: 'timelineTime',
    ...(trackId ? { trackId } : {}),
    time,
  };
}

export function formatToolName(tool: string): string {
  return tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatPropertyName(property: string): string {
  return property.replace(/./g, ' ');
}

export function formatMaybeNumber(value: number | null): string {
  return value === null ? 'target time' : `${value}s`;
}

export function describeTimelineEdit(toolCall: GuidedToolCall): string {
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

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

export function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectWithout(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const ignored = new Set(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignored.has(key)),
  );
}
