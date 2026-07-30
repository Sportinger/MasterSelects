import type { ToolDefinition, ToolResult } from '../aiTools';

export type FlashBoardChatProvider = 'kernel' | 'kie' | 'lemonade';
export type FlashBoardKieChatProtocol = 'claude-messages' | 'openai-responses';
export type FlashBoardOpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type FlashBoardChatPromptVersion = 'v2' | 'legacy-v1';
export type FlashBoardChatRunSource = 'ui' | 'bridge' | 'mcp' | 'test';
export type FlashBoardChatToolExecutionMode = 'normal' | 'read-only';

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

export interface FlashBoardChatRequest {
  hostedAvailable?: boolean;
  idempotencyKey?: string;
  kieAiApiKey?: string;
  lemonadeContextSize?: number;
  lemonadeEndpoint?: string;
  model: string;
  onExecutedToolCalls?: (toolCalls: FlashBoardExecutedToolCall[]) => void;
  /** Live stage updates while the kernel works the turn. */
  onKernelProgress?: import('../kernelClient/runProgress').KernelProgressReporter;
  /** Structured record of a kernel-handled turn, for the run card. */
  onKernelReport?: (report: import('../kernelClient/runReport').KernelRunReport) => void;
  /** Reports which explicitly selected engine is working on the turn. */
  onPhase?: (phase: 'kernel' | 'provider') => void;
  onRunCompleted?: (run: import('./FlashBoardChatRunAudit').FlashBoardChatRunRecord) => void;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  playbookPrompt?: string;
  prompt: string;
  promptVersion?: FlashBoardChatPromptVersion;
  provider: FlashBoardChatProvider;
  runSource?: FlashBoardChatRunSource;
  signal?: AbortSignal;
  systemPromptIncludeContext?: boolean;
  systemPromptIncludePlaybook?: boolean;
  systemPromptOverride?: string;
  temperature: number;
  toolExecutionMode?: FlashBoardChatToolExecutionMode;
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
