import {
  analysisToolDefinitions,
  clipToolDefinitions,
  effectToolDefinitions,
  keyframeToolDefinitions,
  maskToolDefinitions,
  mediaToolDefinitions,
  motionDesignToolDefinitions,
  playbackToolDefinitions,
  previewToolDefinitions,
  storyboardToolDefinitions,
  captionToolDefinitions,
  textToolDefinitions,
  timelineToolDefinitions,
  trackToolDefinitions,
  transformToolDefinitions,
  transitionToolDefinitions,
} from './definitions';
import type { ToolDefinition } from './types';

/**
 * Provider-facing compound workflows belong to the private kernel. Local,
 * diagnostic, transport-control, and history-control tools are also excluded
 * from progressive discovery because they are not bounded editor operations.
 */
const NON_ATOMIC_EDITOR_TOOL_NAMES = new Set([
  'createEditableTitleStack',
  'cutRangesFromClip',
  'executeBatch',
  'importLocalFiles',
  'listLocalFiles',
  'manageEditableHook',
  'monitorManualPause',
  'pause',
  'play',
  'redo',
  'refineEditableHook',
  'runPixelParticleDisintegrateQa',
  'simulateFrameKeypresses',
  'simulatePlayback',
  'simulatePlaybackPath',
  'simulatePlaybackPulses',
  'simulateScrub',
  'undo',
]);

const CANDIDATE_EDITOR_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...timelineToolDefinitions,
  ...clipToolDefinitions,
  ...trackToolDefinitions,
  ...analysisToolDefinitions,
  ...previewToolDefinitions,
  ...mediaToolDefinitions,
  ...transformToolDefinitions,
  ...effectToolDefinitions,
  ...keyframeToolDefinitions,
  ...textToolDefinitions,
  ...captionToolDefinitions,
  ...motionDesignToolDefinitions,
  ...playbackToolDefinitions,
  ...transitionToolDefinitions,
  ...maskToolDefinitions,
  ...storyboardToolDefinitions,
];

export const ATOMIC_EDITOR_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  CANDIDATE_EDITOR_TOOL_DEFINITIONS.filter((tool) => (
    !NON_ATOMIC_EDITOR_TOOL_NAMES.has(tool.function.name)
  ));

const ATOMIC_EDITOR_TOOL_NAMES = new Set(
  ATOMIC_EDITOR_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

export function isKernelEditorToolName(toolName: string): boolean {
  return ATOMIC_EDITOR_TOOL_NAMES.has(toolName);
}
