import type {
  ChatIntent,
  DecisionPolicy,
  JsonObject,
  JsonValue,
  StoryboardCandidateState,
  StoryboardDecision,
  StoryboardFingerprint,
  StoryboardGenerationBrief,
  StoryboardProjectState,
  StoryboardScene,
  TimelineVariantScope,
} from './models';
import type {
  KernelSilenceRange,
  KernelTranscriptMoment,
} from '../../kernelClient/types';

export interface KernelConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface KernelActiveDecision {
  decisionId: string;
  optionIds: string[];
  freeform?: string;
}

export interface KernelTimelineRangeSelection {
  startTime: number;
  endTime: number;
  trackIds: string[];
  includeLinked: boolean;
}

export interface KernelGenerationCapabilitySummary {
  mediaType: 'image' | 'video' | 'audio';
  supportsImageToVideo: boolean;
  supportsStartEndFrames: boolean;
  supportsNativeAudio: boolean;
  supportedDurationsSeconds: number[];
  aspectRatios: string[];
}

export interface KernelCandidateJobState {
  candidateId: string;
  state: StoryboardCandidateState;
  generationRecordId?: string;
  outputId?: string;
  mediaFileId?: string;
}

export interface KernelStoryboardSnapshot {
  schemaVersion: 1;
  activeComposition: JsonObject | null;
  sceneProjections: StoryboardScene[];
  storyboard: StoryboardProjectState;
  timelineRangeSelection: KernelTimelineRangeSelection | null;
  selectedClipIds: string[];
  generationCapabilities: KernelGenerationCapabilitySummary[];
  candidateJobs: KernelCandidateJobState[];
  fingerprints: {
    project?: StoryboardFingerprint;
    storyboard?: StoryboardFingerprint;
    selectedRange?: StoryboardFingerprint;
    boundary?: StoryboardFingerprint;
  };
}

export interface KernelCompileRequest {
  request: string;
  snapshot: KernelStoryboardSnapshot;
  intent?: ChatIntent;
  decisionPolicy?: DecisionPolicy;
  conversation?: KernelConversationTurn[];
  activeDecision?: KernelActiveDecision;
  activeVariantSetId?: string;
  moments?: KernelTranscriptMoment[];
  silentRanges?: KernelSilenceRange[];
  seed?: string;
}

export interface KernelResolvedCall {
  stepId: string;
  tool: string;
  args: JsonObject;
}

export interface KernelPlannedResponse {
  runId: string;
  status: 'planned';
  message: string;
  resolvedCalls: KernelResolvedCall[];
  expectedFingerprint?: StoryboardFingerprint;
  planSummary?: JsonValue;
}

export interface KernelDecisionResponse {
  runId: string;
  status: 'awaiting-decision';
  message: string;
  decision: KernelDecisionPrompt;
}

export interface KernelDecisionPrompt {
  id: string;
  kind: StoryboardDecision['kind'];
  question: string;
  baseFingerprint: StoryboardFingerprint;
  options: Array<{
    id: string;
    title: string;
    summary: string;
    rationale?: string;
    tradeoffs?: string[];
    estimatedCredits?: number;
    preview?: JsonValue;
  }>;
  allowMultiple?: boolean;
  allowFreeform?: boolean;
}

export interface KernelVariantPlanOption {
  id: string;
  title: string;
  rationale: string;
  resolvedCalls: KernelResolvedCall[];
  generationBriefs: StoryboardGenerationBrief[];
}

export interface KernelVariantPlanResponse {
  runId: string;
  status: 'variant-planned';
  message: string;
  variantSet: {
    scope: TimelineVariantScope;
    baseFingerprint: StoryboardFingerprint;
    options: KernelVariantPlanOption[];
  };
}

/**
 * Existing verified execute behavior keeps the public `compiled` status.
 */
export interface KernelExecuteResponse {
  runId: string;
  status: 'compiled';
  mode?: 'mechanical' | 'story';
  taskContract: JsonValue;
  plan?: JsonValue;
  storySummary?: JsonValue;
  resolvedCalls: KernelResolvedCall[];
  setup?: {
    newComposition: {
      name: string;
      durationSeconds: number;
    };
  };
  segments?: {
    simulatedVideoClipIds: string[];
  };
  expectedFingerprint: StoryboardFingerprint;
  summary: JsonValue;
}

export type KernelCompileAbortReason =
  | 'notMechanicalTask'
  | 'storyPathNeedsProvider'
  | 'storyPathNeedsMoments'
  | 'storyOnlyModeActive'
  | 'staleDecision'
  | 'staleVariant'
  | 'policyDeclined';

export interface KernelAbortedResponse {
  runId: string;
  status: 'aborted';
  failures: JsonValue;
  reason?: KernelCompileAbortReason;
  missingPrecondition?: {
    kind: 'transcript';
  };
}

export interface KernelFailedResponse {
  runId: string;
  status: 'failed';
  failures: JsonValue;
  message?: string;
}

export type KernelStoryboardResponse =
  | KernelPlannedResponse
  | KernelDecisionResponse
  | KernelVariantPlanResponse
  | KernelExecuteResponse
  | KernelAbortedResponse
  | KernelFailedResponse;

export type KernelStoryboardResponseStatus = KernelStoryboardResponse['status'];

export const KERNEL_STORYBOARD_RESPONSE_STATUSES = [
  'planned',
  'awaiting-decision',
  'variant-planned',
  'compiled',
  'aborted',
  'failed',
] as const satisfies readonly KernelStoryboardResponseStatus[];

export function assertNeverKernelResponse(value: never): never {
  throw new Error(`Unhandled kernel storyboard response: ${JSON.stringify(value)}`);
}
