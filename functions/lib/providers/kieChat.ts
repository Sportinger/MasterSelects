import type { Env } from '../env';

const KIE_CHAT_BASE_URL = 'https://api.kie.ai';
const KIE_CHAT_MAX_TOOLS = 128;

export type KieChatProtocol = 'claude-messages' | 'openai-responses';

export interface KieChatModelCapability {
  id: string;
  label: string;
  protocol: KieChatProtocol;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  supportsTools: boolean;
}

interface KieChatModelSpec extends KieChatModelCapability {
  endpoint: '/claude/v1/messages' | '/codex/v1/responses';
}

export interface HostedKieChatRequest {
  auditInput: unknown;
  messageCount: number;
  model: string;
  protocol: KieChatProtocol;
  providerBody: Record<string, unknown>;
  stream: boolean;
}

const KIE_CHAT_MODEL_SPECS: Record<string, KieChatModelSpec> = {
  'gpt-5-6-luna': {
    endpoint: '/codex/v1/responses',
    id: 'gpt-5-6-luna',
    label: 'GPT 5.6 Luna',
    protocol: 'openai-responses',
    supportsReasoning: true,
    supportsTemperature: false,
    supportsTools: true,
  },
  'gpt-5-6-terra': {
    endpoint: '/codex/v1/responses',
    id: 'gpt-5-6-terra',
    label: 'GPT 5.6 Terra',
    protocol: 'openai-responses',
    supportsReasoning: true,
    supportsTemperature: false,
    supportsTools: true,
  },
  'gpt-5-6-sol': {
    endpoint: '/codex/v1/responses',
    id: 'gpt-5-6-sol',
    label: 'GPT 5.6 Sol',
    protocol: 'openai-responses',
    supportsReasoning: true,
    supportsTemperature: false,
    supportsTools: true,
  },
  'gpt-5-5': {
    endpoint: '/codex/v1/responses',
    id: 'gpt-5-5',
    label: 'GPT 5.5',
    protocol: 'openai-responses',
    supportsReasoning: true,
    supportsTemperature: false,
    supportsTools: true,
  },
  'gpt-5-4': {
    endpoint: '/codex/v1/responses',
    id: 'gpt-5-4',
    label: 'GPT 5.4',
    protocol: 'openai-responses',
    supportsReasoning: true,
    supportsTemperature: false,
    supportsTools: true,
  },
  'claude-opus-4-8': {
    endpoint: '/claude/v1/messages',
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    protocol: 'claude-messages',
    supportsReasoning: false,
    supportsTemperature: true,
    supportsTools: true,
  },
  'claude-sonnet-5': {
    endpoint: '/claude/v1/messages',
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    protocol: 'claude-messages',
    supportsReasoning: false,
    supportsTemperature: true,
    supportsTools: true,
  },
  'claude-fable-5': {
    endpoint: '/claude/v1/messages',
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    protocol: 'claude-messages',
    supportsReasoning: false,
    supportsTemperature: true,
    supportsTools: false,
  },
};

const RESPONSE_BODY_KEYS = [
  'include',
  'input',
  'instructions',
  'max_output_tokens',
  'reasoning',
  'store',
  'text',
  'tool_choice',
  'tools',
] as const;

const CLAUDE_BODY_KEYS = [
  'max_tokens',
  'messages',
  'system',
  'temperature',
  'thinkingFlag',
  'tool_choice',
  'tools',
  'top_p',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function copyDefinedFields(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

function capProviderTools(body: Record<string, unknown>): void {
  if (Array.isArray(body.tools) && body.tools.length > KIE_CHAT_MAX_TOOLS) {
    body.tools = body.tools.slice(0, KIE_CHAT_MAX_TOOLS);
  }
}

function getKieAiKey(env: Env): string {
  const apiKey = env.KIEAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('KIEAI_API_KEY is not configured');
  }
  return apiKey;
}

function readProviderError(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.msg === 'string' && payload.msg.trim()) {
      return payload.msg;
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
    if (isRecord(payload.error) && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
  }
  return `Kie.ai chat request failed with status ${status}`;
}

export function getKieChatModelCapability(model: string): KieChatModelCapability | null {
  const spec = KIE_CHAT_MODEL_SPECS[model];
  if (!spec) {
    return null;
  }
  const { endpoint: _endpoint, ...capability } = spec;
  return capability;
}

export function getKieChatCapabilities(): KieChatModelCapability[] {
  return Object.values(KIE_CHAT_MODEL_SPECS).map(({ endpoint: _endpoint, ...capability }) => capability);
}

export function normalizeHostedKieChatRequest(body: unknown): HostedKieChatRequest | null {
  if (!isRecord(body) || typeof body.model !== 'string') {
    return null;
  }

  const model = body.model.trim();
  const spec = KIE_CHAT_MODEL_SPECS[model];
  if (!spec || (body.protocol !== undefined && body.protocol !== spec.protocol)) {
    return null;
  }

  if (spec.protocol === 'openai-responses') {
    if (!Array.isArray(body.input) || body.input.length === 0) {
      return null;
    }
    const providerBody = copyDefinedFields(body, RESPONSE_BODY_KEYS);
    providerBody.model = model;
    providerBody.stream = false;
    capProviderTools(providerBody);
    return {
      auditInput: {
        input: providerBody.input,
        instructions: providerBody.instructions,
      },
      messageCount: body.input.length,
      model,
      protocol: spec.protocol,
      providerBody,
      stream: body.stream === true,
    };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return null;
  }
  const providerBody = copyDefinedFields(body, CLAUDE_BODY_KEYS);
  providerBody.model = model;
  providerBody.stream = false;
  capProviderTools(providerBody);
  if (!spec.supportsTools) {
    delete providerBody.tools;
    delete providerBody.tool_choice;
  }
  return {
    auditInput: {
      messages: providerBody.messages,
      system: providerBody.system,
    },
    messageCount: body.messages.length,
    model,
    protocol: spec.protocol,
    providerBody,
    stream: body.stream === true,
  };
}

export async function runHostedKieChatCompletion(
  env: Env,
  request: HostedKieChatRequest,
): Promise<unknown> {
  const spec = KIE_CHAT_MODEL_SPECS[request.model];
  if (!spec) {
    throw new Error(`Unsupported Kie.ai chat model: ${request.model}`);
  }

  const response = await fetch(`${KIE_CHAT_BASE_URL}${spec.endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKieAiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.providerBody),
  });
  const responseText = await response.text();
  let payload: unknown = null;

  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = {
      error: {
        message: responseText.slice(0, 500),
      },
    };
  }

  if (!response.ok) {
    throw new Error(readProviderError(payload, response.status));
  }
  return payload;
}
