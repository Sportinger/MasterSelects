import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import { createExecutionAction, formatToolName, readNumber, readString } from './choreographyShared';

export function compileEffectEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'property-edit';
  const clipId = readString(toolCall.args.clipId);
  const effectId = readString(toolCall.args.effectId);
  const effectType = readString(toolCall.args.effectType);
  const actions = compilePropertiesStackEdit(toolCall, family, 'effects', 'Edit effect');

  if (context.includeValidation && clipId) {
    actions.push({
      type: 'confirmState',
      check: {
        kind: 'effectExists',
        clipId,
        ...(effectId ? { effectId } : {}),
        ...(effectType ? { effectType } : {}),
      },
      family,
      label: 'Confirm effect change',
    });
  }

  return actions;
}

export function compileKeyframeEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'keyframes';
  const clipId = readString(toolCall.args.clipId);
  const property = readString(toolCall.args.property);
  const time = readNumber(toolCall.args.time);
  const actions = compilePropertiesStackEdit(toolCall, family, 'transform', 'Add keyframe');

  if (property && clipId) {
    const target: GuidedTargetRef = { kind: 'propertyControl', property, clipId };
    actions.splice(actions.length - 1, 0,
      { type: 'resolveTarget', target, required: false, family },
      { type: 'moveCursorTo', target, durationMs: 520, optional: true, family, label: `Move to ${property}` },
      { type: 'highlightTarget', target, tone: 'primary', durationMs: 350, family },
      { type: 'clickVisual', target, optional: true, family, label: `Click ${property}` },
    );
  }

  if (context.includeValidation && clipId) {
    actions.push({
      type: 'confirmState',
      check: {
        kind: 'keyframeExists',
        clipId,
        ...(property ? { property } : {}),
        ...(time !== null ? { time } : {}),
      },
      family,
      label: 'Confirm keyframe',
    });
  }

  return actions;
}

function compilePropertiesStackEdit(
  toolCall: GuidedToolCall,
  family: GuidedActionFamily,
  tab: string,
  title: string,
): GuidedAction[] {
  const clipId = readString(toolCall.args.clipId);
  const tabTarget: GuidedTargetRef = { kind: 'propertiesTab', tab };
  const actions: GuidedAction[] = [];

  if (clipId) {
    actions.push({ type: 'selectClip', clipId, family, label: 'Select clip' });
  }

  actions.push(
    { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
    { type: 'openPropertiesTab', tab, family, label: `Open ${tab}` },
    { type: 'resolveTarget', target: tabTarget, required: false, family },
    { type: 'moveCursorTo', target: tabTarget, durationMs: 420, optional: true, family, label: `Move to ${tab}` },
    { type: 'highlightTarget', target: tabTarget, tone: 'primary', durationMs: 350, family },
    { type: 'clickVisual', target: tabTarget, optional: true, family, label: `Click ${tab}` },
    { type: 'callout', title, body: formatToolName(toolCall.tool), target: tabTarget, family },
    createExecutionAction(toolCall, family),
  );

  return actions;
}
