import type {
  GuidedAction,
  GuidedActionFamily,
  GuidedAnimationBudget,
  GuidedCompressedGroup,
  GuidedCompressionMode,
  GuidedScheduleDiagnostics,
  GuidedScheduledAction,
  GuidedSessionPlan,
  GuidedTargetRef,
} from './types';

const DEFAULT_ANIMATION_BUDGET_MS = 3000;

const INSPECT_TOOLS = new Set([
  'getTimelineState',
  'getClipDetails',
  'getClipsInTimeRange',
  'getMediaItems',
  'getMasks',
  'listEffects',
  'getKeyframes',
  'getTextProperties',
]);

const SELECTION_TOOLS = new Set([
  'selectClips',
  'clearSelection',
  'setPlayhead',
  'setInOutPoints',
  'openComposition',
]);

const TIMELINE_EDIT_TOOLS = new Set([
  'splitClip',
  'splitClipAtTimes',
  'splitClipEvenly',
  'trimClip',
  'moveClip',
  'deleteClip',
  'deleteClips',
  'cutRangesFromClip',
  'reorderClips',
]);

const PROPERTY_EDIT_TOOLS = new Set([
  'setTransform',
  'setClipSpeed',
  'updateEffect',
  'updateMask',
  'updateTextProperties',
  'setTextBox',
]);

const CREATION_TOOLS = new Set([
  'createTrack',
  'createComposition',
  'createMediaFolder',
  'addEffect',
  'addTransition',
  'addMarker',
  'createTextClip',
]);

const MASK_TOOLS = new Set([
  'addMask',
  'addRectangleMask',
  'addEllipseMask',
  'addMaskPathKeyframe',
  'addVertex',
  'updateVertex',
  'removeVertex',
  'removeMask',
]);

const KEYFRAME_TOOLS = new Set([
  'addKeyframe',
  'removeKeyframe',
  'addTextBoundsKeyframe',
]);

const MEDIA_TOOLS = new Set([
  'importLocalFiles',
  'downloadAndImportVideo',
  'moveMediaItems',
  'renameMediaItem',
  'deleteMediaItem',
]);

const PLAYBACK_DEBUG_TOOLS = new Set([
  'play',
  'pause',
  'captureFrame',
  'getCutPreviewQuad',
  'getStats',
  'getPlaybackTrace',
]);

export const DEFAULT_GUIDED_ANIMATION_BUDGET: GuidedAnimationBudget = {
  totalMs: DEFAULT_ANIMATION_BUDGET_MS,
  disabled: false,
  compression: 'family',
};

export function normalizeGuidedAnimationBudget(
  input?: Partial<GuidedAnimationBudget> | number,
): GuidedAnimationBudget {
  const requested = typeof input === 'number'
    ? input
    : input?.totalMs ?? DEFAULT_ANIMATION_BUDGET_MS;
  const totalMs = clampBudgetMs(requested);
  const disabled = totalMs === 0 || (typeof input === 'object' && input.disabled === true);

  return {
    totalMs: disabled ? 0 : totalMs,
    disabled,
    compression: typeof input === 'object' && input.compression
      ? input.compression
      : DEFAULT_GUIDED_ANIMATION_BUDGET.compression,
  };
}

export function createGuidedAnimationBudget(
  totalMs = DEFAULT_ANIMATION_BUDGET_MS,
  compression: GuidedCompressionMode = 'family',
): GuidedAnimationBudget {
  return normalizeGuidedAnimationBudget({ totalMs, compression });
}

export function planGuidedActions(
  actions: GuidedAction[],
  budgetInput?: Partial<GuidedAnimationBudget> | number,
): GuidedSessionPlan {
  const budget = normalizeGuidedAnimationBudget(budgetInput);
  const planned = actions.map((action, index) => {
    const naturalDurationMs = budget.disabled ? 0 : getNaturalActionDurationMs(action);
    return {
      action,
      index,
      family: inferGuidedActionFamily(action),
      startsAtMs: 0,
      naturalDurationMs,
      compressedDurationMs: naturalDurationMs,
      plannedDurationMs: 0,
      compressed: false,
    } satisfies GuidedScheduledAction;
  });

  const compressedGroups = budget.disabled
    ? []
    : applyRepeatedActionCompression(planned, budget.compression);
  const naturalDurationMs = sumBy(planned, (action) => action.naturalDurationMs);
  const compressedNaturalDurationMs = sumBy(planned, (action) => action.compressedDurationMs);
  const scale = budget.disabled || compressedNaturalDurationMs === 0
    ? 0
    : budget.totalMs / compressedNaturalDurationMs;

  let startsAtMs = 0;
  for (const action of planned) {
    action.startsAtMs = startsAtMs;
    action.plannedDurationMs = budget.disabled
      ? 0
      : Math.floor(action.compressedDurationMs * scale);
    startsAtMs += action.plannedDurationMs;
  }

  const diagnostics: GuidedScheduleDiagnostics = {
    actionCount: planned.length,
    requestedBudgetMs: typeof budgetInput === 'number'
      ? budgetInput
      : budgetInput?.totalMs ?? DEFAULT_ANIMATION_BUDGET_MS,
    normalizedBudgetMs: budget.totalMs,
    disabled: budget.disabled,
    naturalDurationMs,
    compressedNaturalDurationMs,
    plannedDurationMs: startsAtMs,
    scale,
    droppedOptionalSteps: 0,
    compressedGroups,
  };

  return { actions: planned, diagnostics };
}

