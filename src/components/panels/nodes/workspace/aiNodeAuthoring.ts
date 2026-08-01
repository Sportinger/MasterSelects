import {
  buildAINodeAuthoringContext,
  extractAINodeGeneratedCode,
} from '../../../../services/nodeGraph';
import type {
  ClipCustomNodeConversationKind,
  ClipCustomNodeConversationMessage,
  ClipCustomNodeDefinition,
} from '../../../../services/nodeGraph';
import { cloudAiService } from '../../../../services/cloudAiService';
import type { MasterAudioState, TimelineClip, TimelineTrack } from '../../../../stores/timeline/types';

const AI_NODE_KIE_MODEL = 'gpt-5-6-luna';
const AI_NODE_MAX_TOKENS = 100_000;
const AI_NODE_MAX_CONVERSATION_MESSAGES = 10;
const AI_NODE_MAX_STORED_CONVERSATION_MESSAGES = 48;
const AI_NODE_CONTEXT_MAX_CHARS = 12_000;
const AI_NODE_CONVERSATION_MESSAGE_MAX_CHARS = 2_000;
const AI_NODE_SUMMARY_MAX_CHARS = 2_400;

export interface AINodeProjectContext {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  masterAudioState?: MasterAudioState;
}

export type NodeAIGenerationAccess =
  | {
      kind: 'hosted';
      label: 'Cloud';
    }
  | {
      kind: 'none';
      label: 'No AI';
    };

type AINodeMessage = {
  role: 'assistant' | 'system' | 'user';
  content: string;
};

export function extractGeneratedNodeCode(value: string): string | null {
  return extractAINodeGeneratedCode(value);
}

export function createAssistantChatContent(response: string, generatedCode: string | null): string {
  if (!generatedCode) {
    return response;
  }

  const responseWithoutCode = response
    .replace(/<activate[_-](?:node[_-])?code>\s*[\s\S]*?\s*<\/activate[_-](?:node[_-])?code>/gi, '')
    .replace(/```(?:ts|tsx|typescript|js|javascript)?\s*[\s\S]*?defineNode\s*\([\s\S]*?```/gi, '')
    .trim();
  if (!responseWithoutCode || response.trim().startsWith('defineNode')) {
    return 'Activated code.';
  }
  return responseWithoutCode;
}

function parseAITextPayload(data: unknown): string {
  const payload = data as {
    output?: Array<{
      content?: Array<{ text?: unknown; type?: string }>;
      type?: string;
    }>;
    choices?: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | null;
      };
    }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error(`AI response hit the ${AI_NODE_MAX_TOKENS} token output cap before finishing. Ask for a smaller node or simplify the generated code.`);
  }
  const responsesText = payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim();
  return responsesText || (choice?.message?.content ?? '').trim();
}

function truncateForAI(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}

