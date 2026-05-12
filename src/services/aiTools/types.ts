// AI Tools Types

// Re-export policy types for convenience
export type { RiskLevel, CallerContext, ToolPolicyEntry } from './policy/types';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Tools that modify the timeline or media (need history tracking)
export const MODIFYING_TOOLS = new Set([
  'splitClip', 'splitClipEvenly', 'splitClipAtTimes', 'reorderClips', 'deleteClip', 'deleteClips', 'moveClip', 'trimClip',
  'createTrack', 'deleteTrack', 'setTrackVisibility', 'setTrackMuted',
  'cutRangesFromClip',
  // Media tools
  'createMediaFolder', 'renameMediaItem', 'deleteMediaItem', 'moveMediaItems',
  'createComposition', 'importLocalFiles',
  'executeBatch',
  // YouTube
  'downloadAndImportVideo',
  // Transform & Effects
  'setTransform', 'addEffect', 'removeEffect', 'updateEffect',
  // Node workspace
  'sendAINodePrompt',
  // Keyframes
  'addKeyframe', 'removeKeyframe',
  // Speed & Playback
  'setClipSpeed',
  // Markers
  'addMarker', 'removeMarker',
  // Transitions
  'addTransition', 'removeTransition',
  // Masks
  'addMask', 'addRectangleMask', 'addEllipseMask', 'removeMask', 'updateMask',
  'addVertex', 'removeVertex', 'updateVertex',
]);

// Tool definition type (OpenAI function calling format)
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}
