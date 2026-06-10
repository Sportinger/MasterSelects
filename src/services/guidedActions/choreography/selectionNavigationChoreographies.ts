import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import {
  clipTarget,
  createCustomConfirmation,
  createExecutionAction,
  readNumber,
  readStringArray,
} from './choreographyShared';

export function compileSelectClips(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'selection-navigation';
  const clipIds = readStringArray(toolCall.args.clipIds);
  const primaryClipId = clipIds[0];
  const primaryTarget = primaryClipId ? clipTarget(primaryClipId) : undefined;
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (primaryTarget) {
    actions.push(
      { type: 'resolveTarget', target: primaryTarget, required: false, family },
      { type: 'moveCursorTo', target: primaryTarget, durationMs: 420, optional: true, family, label: 'Move to clip' },
      { type: 'clickVisual', target: primaryTarget, optional: true, family, label: 'Click clip' },
      { type: 'highlightTarget', target: primaryTarget, tone: 'primary', durationMs: 350, family },
      { type: 'callout', title: 'Select clips', body: `${clipIds.length} clip${clipIds.length === 1 ? '' : 's'}`, target: primaryTarget, family },
    );
  } else {
    actions.push({ type: 'callout', title: 'Select clips', body: 'Updating the current selection.', family });
  }

  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(...clipIds.map((clipId): GuidedAction => ({
      type: 'confirmState',
      check: { kind: 'clipSelected', clipId },
      family,
      label: `Confirm ${clipId} selected`,
    })));
  }

  return actions;
}

export function compileSetPlayhead(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'selection-navigation';
  const time = readNumber(toolCall.args.time);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
  ];

  if (time !== null) {
    const timeTarget: GuidedTargetRef = { kind: 'timelineTime', time };
    actions.push(
      { type: 'setPlayheadVisual', time, family, label: `Move playhead to ${time}s` },
      { type: 'scrollIntoView', target: timeTarget, block: 'center', family, label: `Reveal ${time}s` },
      { type: 'moveCursorTo', target: timeTarget, durationMs: 500, family, label: `Point at ${time}s` },
      { type: 'highlightTarget', target: timeTarget, tone: 'primary', durationMs: 350, family },
      { type: 'callout', title: 'Move playhead', body: `Set timeline position to ${time}s.`, target: timeTarget, family },
    );
  } else {
    actions.push({ type: 'callout', title: 'Move playhead', body: 'Updating the timeline position.', family });
  }

  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation) {
    actions.push(time !== null
      ? {
        type: 'confirmState',
        check: { kind: 'playheadAtTime', time, toleranceSeconds: 0.001 },
        family,
        label: 'Confirm playhead position',
      }
      : createCustomConfirmation(toolCall, family));
  }

  return actions;
}