function createConversationMessage(
  role: ClipCustomNodeConversationMessage['role'],
  kind: ClipCustomNodeConversationKind,
  content: string,
): ClipCustomNodeConversationMessage {
  return {
    id: `node-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind,
    content,
    createdAt: Date.now(),
  };
}

export function appendConversationTurn(
  definition: ClipCustomNodeDefinition,
  userPrompt: string,
  assistantResponse: string,
  kind: ClipCustomNodeConversationKind,
): {
  conversation: ClipCustomNodeConversationMessage[];
  conversationSummary: string;
} {
  const nextConversation = [
    ...(definition.ai.conversation ?? []),
    createConversationMessage('user', 'message', userPrompt),
    createConversationMessage('assistant', kind, assistantResponse),
  ].slice(-AI_NODE_MAX_STORED_CONVERSATION_MESSAGES);
  const summaryLine = [
    `${kind}:`,
    `user=${truncateForAI(userPrompt.replace(/\s+/g, ' '), 180)}`,
    `assistant=${truncateForAI(assistantResponse.replace(/\s+/g, ' '), 260)}`,
  ].join(' ');

  return {
    conversation: nextConversation,
    conversationSummary: truncateForAI(
      [definition.ai.conversationSummary, summaryLine].filter(Boolean).join('\n'),
      AI_NODE_SUMMARY_MAX_CHARS,
    ),
  };
}

function buildAINodeMessages(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  projectContext: AINodeProjectContext,
): AINodeMessage[] {
  const authoringContext = buildAINodeAuthoringContext(clip, definition, projectContext);
  const recentConversation = (definition.ai.conversation ?? [])
    .slice(-AI_NODE_MAX_CONVERSATION_MESSAGES)
    .map<AINodeMessage>((message) => ({
      role: message.role,
      content: `[node memory:${message.kind}] ${truncateForAI(message.content, AI_NODE_CONVERSATION_MESSAGE_MAX_CHARS)}`,
    }));

  return [
    {
      role: 'system',
      content: [
        'You are the authoring agent for one MasterSelects custom node.',
        'Use the supplied authoring context, graph links, direct connections, node memory, saved plan, and current user request.',
        'Current runtime capabilities override stale node memory and older assistant replies.',
        'If node memory says color params are unsupported, ignore that stale statement: color params are supported now.',
        'Decide what is appropriate:',
        '- If the user is exploring, unclear, or asking for a plan, respond with a concise plan/question in normal text.',
        '- If the user asks for behavior that is implementable from the available node inputs and you are ready to change the live node, use the activate_code tool.',
        'Virtual tool syntax:',
        '<activate_code>',
        'defineNode({ name, inputs, outputs, params, process(input, context) { ... } })',
        '</activate_code>',
        'Do not put planning text inside the activate_code block. Only use it for code that should become the active node code now.',
        'Code must be plain JavaScript with this shape: defineNode({ name, inputs, outputs, params, process(input, context) { ... } }).',
        'Expose user-adjustable values in params, e.g. [{ id: "amount", label: "Amount", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 }].',
        'Supported param types are number, boolean, string, select, and color.',
        'Color params must use a hex string default like "#008cff"; read them from context.params as "#rrggbb" strings. The UI keyframes color params through internal RGB channels.',
        'Read exposed parameter values from context.params or input.params inside process.',
        'input.time is a time object with currentTime/clipLocalTime/seconds and also behaves like a number in numeric expressions.',
        'input.input is a pixel texture { data, width, height }; for text sources, read current text data from input.text, input.metadata.text, or context.text.',
        'For text sources, context.text includes content, typography, color, spacing, text box dimensions, contentBounds, layout.lines, and layout.characters with per-character pixel boxes.',
        'Each layout character has char, index, lineIndex, rect=[x,y,width,height], left, top, right, bottom, x, y, width, and height.',
        'For text write-on, line reveals, or per-line masks, use context.text.layout.lines / input.metadata.text.layout.lines; never divide canvas height into guessed equal lines.',
        'For single-letter effects such as blinking every "g", filter context.text.layout.characters by char and edit output.data inside those rectangles; do not guess character positions.',
        'For whole-text animation/editing, return output.text or top-level text as a patch, e.g. { content, text, color, fontSize, letterSpacing }, to rerender text without editing pixels.',
        'Runtime code must be pure and deterministic: no network, no DOM, no randomness, no wall-clock time.',
        'If implementation is impossible from available signals, explain what input or connection is missing instead of inventing it.',
        'For discussion, return normal chat text. For implementation, return the activate_code tool block.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        truncateForAI(authoringContext, AI_NODE_CONTEXT_MAX_CHARS),
      ].join('\n'),
    },
    ...recentConversation,
    {
      role: 'user',
      content: [
        'Current user request:',
        definition.ai.prompt.trim(),
        '',
        'Respond now. Either chat/plan briefly, or use activate_code when code should go live now.',
      ].join('\n'),
    },
  ];
}

export async function generateAINodeResponse(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  access: NodeAIGenerationAccess,
  projectContext: AINodeProjectContext,
): Promise<string> {
  const messages = buildAINodeMessages(clip, definition, projectContext);

  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const requestBody: Record<string, unknown> = {
    model: AI_NODE_KIE_MODEL,
    instructions: systemPrompt,
    input: messages.filter((message) => message.role !== 'system'),
    max_output_tokens: AI_NODE_MAX_TOKENS,
  };

  if (access.kind === 'hosted') {
    const response = await cloudAiService.createChatCompletion({
      ...requestBody,
      protocol: 'openai-responses',
    });
    return parseAITextPayload(response);
  }

  throw new Error('No AI provider is configured.');
}
