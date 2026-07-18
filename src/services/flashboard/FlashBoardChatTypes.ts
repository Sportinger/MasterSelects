import type { ToolDefinition, ToolResult } from '../aiTools';

export type FlashBoardChatProvider = 'openai' | 'anthropic' | 'lemonade';
export type FlashBoardOpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface FlashBoardChatProviderOption {
  id: FlashBoardChatProvider;
  label: string;
}

export interface FlashBoardChatModelOption {
  id: string;
  label: string;
  provider: FlashBoardChatProvider;
  supportsTemperature: boolean;
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: FlashBoardOpenAiReasoningEffort[];
  maxTokensParameter?: 'max_tokens' | 'max_completion_tokens';
}

export interface FlashBoardChatRequest {
  anthropicApiKey?: string;
  hostedAvailable?: boolean;
  lemonadeContextSize?: number;
  lemonadeEndpoint?: string;
  model: string;
  onExecutedToolCalls?: (toolCalls: FlashBoardExecutedToolCall[]) => void;
  openAiApiKey?: string;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  prompt: string;
  provider: FlashBoardChatProvider;
  signal?: AbortSignal;
  systemPromptIncludeContext?: boolean;
  systemPromptOverride?: string;
  temperature: number;
}

export type FlashBoardApprovalMode = 'auto' | 'confirm-destructive' | 'confirm-all-mutating';

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
