import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import { createCustomConfirmation, createExecutionAction, formatToolName } from './choreographyShared';

export function compilePreviewAction(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'playback-debug';
  const previewTarget: GuidedTargetRef = { kind: 'panel', panel: 'preview' };
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'preview', family, label: 'Open Preview' },
    { type: 'resolveTarget', target: previewTarget, required: false, family },
    { type: 'spotlight', target: previewTarget, family, label: 'Spotlight Preview' },
    { type: 'callout', title: formatToolName(toolCall.tool), body: 'Capturing the current preview frame.', target: previewTarget, family },
    createExecutionAction(toolCall, family),
  ];

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}
