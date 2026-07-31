export interface KernelHealthResponse {
  [key: string]: unknown;
}

export interface KernelRunRequest {
  request: unknown;
  seed?: number;
}

type KernelJsonPrimitive = string | number | boolean | null;
type KernelJsonValue =
  | KernelJsonPrimitive
  | { [key: string]: KernelJsonValue }
  | KernelJsonValue[];

/**
 * Transport-local shape of the decision wire payload. The kernel transport
 * must remain reusable without importing the editor's storyboard domain.
 */
export interface KernelDecisionPrompt {
  id: string;
  kind: 'story' | 'evidence' | 'generation' | 'cut' | 'variant' | 'duration';
  question: string;
  baseFingerprint: {
    schemaVersion: 1;
    algorithm: 'sha-256';
    value: string;
  };
  options: Array<{
    id: string;
    title: string;
    summary: string;
    rationale?: string;
    tradeoffs?: string[];
    estimatedCredits?: number;
    preview?: KernelJsonValue;
  }>;
  allowMultiple?: boolean;
  allowFreeform?: boolean;
}

export interface KernelRunResponse {
  [key: string]: unknown;
}

export interface KernelResolvedCall {
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
}

export type KernelAnalysisSource =
  | 'transcript'
  | 'voice-activity'
  | 'speech-markers'
  | 'prosody';

export interface KernelTranscriptMoment {
  schemaVersion: 1;
  handle: string;
  source: { mediaId: string; fileName?: string };
  sourceRange: { startSeconds: number; endSeconds: number };
  evidence: {
    transcript?: string;
    /** Per-word source timings, chronological and complete for the moment. */
    words?: { text: string; startSeconds: number; endSeconds: number }[];
    pauses?: { startSeconds: number; endSeconds: number }[];
    emphasis?: { text: string; startSeconds: number; score: number }[];
    markers?: {
      kind: 'breath' | 'filler' | 'disfluency';
      timeSeconds: number;
    }[];
  };
  confidence: number;
  indexVersion: string;
  analysisSources: KernelAnalysisSource[];
}

export interface KernelSilenceRange {
  mediaId: string;
  startSeconds: number; // SOURCE seconds
  endSeconds: number; // SOURCE seconds
  confidence?: number; // meanProbability when available
  detectionSource?: string; // e.g. 'voice-activity' | 'rms' | 'transcript-gaps'
}

export interface KernelCompileRequest {
  request: string;
  snapshot: unknown;
  intent?: 'execute' | 'plan';
  decisionPolicy?: 'automatic' | 'milestones' | 'every-decision';
  conversation?: Array<{ role: 'user' | 'assistant'; text: string }>;
  activeDecision?: { decisionId: string; optionIds: string[]; freeform?: string };
  activeVariantSetId?: string;
  seed?: string;
  moments?: KernelTranscriptMoment[];
  indexVersion?: string;
  silentRanges?: KernelSilenceRange[];
}

export interface KernelCompilePlannedResponse {
  runId: string;
  status: 'planned';
  message: string;
  resolvedCalls: KernelResolvedCall[];
  expectedFingerprint?: unknown;
  planSummary?: unknown;
}

export interface KernelCompileDecisionResponse {
  runId: string;
  status: 'awaiting-decision';
  message: string;
  decision: KernelDecisionPrompt;
}

export interface KernelCompileSetup {
  newComposition: {
    name: string;
    durationSeconds: number;
  };
}

export interface KernelCompileCompiledResponse {
  runId: string;
  status: 'compiled';
  mode?: 'mechanical' | 'story';
  taskContract: unknown;
  plan?: unknown;
  storySummary?: unknown;
  resolvedCalls: KernelResolvedCall[];
  setup?: KernelCompileSetup;
  /** Source-ordered simulated segment ids for runtime id mapping. */
  segments?: { simulatedVideoClipIds: string[] };
  expectedFingerprint: unknown;
  summary: unknown;
}

export type KernelCompileAbortReason =
  | 'notMechanicalTask'
  | 'storyPathNeedsProvider'
  | 'storyPathNeedsMoments'
  /** Story-only calibration parked the mechanical families. */
  | 'storyOnlyModeActive'
  | 'staleDecision'
  | 'staleVariant'
  | 'policyDeclined';

export interface KernelMissingPrecondition {
  kind: 'transcript';
}

export interface KernelCompileStoppedResponse {
  runId: string;
  status: 'aborted' | 'failed';
  failures: unknown;
  reason?: KernelCompileAbortReason;
  missingPrecondition?: KernelMissingPrecondition;
}

export type KernelCompileResponse =
  | KernelCompileCompiledResponse
  | KernelCompileDecisionResponse
  | KernelCompilePlannedResponse
  | KernelCompileStoppedResponse;

export interface KernelRunCompleteRequest {
  finalSnapshot: unknown;
}

export interface KernelFingerprintAssert {
  committed?: string;
  matches: boolean;
  simulated?: string;
  [key: string]: unknown;
}

export interface KernelRunCompleteResponse {
  status: 'succeeded' | 'failed';
  fingerprintAssert: KernelFingerprintAssert;
  verificationReport: unknown;
}

export interface KernelValidateRequest {
  request: unknown;
  seed?: number;
  snapshot: unknown;
}

export interface KernelValidateResponse {
  [key: string]: unknown;
}

export interface KernelManifestsResponse {
  [key: string]: unknown;
}

export interface KernelRunStatusResponse {
  [key: string]: unknown;
}

export interface KernelServiceSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface KernelServiceFailure {
  ok: false;
  status: number;
  error: string;
}

export type KernelServiceResult<T> = KernelServiceSuccess<T> | KernelServiceFailure;

export interface KernelRequestOptions {
  timeoutMs?: number;
}

export interface KernelServiceClientOptions {
  authToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
