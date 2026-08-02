import type { ToolDefinition, ToolResult } from '../aiTools';
import type {
  KernelActiveDecision,
  KernelDecisionPrompt,
} from '../storyboard/contracts';
import type {
  HostedAgentFastV2ExecutionProfile,
  HostedAgentFastV2RequestedModelClass,
} from '../kernelClient/hostedAgent/fastV2StartContract';

export type FlashBoardChatProvider = 'kernel' | 'kie';
export type FlashBoardChatExecutionProfile = HostedAgentFastV2ExecutionProfile;
export type FlashBoardChatModelClass = HostedAgentFastV2RequestedModelClass;
export type FlashBoardKieChatProtocol = 'claude-messages' | 'openai-responses';
export type FlashBoardOpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type FlashBoardChatPromptVersion = 'v2';
export type FlashBoardChatRunSource = 'ui' | 'bridge' | 'mcp' | 'test';
export type FlashBoardChatToolExecutionMode = 'normal' | 'plan' | 'read-only';
export type ChatIntent = 'plan' | 'execute';
export type DecisionPolicy = 'automatic' | 'milestones' | 'every-decision';
export const DEFAULT_FLASHBOARD_DECISION_POLICY: DecisionPolicy = 'automatic';

export type AgentActivityEvent =
  | {
      id: string;
      runId: string;
      kind: 'narration';
      source: 'model';
      phase: 'inspecting' | 'planning' | 'acting' | 'verifying';
      roundIndex: number;
      text: string;
      createdAt: number;
    }
  | {
      id: string;
      runId: string;
      kind: 'operation';
      source: 'runtime';
      phase: 'started' | 'completed' | 'failed';
      safeLabel: string;
      /** Stable provider call id used to collapse start/completion into one log row. */
      operationId?: string;
      toolName?: string;
      createdAt: number;
    }
  | {
      id: string;
      runId: string;
      kind: 'progress';
      source: 'runtime';
      label: string;
      current?: number;
      total?: number;
      createdAt: number;
    };

export type AgentActivityEventInput =
  | Omit<Extract<AgentActivityEvent, { kind: 'narration' }>, 'id' | 'runId' | 'createdAt' | 'source'>
  | Omit<Extract<AgentActivityEvent, { kind: 'operation' }>, 'id' | 'runId' | 'createdAt' | 'source'>
  | Omit<Extract<AgentActivityEvent, { kind: 'progress' }>, 'id' | 'runId' | 'createdAt' | 'source'>;

export interface FlashBoardChatProviderOption {
  id: FlashBoardChatProvider;
  label: string;
}

export interface FlashBoardChatModelOption {
  id: string;
  kieProtocol?: FlashBoardKieChatProtocol;
  label: string;
  provider: FlashBoardChatProvider;
  supportsTemperature: boolean;
  supportsTools: boolean;
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: FlashBoardOpenAiReasoningEffort[];
}

/** A bounded image payload prepared by the browser for one chat turn. */
export interface FlashBoardChatVisualReference {
  dataUrl: string;
  height?: number;
  id: string;
  mediaType: string;
  name?: string;
  width?: number;
}

export interface FlashBoardChatRequest {
  /** Internal run binding used to correlate provider activity with the chat audit. */
  activityRunId?: string;
  activeDecision?: KernelActiveDecision;
  hostedAvailable?: boolean;
  idempotencyKey?: string;
  intent?: ChatIntent;
  decisionPolicy?: DecisionPolicy;
  /** Explicit hosted execution profile; omitted callers retain the Fast default. */
  executionProfile?: FlashBoardChatExecutionProfile;
  /** Server-owned Fast V2 speed profile; never a raw provider or model name. */
  requestedModelClass?: FlashBoardChatModelClass;
  model: string;
  onActivityEvent?: (event: AgentActivityEvent) => void;
  onExecutedToolCalls?: (toolCalls: FlashBoardExecutedToolCall[]) => void;
  /** Live stage updates while the kernel works the turn. */
  onKernelProgress?: import('../kernelClient/runProgress').KernelProgressReporter;
  /** Structured record of a kernel-handled turn, for the run card. */
  onKernelReport?: (report: import('../kernelClient/runReport').KernelRunReport) => void;
  /** Durable directing decision returned without implicit mutation. */
  onKernelDecision?: (decision: KernelDecisionPrompt) => void;
  /** Explicit user gate for a bound destructive kernel operation plan. */
  onKernelOperationConfirmation?: (
    request: Readonly<import('../kernelClient/wp1Spike/operationRoundTrip').KernelOperationConfirmationRequestV1>,
  ) => boolean | Promise<boolean>;
  /** Reports which explicitly selected engine is working on the turn. */
  onPhase?: (phase: 'kernel' | 'provider') => void;
  /** Incremental assistant text emitted while a hosted model is still generating. */
  onTextDelta?: (delta: string) => void;
  onRunCompleted?: (run: import('./FlashBoardChatRunAudit').FlashBoardChatRunRecord) => void;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  playbookPrompt?: string;
  prompt: string;
  provider: FlashBoardChatProvider;
  /** Pending assistant bubble that may reconnect to a hosted turn after reload. */
  resumeMessageId?: string;
  runSource?: FlashBoardChatRunSource;
  signal?: AbortSignal;
  temperature: number;
  toolExecutionMode?: FlashBoardChatToolExecutionMode;
  visualReferences?: FlashBoardChatVisualReference[];
}

export interface FlashBoardToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface FlashBoardExecutedToolCall {
  modelContent: string;
  result: ToolResult;
  toolCall: FlashBoardToolCall;
}

export interface FlashBoardChatCompletionMessage {
  content: string | null;
  imageDataUrl?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      arguments: string;
      name: string;
    };
  }>;
}

export interface OpenAiResponsesToolDefinition {
  description: string;
  name: string;
  parameters: ToolDefinition['function']['parameters'];
  strict: false;
  type: 'function';
}

export interface OpenAiResponsesFunctionCall {
  arguments: string;
  call_id: string;
  id?: string;
  name: string;
  status?: string;
  type: 'function_call';
}

export interface AnthropicToolDefinition {
  description: string;
  input_schema: ToolDefinition['function']['parameters'];
  name: string;
}

export interface AnthropicTextBlock {
  text: string;
  type: 'text';
}

export interface AnthropicToolUseBlock {
  id: string;
  input?: unknown;
  name: string;
  type: 'tool_use';
}

export interface AnthropicToolResultBlock {
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
  tool_use_id: string;
  type: 'tool_result';
}

export interface AnthropicImageBlock {
  source: {
    data: string;
    media_type: string;
    type: 'base64';
  };
  type: 'image';
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | AnthropicImageBlock;

export interface AnthropicMessage {
  content: string | AnthropicContentBlock[];
  role: 'user' | 'assistant';
}
