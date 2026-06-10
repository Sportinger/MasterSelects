import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall, ValidationCheck } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import {
  clipTarget,
  createCustomConfirmation,
  createExecutionAction,
  formatPropertyName,
  readNumber,
  readString,
} from './choreographyShared';

type ClipTransformCheck = Extract<ValidationCheck, { kind: 'clipTransformMatches' }>;
type ClipTransformProperty = ClipTransformCheck['property'];

interface TransformPropertyChange {
  arg: string;
  property: string;
  value: unknown;
  target: GuidedTargetRef;
}

const TRANSFORM_ARG_PROPERTIES: Array<[string, string]> = [
  ['x', 'position.x'],
  ['y', 'position.y'],
  ['z', 'position.z'],
  ['scaleAll', 'scale.all'],
  ['scaleX', 'scale.x'],
  ['scaleY', 'scale.y'],
  ['scaleZ', 'scale.z'],
  ['rotation', 'rotation.z'],
  ['rotationX', 'rotation.x'],
  ['rotationY', 'rotation.y'],
  ['rotationZ', 'rotation.z'],
  ['opacity', 'opacity'],
  ['blendMode', 'blendMode'],
];

const CONFIRMABLE_TRANSFORM_PROPERTIES = new Set<string>([
  'position.x',
  'position.y',
  'position.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
]);

export function compileSetTransform(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'property-edit';
  const clipId = readString(toolCall.args.clipId);
  const changes = getTransformPropertyChanges(toolCall.args, clipId);
  const primaryTarget = changes[0]?.target ?? (clipId ? clipTarget(clipId) : undefined);
  const actions: GuidedAction[] = [];

  if (clipId) {
    actions.push(
      { type: 'selectClip', clipId, family, label: 'Select clip' },
      { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
      { type: 'openPropertiesTab', tab: 'transform', family, label: 'Open Transform' },
      { type: 'resolveTarget', target: { kind: 'propertiesTab', tab: 'transform' }, required: false, family },
    );
  }

  for (const change of changes) {
    actions.push(
      { type: 'resolveTarget', target: change.target, required: false, family },
      { type: 'moveCursorTo', target: change.target, durationMs: 520, optional: true, family, label: `Move to ${change.property}` },
      { type: 'highlightTarget', target: change.target, tone: 'primary', durationMs: 350, family, label: `Highlight ${change.property}` },
      { type: 'clickVisual', target: change.target, optional: true, family, label: `Click ${change.property}` },
    );
  }

  actions.push({
    type: 'callout',
    title: 'Update transform',
    body: changes.length > 0
      ? changes.map((change) => formatPropertyName(change.property)).join(', ')
      : 'Applying transform changes.',
    target: primaryTarget,
    family,
  });
  actions.push(createExecutionAction(toolCall, family));

  if (context.includeValidation && clipId) {
    const confirmations = changes
      .map((change) => createTransformConfirmation(clipId, change))
      .filter((action): action is GuidedAction => action !== null);
    actions.push(...confirmations);
    if (confirmations.length === 0) {
      actions.push(createCustomConfirmation(toolCall, family));
    }
  }

  return actions;
}

function createTransformConfirmation(
  clipId: string,
  change: TransformPropertyChange,
): GuidedAction | null {
  const numericValue = readNumber(change.value);
  if (numericValue === null || !isConfirmableTransformProperty(change.property)) {
    return null;
  }

  return {
    type: 'confirmState',
    check: {
      kind: 'clipTransformMatches',
      clipId,
      property: change.property,
      value: numericValue,
      ...(isToolPixelTransformArg(change.arg) ? { valueSpace: 'toolPixels' as const } : {}),
    },
    family: 'property-edit',
    label: `Confirm ${change.property}`,
  };
}

function getTransformPropertyChanges(
  args: Record<string, unknown>,
  clipId: string | null,
): TransformPropertyChange[] {
  return TRANSFORM_ARG_PROPERTIES.flatMap(([arg, property]) => {
    if (!(arg in args)) {
      return [];
    }
    return [{
      arg,
      property,
      value: args[arg],
      target: {
        kind: 'propertyControl',
        property,
        clipId: clipId ?? undefined,
      },
    }];
  });
}

function isConfirmableTransformProperty(property: string): property is ClipTransformProperty {
  return CONFIRMABLE_TRANSFORM_PROPERTIES.has(property);
}

function isToolPixelTransformArg(arg: string): boolean {
  return arg === 'x' || arg === 'y';
}
