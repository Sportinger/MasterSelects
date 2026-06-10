import type {
  GuidedAction,
  GuidedActionFamily,
  GuidedMaskCreateOptions,
  GuidedMaskPathVertexInput,
  GuidedTargetRef,
  GuidedToolCall,
} from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import { createExecutionAction, formatToolName, isRecord, readNumber, readString } from './choreographyShared';

export function compileMaskEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'mask-edit';
  const clipId = readString(toolCall.args.clipId);
  const toolbarTarget = getMaskToolbarTarget(toolCall.tool);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'clip-properties', family, label: 'Open Properties' },
    { type: 'openPropertiesTab', tab: 'masks', family, label: 'Open Masks' },
    { type: 'resolveTarget', target: { kind: 'propertiesTab', tab: 'masks' }, required: false, family },
  ];

  if (clipId) {
    actions.unshift({ type: 'selectClip', clipId, family, label: 'Select clip' });
  }

  if (toolbarTarget) {
    actions.push(
      { type: 'resolveTarget', target: toolbarTarget, required: false, family },
      { type: 'moveCursorTo', target: toolbarTarget, durationMs: 520, optional: true, family, label: `Move to ${toolCall.tool}` },
      { type: 'highlightTarget', target: toolbarTarget, tone: 'primary', durationMs: 350, family },
      { type: 'clickVisual', target: toolbarTarget, optional: true, family, label: `Click ${toolCall.tool}` },
    );
  }

  const path = getMaskPathForToolCall(toolCall);
  const shouldCommitIncrementally = toolCall.tool === 'addMask'
    && Boolean(clipId)
    && path.length > 0
    && context.includeValidation;
  if (path.length > 0) {
    actions.push({ type: 'focusPanel', panel: 'preview', family, label: 'Open Preview' });
    if (shouldCommitIncrementally && clipId) {
      actions.push({
        type: 'drawMaskPath',
        clipId,
        vertices: getMaskVerticesForToolCall(toolCall),
        close: getMaskPathClosedForToolCall(toolCall),
        mask: getMaskCreateOptions(toolCall.args),
        policy: 'semanticTool',
        family,
        label: 'Draw mask path',
      });
    } else {
      actions.push({ type: 'drawPreviewPath', points: path, close: getMaskPathClosedForToolCall(toolCall), family, label: 'Preview mask path' });
    }
  }

  actions.push({
    type: 'callout',
    title: formatToolName(toolCall.tool),
    body: clipId ? `Editing masks on ${clipId}.` : 'Editing masks.',
    target: toolbarTarget ?? { kind: 'propertiesTab', tab: 'masks' },
    family,
  });
  if (!shouldCommitIncrementally) {
    actions.push(createExecutionAction(toolCall, family));
  }

  if (context.includeValidation && clipId) {
    if (toolCall.tool === 'addMaskPathKeyframe') {
      const maskId = readString(toolCall.args.maskId);
      const time = readNumber(toolCall.args.time);
      actions.push({
        type: 'confirmState',
        check: {
          kind: 'keyframeExists',
          clipId,
          ...(maskId ? { property: `mask.${maskId}.path` } : {}),
          ...(time !== null ? { time } : {}),
        },
        family,
        label: 'Confirm mask path keyframe',
      });
      return actions;
    }

    actions.push({
      type: 'confirmState',
      check: toolCall.tool === 'updateMask' && readString(toolCall.args.maskId)
        ? { kind: 'activeMask', clipId, maskId: readString(toolCall.args.maskId)! }
        : { kind: 'maskExists', clipId },
      family,
      label: 'Confirm mask change',
    });
  }

  return actions;
}

function getMaskToolbarTarget(tool: string): GuidedTargetRef | null {
  switch (tool) {
    case 'addRectangleMask':
      return { kind: 'maskToolbarButton', button: 'rectangle' };
    case 'addEllipseMask':
      return { kind: 'maskToolbarButton', button: 'ellipse' };
    case 'addMask':
      return { kind: 'maskToolbarButton', button: 'pen' };
    case 'updateMask':
      return { kind: 'maskToolbarButton', button: 'edit' };
    default:
      return null;
  }
}

function getMaskPathForToolCall(toolCall: GuidedToolCall): Array<{ x: number; y: number }> {
  if (toolCall.tool === 'addMaskPathKeyframe' && isRecord(toolCall.args.pathValue)) {
    return getMaskPath(toolCall.args.pathValue.vertices);
  }
  return getMaskPath(toolCall.args.vertices);
}

function getMaskVerticesForToolCall(toolCall: GuidedToolCall): GuidedMaskPathVertexInput[] {
  return getMaskVertices(toolCall.args.vertices);
}

function getMaskPathClosedForToolCall(toolCall: GuidedToolCall): boolean {
  if (toolCall.tool === 'addMaskPathKeyframe' && isRecord(toolCall.args.pathValue)) {
    return toolCall.args.pathValue.closed !== false;
  }
  return toolCall.args.closed !== false;
}

function getMaskCreateOptions(args: Record<string, unknown>): GuidedMaskCreateOptions {
  const options: GuidedMaskCreateOptions = {};
  if (typeof args.enabled === 'boolean') options.enabled = args.enabled;
  if (typeof args.feather === 'number') options.feather = args.feather;
  if (typeof args.inverted === 'boolean') options.inverted = args.inverted;
  if (args.mode === 'add' || args.mode === 'subtract' || args.mode === 'intersect') options.mode = args.mode;
  if (typeof args.name === 'string') options.name = args.name;
  if (typeof args.opacity === 'number') options.opacity = args.opacity;
  if (typeof args.visible === 'boolean') options.visible = args.visible;
  return options;
}

function getMaskPath(vertices: unknown): Array<{ x: number; y: number }> {
  return getMaskVertices(vertices).map((vertex) => ({ x: vertex.x, y: vertex.y }));
}

function getMaskVertices(vertices: unknown): GuidedMaskPathVertexInput[] {
  if (!Array.isArray(vertices)) {
    return [];
  }

  return vertices.flatMap((vertex) => {
    if (!isRecord(vertex)) {
      return [];
    }
    const x = readNumber(vertex.x);
    const y = readNumber(vertex.y);
    if (x === null || y === null) {
      return [];
    }
    return [{
      x,
      y,
      ...readPointRecord(vertex.handleIn, 'handleIn'),
      ...readPointRecord(vertex.handleOut, 'handleOut'),
      ...readMaskHandleMode(vertex.handleMode),
    }];
  });
}

function readPointRecord(value: unknown, key: 'handleIn' | 'handleOut'): Record<string, { x: number; y: number }> {
  if (!isRecord(value)) {
    return {};
  }
  const x = readNumber(value.x);
  const y = readNumber(value.y);
  if (x === null || y === null) {
    return {};
  }
  return { [key]: { x, y } };
}

function readMaskHandleMode(value: unknown): { handleMode?: 'none' | 'mirrored' | 'split' } {
  return value === 'none' || value === 'mirrored' || value === 'split'
    ? { handleMode: value }
    : {};
}
