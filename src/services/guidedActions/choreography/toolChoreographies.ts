import type {
  GuidedAction,
  GuidedActionFamily,
  GuidedMaskCreateOptions,
  GuidedMaskPathVertexInput,
  GuidedTargetRef,
  GuidedToolCall,
  ValidationCheck,
} from '../types';
import type { TimelineToolGroupId } from '../../../stores/timeline/types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import { createTimelineReplayOperationFromToolCall } from './aiToolTimelineOperationAdapter';
import { createTimelineEditReplayDescriptor } from './timelineEditReplayDescriptors';
import type { GuidedToolChoreography, GuidedToolChoreographyContext } from './types';

type ClipTransformCheck = Extract<ValidationCheck, { kind: 'clipTransformMatches' }>;
type ClipTransformProperty = ClipTransformCheck['property'];

interface TransformPropertyChange {
  arg: string;
  property: string;
  value: unknown;
  target: GuidedTargetRef;
}

const CHOREOGRAPHIES = new Map<string, GuidedToolChoreography>([
  ['selectClips', compileSelectClips],
  ['setPlayhead', compileSetPlayhead],
  ['setTransform', compileSetTransform],
  ['splitClip', compileTimelineEdit],
  ['splitClipEvenly', compileTimelineEdit],
  ['splitClipAtTimes', compileTimelineEdit],
  ['trimClip', compileTimelineEdit],
  ['moveClip', compileTimelineEdit],
  ['deleteClip', compileTimelineEdit],
  ['deleteClips', compileTimelineEdit],
  ['addClipSegment', compileAddClipSegment],
  ['addRectangleMask', compileMaskEdit],
  ['addEllipseMask', compileMaskEdit],
  ['addMask', compileMaskEdit],
  ['updateMask', compileMaskEdit],
  ['addMaskPathKeyframe', compileMaskEdit],
  ['addEffect', compileEffectEdit],
  ['updateEffect', compileEffectEdit],
  ['addKeyframe', compileKeyframeEdit],
  ['captureFrame', compilePreviewAction],
  ['importLocalFiles', compileImportLocalFiles],
  ['downloadAndImportVideo', compileDownloadAndImportVideo],
]);

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

export function getGuidedToolChoreography(tool: string): GuidedToolChoreography | undefined {
  return CHOREOGRAPHIES.get(tool);
}

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

