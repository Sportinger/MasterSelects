import type {
  KernelOperationPlanRequestV1,
  KernelOperationPlanSettlementV1,
  KernelOperationSessionDescriptorV1,
} from '../wp1Spike/operationSessionAuthority';
import type {
  KernelOperationPlanResultV1,
  KernelOperationSettlementReceiptV1,
} from '../wp1Spike/operationRoundTrip';

export const HOSTED_AGENT_K0_PROTOCOL_VERSION = 'hosted-agent-k0-v1' as const;
export const HOSTED_AGENT_K1_PROTOCOL_VERSION = 'hosted-agent-k1-v1' as const;
export const HOSTED_AGENT_K2_PROTOCOL_VERSION = 'hosted-agent-k2-v1' as const;
/** Active production boundary. K0 remains named below for recorded evidence only. */
export const HOSTED_AGENT_PROTOCOL_VERSION = HOSTED_AGENT_K2_PROTOCOL_VERSION;
export const HOSTED_AGENT_MAXIMUM_ITERATIONS_K0 = 1 as const;
export const HOSTED_AGENT_MAXIMUM_ITERATIONS_K1 = 400 as const;
export const HOSTED_AGENT_MAXIMUM_ITERATIONS = HOSTED_AGENT_MAXIMUM_ITERATIONS_K1;

export type HostedAgentProtocolVersion =
  | typeof HOSTED_AGENT_K0_PROTOCOL_VERSION
  | typeof HOSTED_AGENT_K1_PROTOCOL_VERSION
  | typeof HOSTED_AGENT_K2_PROTOCOL_VERSION;

export const HOSTED_AGENT_HEADERS = {
  clientInstanceId: 'X-MasterSelects-Client-Instance-Id',
  eventCursor: 'X-MasterSelects-Event-Cursor',
  lastEventId: 'Last-Event-ID',
  pageLease: 'X-MasterSelects-Page-Lease',
  protocolVersion: 'X-MasterSelects-Hosted-Agent-Protocol',
  serviceAssertion: 'X-MasterSelects-Service-Assertion',
  sessionId: 'X-MasterSelects-Session-Id',
  streamLeaseMs: 'X-MasterSelects-Stream-Lease-Ms',
  turnId: 'X-MasterSelects-Turn-Id',
} as const;

export type HostedAgentReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type HostedAgentRunSource = 'ui' | 'bridge' | 'mcp';
export type HostedAgentToolExecutionMode = 'normal' | 'plan' | 'read-only';
export type HostedAgentProviderProtocol = 'claude-messages' | 'openai-responses';

export interface HostedAgentTurnRequest {
  turnId: string;
  clientInstanceId: string;
  request: string;
  model: string;
  reasoningEffort?: HostedAgentReasoningEffort;
  temperature?: number;
  promptVersion: string;
  historyFormatVersion: string;
  toolSchemaVersion: string;
  toolExecutionMode: HostedAgentToolExecutionMode;
  runSource: HostedAgentRunSource;
  maxTurnSpendCredits: number;
  modelPrompt: string;
  systemPrompt: string;
  playbookPrompt: string;
  contextSummary?: string;
  clientCapabilities: {
    supportsNarrationDeltas: boolean;
    supportsImageResultRefs: boolean;
    maximumInlineResultCharacters: number;
    toolNames: string[];
  };
}

export interface HostedAgentTurnAccepted {
  acceptedHistoryFormatVersion: string;
  acceptedPromptVersion: string;
  acceptedToolSchemaVersion: string;
  eventsPath: string;
  maximumIterations: number;
  maximumSpendCredits: number;
  protocolVersion: HostedAgentProtocolVersion;
  replayed: boolean;
  route: 'fast-agent';
  sessionId: string;
  pageLease: HostedAgentK2PageLease;
  turnId: string;
}

interface HostedAgentEventBase {
  eventId: string;
  sessionId: string;
  turnId: string;
}

