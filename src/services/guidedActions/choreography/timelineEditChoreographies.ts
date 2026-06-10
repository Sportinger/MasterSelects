import type { GuidedAction, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import { createTimelineReplayOperationFromToolCall } from './aiToolTimelineOperationAdapter';
import { compileBasicTimelineEdit } from './timelineBasicChoreographies';
import { compileTimelineEditReplayToolCall } from './timelineReplayChoreographies';

export function compileTimelineEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const replayOperation = createTimelineReplayOperationFromToolCall(toolCall);
  if (replayOperation) {
    return compileTimelineEditReplayToolCall(toolCall, context, replayOperation);
  }

  return compileBasicTimelineEdit(toolCall, context);
}
