import { useAccountStore } from '../../../stores/accountStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  ClipCustomNodeConversationKind,
  ClipCustomNodeConversationMessage,
  ClipCustomNodeDefinition,
  TimelineClip,
  TimelineTrack,
} from '../../../types';
import { cloudAiService } from '../../cloudAiService';
import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  type LemonadeMessage,
} from '../../lemonadeProvider';
import {
  buildAINodeAuthoringContext,
  buildClipNodeGraph,
  extractAINodeGeneratedCode,
  extractAINodeParameterSchemaFromCode,
  mergeAINodeParamDefaults,
} from '../../nodeGraph';
import type { ToolResult } from '../types';

const AI_NODE_OPENAI_MODEL = 'gpt-5.1';
const AI_NODE_MAX_TOKENS = 100_000;
const AI_NODE_TIMEOUT_MS = 90_000;
const AI_NODE_STREAM_IDLE_TIMEOUT_MS = 20_000;
const AI_NODE_MAX_CONVERSATION_MESSAGES = 10;
const AI_NODE_MAX_STORED_CONVERSATION_MESSAGES = 48;
const AI_NODE_CONTEXT_MAX_CHARS = 12_000;
const AI_NODE_CONVERSATION_MESSAGE_MAX_CHARS = 2_000;
const AI_NODE_SUMMARY_MAX_CHARS = 2_400;

type AINodeGenerationAccess =
  | { kind: 'hosted'; label: 'Cloud' }
  | { apiKey: string; kind: 'openai'; label: 'OpenAI key' }
  | { endpoint: string; kind: 'lemonade'; label: 'Local'; model: string }
  | { kind: 'none'; label: 'No AI' };

function truncateForAI(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}