function compileSelectClips(
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

function compileSetPlayhead(
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

function compileSetTransform(
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

function compileTimelineEdit(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const replayOperation = createTimelineReplayOperationFromToolCall(toolCall);
  if (replayOperation) {
    return compileTimelineEditReplayToolCall(toolCall, context, replayOperation);
  }

  return compileBasicTimelineEdit(toolCall, context);
}

function compileTimelineEditReplayToolCall(
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

function compileBasicTimelineEdit(
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

function compileAddClipSegment(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'media';
  const mediaFileId = readString(toolCall.args.mediaFileId);
  const trackId = readString(toolCall.args.trackId);
  const startTime = readNumber(toolCall.args.startTime);
  const mediaTarget = mediaFileId ? mediaItemTarget(mediaFileId) : undefined;
  const timelineTarget = startTime !== null
    ? {
        kind: 'timelineTime' as const,
        ...(trackId ? { trackId } : {}),
        time: startTime,
      }
    : undefined;
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'media', family, label: 'Open Media' },
  ];

  if (mediaTarget) {
    actions.push(
      { type: 'resolveTarget', target: mediaTarget, required: false, family },
      { type: 'moveCursorTo', target: mediaTarget, durationMs: 420, optional: true, family, label: 'Move to media item' },
      { type: 'highlightTarget', target: mediaTarget, tone: 'primary', durationMs: 260, family, label: 'Highlight media item' },
      { type: 'clickVisual', target: mediaTarget, optional: true, family, label: 'Pick up media item' },
    );
  }

  actions.push({ type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' });

  if (timelineTarget) {
    actions.push(
      { type: 'scrollIntoView', target: timelineTarget, block: 'center', family, label: `Reveal ${startTime}s` },
      mediaTarget
        ? { type: 'dragCursor', from: mediaTarget, to: timelineTarget, durationMs: 760, optional: true, family, label: 'Drag media to timeline' }
        : { type: 'moveCursorTo', target: timelineTarget, durationMs: 520, optional: true, family, label: 'Move to timeline position' },
    );
  }

  actions.push(createExecutionAction(toolCall, family));

  if (timelineTarget) {
    actions.push({
      type: 'highlightTarget',
      target: timelineTarget,
      tone: 'success',
      durationMs: 220,
      family,
      label: 'Highlight drop position',
    });
  }

  actions.push({
    type: 'callout',
    title: 'Added clip segment',
    body: timelineTarget ? `Placed at ${formatMaybeNumber(startTime)}.` : 'Media was added to the timeline.',
    target: timelineTarget ?? mediaTarget,
    family,
  });

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function compileImportLocalFiles(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'media';
  const paths = readStringArray(toolCall.args.paths);
  const addToTimeline = toolCall.args.addToTimeline === true;
  const trackId = readString(toolCall.args.trackId);
  const startTime = readNumber(toolCall.args.startTime) ?? 0;
  const mediaPanelTarget: GuidedTargetRef = { kind: 'panel', panel: 'media' };
  const timelineTarget = addToTimeline
    ? timelineTimeTarget(startTime, trackId ?? undefined)
    : undefined;
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'media', family, label: 'Open Media' },
    {
      type: 'callout',
      title: 'Import local files',
      body: paths.length > 0
        ? `Import ${paths.length} file${paths.length === 1 ? '' : 's'}.`
        : 'Import files into the media panel.',
      target: mediaPanelTarget,
      family,
    },
  ];

  if (timelineTarget) {
    actions.push(
      { type: 'moveCursorTo', target: mediaPanelTarget, durationMs: 380, optional: true, family, label: 'Move to Media' },
      { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
      { type: 'scrollIntoView', target: timelineTarget, block: 'center', family, label: `Reveal ${startTime}s` },
      { type: 'dragCursor', from: mediaPanelTarget, to: timelineTarget, durationMs: 720, optional: true, family, label: 'Drag import to timeline' },
    );
  }

  actions.push(createExecutionAction(toolCall, family));

  if (timelineTarget) {
    actions.push(
      {
        type: 'highlightTarget',
        target: timelineTarget,
        tone: 'success',
        durationMs: 260,
        family,
        label: 'Highlight placement',
      },
      {
        type: 'callout',
        title: 'Imported to timeline',
        body: `Placed at ${formatMaybeNumber(startTime)}.`,
        target: timelineTarget,
        family,
      },
    );
  }

  if (context.includeValidation) {
    actions.push({
      type: 'confirmState',
      check: { kind: 'mediaItemImported' },
      family,
      label: 'Confirm media import',
    });
  }

  return actions;
}

function compileDownloadAndImportVideo(
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
): GuidedAction[] {
  const family: GuidedActionFamily = 'media';
  const title = readString(toolCall.args.title);
  const startTime = readNumber(toolCall.args.startTime) ?? 0;
  const downloadPanelTarget: GuidedTargetRef = { kind: 'panel', panel: 'media' };
  const timelineTarget = timelineTimeTarget(startTime);
  const actions: GuidedAction[] = [
    { type: 'focusPanel', panel: 'media', family, label: 'Open Media' },
    {
      type: 'callout',
      title: 'Download video',
      body: title ? `Download "${title}" and place it on the timeline.` : 'Download and place the video on the timeline.',
      target: downloadPanelTarget,
      family,
    },
    { type: 'moveCursorTo', target: downloadPanelTarget, durationMs: 380, optional: true, family, label: 'Move to Media downloads' },
    { type: 'focusPanel', panel: 'timeline', family, label: 'Open timeline' },
    { type: 'scrollIntoView', target: timelineTarget, block: 'center', family, label: `Reveal ${startTime}s` },
    { type: 'dragCursor', from: downloadPanelTarget, to: timelineTarget, durationMs: 720, optional: true, family, label: 'Drag download to timeline' },
    createExecutionAction(toolCall, family),
    {
      type: 'highlightTarget',
      target: timelineTarget,
      tone: 'success',
      durationMs: 260,
      family,
      label: 'Highlight pending clip',
    },
    {
      type: 'callout',
      title: 'Download started',
      body: `Pending clip placed at ${formatMaybeNumber(startTime)}.`,
      target: timelineTarget,
      family,
    },
  ];

  if (context.includeValidation) {
    actions.push(createCustomConfirmation(toolCall, family));
  }

  return actions;
}

function compileMaskEdit(
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

function compileEffectEdit(
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

function compileKeyframeEdit(
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

function compilePreviewAction(
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

function createExecutionAction(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
  return {
    type: 'executeTool',
    tool: toolCall.tool,
    args: toolCall.args,
    family,
    label: `Execute ${toolCall.tool}`,
  };
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

function createCustomConfirmation(toolCall: GuidedToolCall, family: GuidedActionFamily): GuidedAction {
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

function inferFallbackFamily(tool: string): GuidedActionFamily {
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

function clipTarget(clipId: string): GuidedTargetRef {
  return { kind: 'timelineClip', clipId };
}

function mediaItemTarget(itemId: string): GuidedTargetRef {
  return { kind: 'mediaItem', itemId };
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

function timelineTimeTarget(time: number, trackId?: string): GuidedTargetRef {
  return {
    kind: 'timelineTime',
    ...(trackId ? { trackId } : {}),
    time,
  };
}

function formatToolName(tool: string): string {
  return tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatPropertyName(property: string): string {
  return property.replace(/\./g, ' ');
}

function formatMaybeNumber(value: number | null): string {
  return value === null ? 'target time' : `${value}s`;
}

function isConfirmableTransformProperty(property: string): property is ClipTransformProperty {
  return CONFIRMABLE_TRANSFORM_PROPERTIES.has(property);
}

function isToolPixelTransformArg(arg: string): boolean {
  return arg === 'x' || arg === 'y';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