export type HostedAgentEvent =
  | (HostedAgentEventBase & {
      kind: 'session-ready';
      acceptedPromptVersion: string;
      acceptedHistoryFormatVersion: string;
      acceptedToolSchemaVersion: string;
      maximumIterations: number;
      maximumSpendCredits: number;
    })
  | (HostedAgentEventBase & {
      kind: 'narration-delta' | 'narration-complete';
      phase: 'inspecting' | 'planning' | 'acting' | 'verifying';
      roundIndex: number;
      text: string;
    })
  | (HostedAgentEventBase & {
      kind: 'billing-settled';
      creditBalance: number;
      creditsCharged: number;
      ledgerEntryId: string | null;
      roundIndex: number;
      totalCreditsCharged: number;
    })
  | (HostedAgentEventBase & {
      kind: 'tool-batch-request';
      sequence: number;
      roundIndex: number;
      toolSchemaVersion: string;
      toolCalls: Array<{
        toolCallId: string;
        toolName: string;
        args: unknown;
      }>;
    })
  | (HostedAgentEventBase & {
      kind: 'operation-session-ready';
      descriptor: KernelOperationSessionDescriptorV1;
    })
  | (HostedAgentEventBase & {
      kind: 'operation-plan-request';
      request: KernelOperationPlanRequestV1;
    })
  | (HostedAgentEventBase & {
      kind: 'operation-plan-settlement';
      settlement: KernelOperationPlanSettlementV1;
    })
  | (HostedAgentEventBase & {
      kind: 'turn-complete';
      message: string;
      rounds: number;
      creditsCharged: number;
    })
  | (HostedAgentEventBase & {
      kind: 'turn-failed' | 'turn-canceled' | 'turn-interrupted';
      recoverable: boolean;
      message: string;
    });

export interface HostedAgentToolResult {
  sessionId: string;
  turnId: string;
  clientInstanceId: string;
  sequence: number;
  toolSchemaVersion: string;
  results: Array<{
    toolCallId: string;
    success: boolean;
    modelContent: string;
    error?: string;
    imageResultRefs?: string[];
  }>;
}

export interface HostedAgentServiceAssertionClaims {
  aud: 'masterselects-hosted-agent';
  clientInstanceId: string;
  exp: number;
  iat: number;
  iss: 'masterselects-cloudflare-kernel-proxy';
  maximumIterations: number;
  maxTurnSpendCredits: number;
  model: string;
  nonce: string;
  protocolVersion: HostedAgentProtocolVersion;
  providerProtocol: HostedAgentProviderProtocol;
  sessionId: string;
  sub: string;
  toolExecutionMode: HostedAgentToolExecutionMode;
  turnId: string;
}

export interface HostedAgentOpenAiProviderInput {
  include?: unknown;
  input: unknown[];
  protocol: 'openai-responses';
  store: false;
  text?: unknown;
  toolChoice?: unknown;
  tools: unknown[];
}

export interface HostedAgentClaudeProviderInput {
  messages: unknown[];
  protocol: 'claude-messages';
  toolChoice?: unknown;
  tools: unknown[];
  topP?: number;
}

export type HostedAgentProviderInput =
  | HostedAgentOpenAiProviderInput
  | HostedAgentClaudeProviderInput;

export interface HostedAgentVisualReference {
  id: string;
  mediaType: string;
  role: 'initial' | 'tool-result';
  source: string;
  transport: 'authenticated-ref' | 'data-url';
}

export interface HostedAgentK1TurnRequest extends HostedAgentTurnRequest {
  maximumOutputTokens: number;
  providerInput: HostedAgentProviderInput;
  routePreference?: 'auto' | 'fast-agent' | 'story';
  visualReferences: HostedAgentVisualReference[];
}

