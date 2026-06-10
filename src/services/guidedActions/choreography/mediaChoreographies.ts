import type { GuidedAction, GuidedActionFamily, GuidedTargetRef, GuidedToolCall } from './choreographyTypeAliases';
import type { GuidedToolChoreographyContext } from './types';
import {
  createCustomConfirmation,
  createExecutionAction,
  formatMaybeNumber,
  mediaItemTarget,
  readNumber,
  readString,
  readStringArray,
  timelineTimeTarget,
} from './choreographyShared';

export function compileAddClipSegment(
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

export function compileImportLocalFiles(
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

export function compileDownloadAndImportVideo(
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
