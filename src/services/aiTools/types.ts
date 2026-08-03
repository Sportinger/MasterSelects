// AI Tools Types

// Re-export policy types for convenience
export type {
  AIToolExecutionMode,
  CallerContext,
  RiskLevel,
  ToolPolicyEntry,
} from './policy/types';
import type { AIToolExecutionMode } from './policy/types';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface GuidedReplayBudgetController {
  compression: 'none' | 'family' | 'aggressive';
  consumeBudgetMs: (plannedMs: number) => void;
  getRemainingBudgetMs: () => number;
  reserveBudgetMs: (remainingCallsInGroup?: number) => number;
}

export interface AIToolCallExecution {
  id?: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface AIToolCallExecutionResult {
  id?: string;
  tool: string;
  result: ToolResult;
}

export interface AIToolExecutionOptions {
  auditProviderToolCallId?: string;
  signal?: AbortSignal;
  staggerBudgetMs?: number;
  suppressHistory?: boolean;
  guidedSessionId?: string;
  legacyFeedback?: 'native' | 'bridge' | 'off';
  guidedAnimationBudgetMs?: number;
  guidedCompressionMode?: 'none' | 'family' | 'aggressive';
  guidedLegacyFeedback?: 'native' | 'bridge' | 'off';
  guidedReplayBudgetController?: GuidedReplayBudgetController;
  guidedReplayRemainingCalls?: number;
  guidedReplay?: boolean;
  guidedVisualizationMode?: 'off' | 'concise' | 'full';
  executionMode?: AIToolExecutionMode;
}

// Tools that modify the timeline or media (need history tracking)
export const MODIFYING_TOOLS = new Set([
  'splitClip', 'splitClipEvenly', 'splitClipAtTimes', 'reorderClips', 'deleteClip', 'deleteClips', 'moveClip', 'trimClip',
  'createTrack', 'deleteTrack', 'setTrackVisibility', 'setTrackMuted',
  'cutRangesFromClip',
  // Media tools
  'createMediaFolder', 'renameMediaItem', 'deleteMediaItem', 'moveMediaItems',
  'createComposition', 'importLocalFiles',
  'createStressTestProjectFixture',
  'executeBatch',
  'addStoryboardScene', 'updateStoryboardScene',
  'createTimelineVariantSet', 'addTimelineVariantOption',
  'materializeTimelineVariantOption', 'commitTimelineVariantOption',
  'archiveTimelineVariantSet',
  // Face-analysis corrections
  'mergeClipFacePeople', 'moveClipFaceAppearance', 'assignClipFaceReviewCandidate',
  // YouTube
  'downloadAndImportVideo',
  // Transform & Effects
  'setTransform', 'addEffect', 'removeEffect', 'updateEffect',
  // Node workspace
  'sendAINodePrompt',
  // Keyframes
  'addKeyframe', 'removeKeyframe',
  // Text
  'createEditableTitleStack', 'manageEditableHook', 'refineEditableHook', 'createTextClip', 'updateTextProperties', 'setTextBox', 'addTextBoundsKeyframe',
  'createCaptionClip', 'updateCaptionProperties',
  // Motion Design
  'createMotionShapeClip', 'updateMotionProperties', 'updateMotionAppearances', 'saveMotionAppearancePreset', 'applyMotionAppearancePreset', 'saveMotionTemplate', 'applyMotionTemplate',
  'setMotionParent', 'createMotionNull', 'createMotionNullAndParent', 'configureMotionReplicator',
  'editMotionModifier',
  'setMotionExpression',
  'editMotionAdjustment',
  // Speed & Playback
  'setClipSpeed',
  // Markers
  'addMarker', 'removeMarker',
  // Transitions
  'addTransition', 'removeTransition',
  // Masks
  'addMask', 'addRectangleMask', 'addEllipseMask', 'removeMask', 'updateMask',
  'addMaskPathKeyframe', 'addVertex', 'removeVertex', 'updateVertex',
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