export interface HostedAgentK1ClientAuthorityReceipt {
  approval: 'approved' | 'denied' | 'not-required';
  executionMode: HostedAgentToolExecutionMode;
  groupedTransactionId?: string;
  policyChecked: true;
  stateRevisionAfter: string;
  stateRevisionBefore: string;
  validationPassed: boolean;
}

export interface HostedAgentK1ToolResult {
  error?: string;
  imageResultRefs?: string[];
  modelContent: string;
  providerContent?: {
    claudeToolResultContent?: unknown;
    openAiFollowupInput?: unknown[];
  };
  success: boolean;
  toolCallId: string;
}

export interface HostedAgentK1ToolBatchResult {
  authority: HostedAgentK1ClientAuthorityReceipt;
  clientInstanceId: string;
  results: HostedAgentK1ToolResult[];
  sequence: number;
  sessionId: string;
  toolSchemaVersion: string;
  turnId: string;
}

export interface HostedAgentK1ProviderRoundRequest {
  body: Record<string, unknown>;
  model: string;
  protocol: HostedAgentProviderProtocol;
  roundIndex: number;
  turnId: string;
}

export interface HostedAgentK1ProviderRoundResponse {
  raw: unknown;
}

export interface HostedAgentK1RoundUsage {
  cachedInputTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerCredits: number | null;
  reasoningTokens: number | null;
  toolCallCount: number;
}

export interface HostedAgentK1RuntimeResult {
  creditsCharged: number;
  events: HostedAgentEvent[];
  finalMessage: string;
  providerRounds: number;
  status: 'completed';
  toolBatches: number;
}

export type HostedAgentK2SessionStatus =
  | 'active'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'interrupted';

export interface HostedAgentK2PageLease {
  expiresAt: string;
  leaseToken: string;
  sessionId: string;
}

export interface HostedAgentK2EventReplay {
  cursor: string | null;
  events: HostedAgentEvent[];
  leaseExpiresAt: string;
  sessionId: string;
  status: HostedAgentK2SessionStatus;
  turnId: string;
}

export interface HostedAgentK2BatchPostResponse {
  accepted: true;
  cursor: string;
  replayed: boolean;
  sequence: number;
  sessionId: string;
  status: HostedAgentK2SessionStatus;
  turnId: string;
}

export interface HostedAgentK2OperationResultPost {
  result: KernelOperationPlanResultV1;
}

export interface HostedAgentK2OperationSettlementPost {
  receipt: KernelOperationSettlementReceiptV1;
}

export interface HostedAgentK2LargeResultReference {
  byteLength: number;
  expiresAt: string;
  id: string;
  mediaType: string;
}

export interface HostedAgentRoundAuthorizationRequest {
  idempotencyKey: string;
  roundIndex: number;
}

export interface HostedAgentRoundAuthorizationResponse {
  billingTurnId: string;
  idempotencyKey: string;
  maximumIterations: number;
  remainingTurnSpendCredits: number;
  replayed: boolean;
  roundIndex: number;
  status: 'authorized' | 'settled';
  turnId: string;
}

export interface HostedAgentRoundSettlementRequest {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  providerCredits?: number;
  providerResultDigest: string;
  reasoningTokens?: number;
  roundIndex: number;
  idempotencyKey: string;
  toolCallCount?: number;
}

export interface HostedAgentRoundSettlementResponse {
  creditBalance: number;
  creditsCharged: number;
  idempotencyKey: string;
  ledgerEntryId: string | null;
  replayed: boolean;
  roundIndex: number;
  totalCreditsCharged: number;
  turnId: string;
  turnStatus: 'active';
}

export interface HostedAgentTurnCompletionResponse {
  creditsCharged: number;
  terminalReason: 'explicit_complete';
  turnId: string;
  turnStatus: 'completed';
}

export function hostedAgentRoundIdempotencyKey(
  turnId: string,
  roundIndex: number,
): string {
  return `hosted-agent:${turnId}:${roundIndex}`;
}