export function inferGuidedActionFamily(action: GuidedAction): GuidedActionFamily {
  if (action.family) {
    return action.family;
  }

  switch (action.type) {
    case 'executeTool':
      return inferToolFamily(action.tool);
    case 'confirmState':
    case 'waitForUserAction':
    case 'waitForTutorialNavigation':
    case 'resolveTarget':
      return 'validation';
    case 'focusPanel':
    case 'openTimelineToolGroupVisual':
    case 'openPropertiesTab':
    case 'selectClip':
    case 'setPlayheadVisual':
    case 'setTimelineToolVisual':
      return 'context';
    case 'resizePanel':
    case 'pressButton':
    case 'openDropdown':
    case 'chooseDropdownOption':
    case 'typeInto':
    case 'scrollIntoView':
      return 'surface';
    case 'delay':
    case 'clickVisual':
    case 'doubleClickVisual':
    case 'showInputGesture':
    case 'dragCursor':
    case 'drawMaskPath':
    case 'drawPreviewPath':
    case 'highlightTarget':
    case 'moveCursorTo':
    case 'spotlight':
    case 'callout':
      return inferTargetFamily(getPrimaryTarget(action)) ?? 'feedback';
  }
}

export function inferToolFamily(tool: string): GuidedActionFamily {
  if (INSPECT_TOOLS.has(tool)) return 'inspect';
  if (SELECTION_TOOLS.has(tool)) return 'selection-navigation';
  if (TIMELINE_EDIT_TOOLS.has(tool)) return 'timeline-edit';
  if (PROPERTY_EDIT_TOOLS.has(tool)) return 'property-edit';
  if (CREATION_TOOLS.has(tool)) return 'creation';
  if (MASK_TOOLS.has(tool)) return 'mask-edit';
  if (KEYFRAME_TOOLS.has(tool)) return 'keyframes';
  if (MEDIA_TOOLS.has(tool)) return 'media';
  if (PLAYBACK_DEBUG_TOOLS.has(tool)) return 'playback-debug';
  return 'semantic';
}

export function getNaturalActionDurationMs(action: GuidedAction): number {
  switch (action.type) {
    case 'delay':
      return clampDurationMs(action.ms);
    case 'moveCursorTo':
      return clampDurationMs(action.durationMs ?? 500);
    case 'dragCursor':
      return clampDurationMs(action.durationMs ?? 700);
    case 'clickVisual':
      return 180;
    case 'doubleClickVisual':
      return 260;
    case 'showInputGesture':
      return 420;
    case 'highlightTarget':
      return clampDurationMs(action.durationMs ?? 450);
    case 'spotlight':
      return 250;
    case 'callout':
      return 350;
    case 'scrollIntoView':
      return 300;
    case 'focusPanel':
    case 'openPropertiesTab':
    case 'openTimelineToolGroupVisual':
      return 180;
    case 'resizePanel':
      return 500;
    case 'pressButton':
    case 'openDropdown':
    case 'chooseDropdownOption':
      return 220;
    case 'typeInto':
      return clampDurationMs(120 + action.text.length * 35);
    case 'drawMaskPath':
    case 'drawPreviewPath':
      return clampDurationMs(250 + getPathPointCount(action) * 140 + (action.close ? 120 : 0));
    case 'selectClip':
    case 'setPlayheadVisual':
    case 'setTimelineToolVisual':
      return 180;
    case 'resolveTarget':
    case 'executeTool':
    case 'confirmState':
    case 'waitForUserAction':
    case 'waitForTutorialNavigation':
      return 0;
  }
}