function parseAITextPayload(data: unknown): string {
  const payload = data as {
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
  return (choice?.message?.content ?? '').trim();
}

function createAssistantChatContent(response: string, generatedCode: string | null): string {
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

function appendConversationTurn(
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

function resolveAINodeAccess(): AINodeGenerationAccess {
  const settings = useSettingsStore.getState();
  const account = useAccountStore.getState();

  if (settings.aiProvider === 'lemonade') {
    return {
      endpoint: settings.lemonadeEndpoint || DEFAULT_LEMONADE_ENDPOINT,
      kind: 'lemonade',
      label: 'Local',
      model: settings.lemonadeModel || DEFAULT_LEMONADE_MODEL,
    };
  }

  if (account.session?.authenticated && account.hostedAIEnabled) {
    return { kind: 'hosted', label: 'Cloud' };
  }

  if (settings.apiKeys.openai) {
    return { apiKey: settings.apiKeys.openai, kind: 'openai', label: 'OpenAI key' };
  }

  return { kind: 'none', label: 'No AI' };
}

function buildAINodeMessages(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  projectContext: { clips: TimelineClip[]; tracks: TimelineTrack[] },
  userPrompt: string,
): LemonadeMessage[] {
  const authoringContext = buildAINodeAuthoringContext(clip, definition, projectContext);
  const recentConversation = (definition.ai.conversation ?? [])
    .slice(-AI_NODE_MAX_CONVERSATION_MESSAGES)
    .map<LemonadeMessage>((message) => ({
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
      content: truncateForAI(authoringContext, AI_NODE_CONTEXT_MAX_CHARS),
    },
    ...recentConversation,
    {
      role: 'user',
      content: [
        'Current user request:',
        userPrompt,
        '',
        'Respond now. Either chat/plan briefly, or use activate_code when code should go live now.',
      ].join('\n'),
    },
  ];
}

async function generateAINodeResponse(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  access: AINodeGenerationAccess,
  projectContext: { clips: TimelineClip[]; tracks: TimelineTrack[] },
  userPrompt: string,
): Promise<string> {
  const messages = buildAINodeMessages(clip, definition, projectContext, userPrompt);

  if (access.kind === 'lemonade') {
    const result = await createLemonadeChatCompletionStream({
      endpoint: access.endpoint,
      model: access.model,
      messages,
      maxTokens: AI_NODE_MAX_TOKENS,
      streamIdleTimeoutMs: AI_NODE_STREAM_IDLE_TIMEOUT_MS,
      timeoutMs: AI_NODE_TIMEOUT_MS,
    });
    return (result.content ?? '').trim();
  }

  const requestBody: Record<string, unknown> = {
    model: AI_NODE_OPENAI_MODEL,
    messages,
    max_completion_tokens: AI_NODE_MAX_TOKENS,
  };

  if (access.kind === 'hosted') {
    const response = await cloudAiService.createChatCompletion(requestBody);
    return parseAITextPayload(response);
  }

  if (access.kind === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `AI request failed: ${response.status}`);
    }

    return parseAITextPayload(await response.json());
  }

  throw new Error('No AI provider is configured.');
}

function findAINode(clipId?: string, nodeId?: string): {
  clip: TimelineClip;
  definition: ClipCustomNodeDefinition;
} | null {
  const state = useTimelineStore.getState();
  const selectedClipIds = Array.from(state.selectedClipIds);
  const clip = clipId
    ? state.clips.find((candidate) => candidate.id === clipId)
    : selectedClipIds.length === 1
      ? state.clips.find((candidate) => candidate.id === selectedClipIds[0])
      : state.clips.find((candidate) => (candidate.nodeGraph?.customNodes?.length ?? 0) > 0);
  if (!clip) {
    return null;
  }

  const customNodes = clip.nodeGraph?.customNodes ?? [];
  const definition = nodeId
    ? customNodes.find((candidate) => candidate.id === nodeId)
    : customNodes[0];
  if (!definition) {
    return null;
  }

  return { clip, definition };
}

function summarizeCustomNode(definition: ClipCustomNodeDefinition) {
  return {
    id: definition.id,
    label: definition.label,
    status: definition.status,
    bypassed: definition.bypassed === true,
    inputs: definition.inputs,
    outputs: definition.outputs,
    params: definition.params ?? {},
    parameterSchema: definition.parameterSchema ?? [],
    ai: {
      prompt: definition.ai.prompt,
      plan: definition.ai.plan,
      generatedCode: definition.ai.generatedCode ?? '',
      generatedCodeLength: definition.ai.generatedCode?.length ?? 0,
      conversation: definition.ai.conversation ?? [],
      conversationSummary: definition.ai.conversationSummary,
      updatedAt: definition.ai.updatedAt,
    },
  };
}

export async function handleGetNodeWorkspaceDebugState(args: Record<string, unknown>): Promise<ToolResult> {
  const state = useTimelineStore.getState();
  const clipId = typeof args.clipId === 'string' ? args.clipId : undefined;
  const nodeId = typeof args.nodeId === 'string' ? args.nodeId : undefined;
  const includeGraph = args.includeGraph !== false;
  const includeAuthoringContext = args.includeAuthoringContext === true;
  const clips = clipId
    ? state.clips.filter((clip) => clip.id === clipId)
    : state.clips.filter((clip) => (clip.nodeGraph?.customNodes?.length ?? 0) > 0);

  const tracks = state.tracks;
  const selectedClipIds = Array.from(state.selectedClipIds);
  const clipSummaries = clips.map((clip) => {
    const graph = includeGraph ? buildClipNodeGraph(clip) : null;
    const customNodes = (clip.nodeGraph?.customNodes ?? []).map((definition) => {
      const summary = summarizeCustomNode(definition);
      return {
        ...summary,
        authoringContext: includeAuthoringContext && (!nodeId || nodeId === definition.id)
          ? buildAINodeAuthoringContext(clip, definition, { clips: state.clips, tracks })
          : undefined,
      };
    });

    return {
      id: clip.id,
      name: clip.name,
      sourceType: clip.source?.type,
      trackId: clip.trackId,
      startTime: clip.startTime,
      duration: clip.duration,
      selected: selectedClipIds.includes(clip.id),
      customNodes,
      graph,
    };
  });

  return {
    success: true,
    data: {
      playheadPosition: state.playheadPosition,
      selectedClipIds,
      clipCount: clipSummaries.length,
      clips: clipSummaries,
    },
  };
}

export async function handleSendAINodePrompt(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return { success: false, error: 'prompt is required.' };
  }

  const match = findAINode(
    typeof args.clipId === 'string' ? args.clipId : undefined,
    typeof args.nodeId === 'string' ? args.nodeId : undefined,
  );
  if (!match) {
    return { success: false, error: 'AI node not found. Provide clipId and nodeId, or select a clip with an AI node.' };
  }

  const access = resolveAINodeAccess();
  if (access.kind === 'none') {
    return { success: false, error: 'No AI provider configured.' };
  }

  const timelineStore = useTimelineStore.getState();
  const response = await generateAINodeResponse(
    match.clip,
    match.definition,
    access,
    { clips: timelineStore.clips, tracks: timelineStore.tracks },
    prompt,
  );
  if (!response) {
    return { success: false, error: 'AI returned an empty response.' };
  }

  const generatedCode = extractAINodeGeneratedCode(response);
  const assistantChatContent = createAssistantChatContent(response, generatedCode);
  const conversation = appendConversationTurn(
    match.definition,
    prompt,
    assistantChatContent,
    generatedCode ? 'code' : 'plan',
  );

  if (!generatedCode) {
    timelineStore.updateClipAICustomNode(match.clip.id, match.definition.id, {
      ai: {
        prompt: '',
        plan: response,
        conversation: conversation.conversation,
        conversationSummary: conversation.conversationSummary,
        updatedAt: Date.now(),
      },
    });

    return {
      success: true,
      data: {
        clipId: match.clip.id,
        nodeId: match.definition.id,
        provider: access.label,
        activatedCode: false,
        response,
        assistantChatContent,
        conversationCount: conversation.conversation.length,
      },
    };
  }

  const parameterSchema = extractAINodeParameterSchemaFromCode(generatedCode);
  timelineStore.updateClipAICustomNode(match.clip.id, match.definition.id, {
    status: 'ready',
    parameterSchema,
    params: mergeAINodeParamDefaults(parameterSchema, match.definition.params),
    ai: {
      prompt: '',
      generatedCode,
      conversation: conversation.conversation,
      conversationSummary: conversation.conversationSummary,
      updatedAt: Date.now(),
    },
  });

  return {
    success: true,
    data: {
      clipId: match.clip.id,
      nodeId: match.definition.id,
      provider: access.label,
      activatedCode: true,
      response,
      assistantChatContent,
      generatedCode,
      parameterSchema,
      conversationCount: conversation.conversation.length,
    },
  };
}
