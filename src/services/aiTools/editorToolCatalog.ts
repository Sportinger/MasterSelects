import {
  analysisToolDefinitions,
  clipToolDefinitions,
  effectToolDefinitions,
  nodeCatalogToolDefinitions,
  operatorGraphToolDefinitions,
  flockToolDefinitions,
  keyframeToolDefinitions,
  maskToolDefinitions,
  mediaToolDefinitions,
  motionDesignToolDefinitions,
  playbackToolDefinitions,
  previewToolDefinitions,
  storyboardToolDefinitions,
  documentToolDefinitions,
  compositionRuleToolDefinitions,
  multicamToolDefinitions,
  captionToolDefinitions,
  textToolDefinitions,
  timelineToolDefinitions,
  trackToolDefinitions,
  transformToolDefinitions,
  transitionToolDefinitions,
} from './definitions';
import { rigToolDefinitions } from './definitions/rig';
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

/**
 * Atomic editor tools that the private kernel's pinned capability catalog does
 * not list yet. They stay reachable through the shared dispatcher (dev bridge,
 * console, FlashBoard direct surfaces) but are kept out of the Fast V2 catalog,
 * so `HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST` keeps matching the
 * kernel pin. Removing a name here changes that digest and must ship together
 * with the kernel's new pin and a kernel category for the tool.
 */
export const KERNEL_PIN_PENDING_EDITOR_TOOL_NAMES: ReadonlySet<string> = new Set([
  'duplicateComposition',
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
  ...nodeCatalogToolDefinitions,
  ...operatorGraphToolDefinitions,
  ...keyframeToolDefinitions,
  ...textToolDefinitions,
  ...captionToolDefinitions,
  ...motionDesignToolDefinitions,
  ...playbackToolDefinitions,
  ...transitionToolDefinitions,
  ...maskToolDefinitions,
  ...storyboardToolDefinitions,
  ...documentToolDefinitions,
  ...compositionRuleToolDefinitions,
  ...multicamToolDefinitions,
  ...flockToolDefinitions,
  ...rigToolDefinitions,
];

export const ATOMIC_EDITOR_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  CANDIDATE_EDITOR_TOOL_DEFINITIONS.filter((tool) => (
    !NON_ATOMIC_EDITOR_TOOL_NAMES.has(tool.function.name)
    && !KERNEL_PIN_PENDING_EDITOR_TOOL_NAMES.has(tool.function.name)
  ));

const ATOMIC_EDITOR_TOOL_NAMES = new Set(
  ATOMIC_EDITOR_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

export function isKernelEditorToolName(toolName: string): boolean {
  return ATOMIC_EDITOR_TOOL_NAMES.has(toolName);
}