function applyRepeatedActionCompression(
  actions: GuidedScheduledAction[],
  compression: GuidedCompressionMode,
): GuidedCompressedGroup[] {
  if (compression === 'none') {
    return [];
  }

  const compressedGroups: GuidedCompressedGroup[] = [];
  const multiplier = compression === 'aggressive' ? 0.35 : 0.55;
  let index = 0;

  while (index < actions.length) {
    const first = actions[index];
    if (!first) {
      break;
    }

    let endIndex = index;
    while (
      endIndex + 1 < actions.length
      && actions[endIndex + 1]?.family === first.family
      && isCompressibleAction(actions[endIndex + 1]!.action)
    ) {
      endIndex += 1;
    }

    const groupLength = endIndex - index + 1;
    if (groupLength > 1 && isCompressibleAction(first.action)) {
      const originalDurationMs = sumRange(actions, index, endIndex, (action) => action.compressedDurationMs);
      for (let groupIndex = index + 1; groupIndex <= endIndex; groupIndex++) {
        const action = actions[groupIndex];
        if (!action) continue;
        action.compressedDurationMs = Math.floor(action.compressedDurationMs * multiplier);
        action.compressed = action.compressedDurationMs !== action.naturalDurationMs;
      }
      const compressedDurationMs = sumRange(actions, index, endIndex, (action) => action.compressedDurationMs);
      compressedGroups.push({
        family: first.family,
        startIndex: index,
        endIndex,
        actionCount: groupLength,
        originalDurationMs,
        compressedDurationMs,
      });
    }

    index = endIndex + 1;
  }

  return compressedGroups;
}

function isCompressibleAction(action: GuidedAction): boolean {
  if (action.optional === false) {
    return false;
  }

  return action.type !== 'executeTool'
    && action.type !== 'drawMaskPath'
    && action.type !== 'confirmState'
    && action.type !== 'waitForUserAction'
    && action.type !== 'waitForTutorialNavigation'
    && action.type !== 'resolveTarget';
}

function inferTargetFamily(target: GuidedTargetRef | null): GuidedActionFamily | null {
  if (!target) {
    return null;
  }

  switch (target.kind) {
    case 'panel':
    case 'panelEdge':
      return 'context';
    case 'propertiesTab':
    case 'propertyControl':
      return 'property-edit';
    case 'timelineClip':
    case 'timelineFadeHandle':
    case 'timelineKeyframe':
    case 'timelineMarker':
    case 'timelineTime':
    case 'timelineTrimHandle':
      return 'timeline-edit';
    case 'previewPoint':
    case 'previewPathVertex':
    case 'maskEdge':
    case 'maskHandle':
    case 'maskToolbarButton':
    case 'maskVertex':
      return 'mask-edit';
    case 'mediaItem':
      return 'media';
    case 'button':
    case 'dom':
    case 'dropdown':
    case 'dropdownOption':
    case 'menuItem':
      return 'surface';
  }
}

function getPrimaryTarget(action: GuidedAction): GuidedTargetRef | null {
  switch (action.type) {
    case 'moveCursorTo':
    case 'highlightTarget':
    case 'spotlight':
    case 'scrollIntoView':
    case 'pressButton':
    case 'openDropdown':
    case 'chooseDropdownOption':
    case 'typeInto':
      return action.target;
    case 'dragCursor':
      return action.to;
    case 'clickVisual':
    case 'doubleClickVisual':
    case 'callout':
      return action.target ?? null;
    case 'resizePanel':
      return action.visualTarget ?? null;
    case 'delay':
    case 'drawMaskPath':
    case 'drawPreviewPath':
    case 'focusPanel':
    case 'openTimelineToolGroupVisual':
    case 'openPropertiesTab':
    case 'selectClip':
    case 'setPlayheadVisual':
    case 'setTimelineToolVisual':
    case 'showInputGesture':
    case 'executeTool':
    case 'confirmState':
    case 'waitForUserAction':
    case 'waitForTutorialNavigation':
    case 'resolveTarget':
      return null;
  }
}

function getPathPointCount(action: Extract<GuidedAction, { type: 'drawPreviewPath' | 'drawMaskPath' }>): number {
  return action.type === 'drawMaskPath'
    ? action.vertices.length
    : action.points.length;
}

function clampBudgetMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ANIMATION_BUDGET_MS;
  }
  return Math.max(0, Math.round(value));
}

function clampDurationMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}

function sumRange<T>(items: T[], start: number, end: number, pick: (item: T) => number): number {
  let total = 0;
  for (let index = start; index <= end; index++) {
    const item = items[index];
    if (item) {
      total += pick(item);
    }
  }
  return total;
}
