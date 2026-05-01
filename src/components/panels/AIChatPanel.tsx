// AI Chat Panel - Chat interface with timeline editing tools using OpenAI API

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSettingsStore, type AIProvider } from '../../stores/settingsStore';
import { useAccountStore } from '../../stores/accountStore';
import { AI_TOOLS, executeAITool, getQuickTimelineSummary, getToolPolicy } from '../../services/aiTools';
import { cloudAiService } from '../../services/cloudAiService';
import type { ToolPolicyEntry } from '../../services/aiTools';
import {
  getDefaultProjectPromptName,
  isProjectPromptStorageAvailable,
  listProjectSystemPrompts,
  loadProjectSystemPrompt,
  normalizeProjectPromptName,
  saveProjectSystemPrompt,
  type SavedAiSystemPrompt,
} from '../../services/aiPromptLibrary';
import {
  checkLemonadeHealth,
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  LEMONADE_MODEL_PRESETS,
  type LemonadeModelInfo,
} from '../../services/lemonadeProvider';
import './AIChatPanel.css';

// Available OpenAI models with credit cost per request
const OPENAI_MODELS = [
  // GPT-5.2 series (newest - Dec 2025)
  { id: 'gpt-5.2', name: 'GPT-5.2 (Thinking)', credits: 8 },
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', credits: 10 },
  // GPT-5.1 series
  { id: 'gpt-5.1', name: 'GPT-5.1', credits: 5 },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', credits: 5 },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', credits: 1 },
  // GPT-5 series
  { id: 'gpt-5', name: 'GPT-5', credits: 5 },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', credits: 1 },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', credits: 1 },
  // Reasoning models
  { id: 'o3', name: 'o3 (Reasoning)', credits: 5 },
  { id: 'o4-mini', name: 'o4-mini (Reasoning)', credits: 3 },
  { id: 'o3-pro', name: 'o3-pro (Deep Reasoning)', credits: 50 },
  // GPT-4.1 series
  { id: 'gpt-4.1', name: 'GPT-4.1', credits: 5 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', credits: 1 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', credits: 1 },
  // GPT-4o series (legacy)
  { id: 'gpt-4o', name: 'GPT-4o', credits: 5 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', credits: 1 },
];

const LEMONADE_EDITOR_TOOL_NAMES = new Set([
  'getTimelineState',
  'getClipDetails',
  'getClipsInTimeRange',
  'selectClips',
  'clearSelection',
  'setPlayhead',
  'setInOutPoints',
  'splitClip',
  'deleteClip',
  'moveClip',
  'trimClip',
  'cutRangesFromClip',
  'getMediaItems',
  'setTransform',
  'listEffects',
  'addEffect',
  'updateEffect',
  'undo',
  'redo',
  'play',
  'pause',
]);

const LEMONADE_EDITOR_TOOLS = AI_TOOLS.filter((tool) => LEMONADE_EDITOR_TOOL_NAMES.has(tool.function.name));
const LEMONADE_CHAT_TIMEOUT_MS = 45_000;
const LEMONADE_TOOL_FOLLOWUP_TIMEOUT_MS = 12_000;
const LEMONADE_STREAM_IDLE_TIMEOUT_MS = 12_000;
const LEMONADE_MAX_COMPLETION_TOKENS = 512;
const LEMONADE_MAX_TOOL_RESULT_MESSAGE_CHARS = 2_000;

function getLemonadeModelOptions(
  availableModels: LemonadeModelInfo[],
  selectedModel: string,
): Array<{ id: string; name: string; description?: string; available: boolean }> {
  if (availableModels.length > 0) {
    return availableModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      available: true,
    }));
  }

  const options = new Map<string, { id: string; name: string; description?: string; available: boolean }>();

  for (const preset of LEMONADE_MODEL_PRESETS) {
    options.set(preset.id, {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      available: false,
    });
  }

  for (const model of availableModels) {
    options.set(model.id, {
      id: model.id,
      name: model.name || model.id,
      available: true,
    });
  }

  if (selectedModel && !options.has(selectedModel)) {
    options.set(selectedModel, {
      id: selectedModel,
      name: selectedModel,
      available: false,
    });
  }

  return Array.from(options.values());
}

// System prompt for editor mode
const EDITOR_SYSTEM_PROMPT = `You are an AI video editing assistant with direct access to the timeline AND media panel. You can:

TIMELINE:
- View and analyze the timeline state (tracks, clips, playhead position)
- Get detailed clip information including analysis data and transcripts
- Split, delete, move, and trim clips
- Create and manage video/audio tracks
- Start analysis and transcription for clips
- Capture frames and create preview grids to evaluate cuts
- Find silent sections in clips based on transcripts

MEDIA PANEL:
- View all media items (files, compositions, folders)
- Create and organize folders
- Rename and delete items
- Move items between folders
- Create new compositions

YOUTUBE / DOWNLOADS:
- Search YouTube for videos by keyword (requires YouTube API key)
- List available download formats/qualities for any video URL
- Download videos and import them directly into the timeline
- View videos already in the Downloads panel
- Supported platforms: YouTube, TikTok, Instagram, Twitter/X, Vimeo, and more (via yt-dlp)
- Downloads require the Native Helper application to be running
- When the user asks for a video on a TOPIC (e.g. "download a jungle video"), ALWAYS use searchYouTube first to find real videos, then download from the results. NEVER make up or guess URLs.

CRITICAL RULES - FOLLOW EXACTLY:
1. ALWAYS assume the user means the CURRENTLY SELECTED CLIP. Never ask "which clip?" - just use the selected one.
2. ONLY work within the VISIBLE RANGE of the clip on the timeline (from clip.startTime to clip.startTime + clip.duration).
   - Analysis data covers the full source file, but the tools automatically FILTER to only the visible/trimmed portion.
3. DO NOT ask for clarification. Make reasonable assumptions and proceed with the action.
4. When removing MULTIPLE sections (like all low-focus parts), ALWAYS use cutRangesFromClip with the sections array from findLowQualitySections. NEVER use multiple individual splitClip calls - they will fail because clip IDs change after each split.
5. Be precise with time values - they are in seconds.
6. The cutRangesFromClip tool handles everything automatically: sorting end-to-start, finding clips by position, and deleting the unwanted sections.
7. When performing multiple editing operations (splits, deletes, moves, trims), ALWAYS use executeBatch to combine them into a single action. This is much faster than calling tools individually and creates a single undo point.
8. The timeline state is already included in this prompt — do NOT call getTimelineState unless you specifically need updated clip IDs after performing edits.
9. For splitting clips into equal parts, use splitClipEvenly. For splitting at specific times, use splitClipAtTimes. These are much faster than executeBatch with individual splitClip calls.
10. For reordering/shuffling clips, use reorderClips with the clip IDs in the desired order. This is much faster and more reliable than executeBatch with multiple moveClip calls.
11. After receiving tool results, always provide a concise human-readable follow-up. Do not stop after a tool call.

CUT EVALUATION WORKFLOW:
- Use getCutPreviewQuad(cutTime) to see 4 frames before and 4 frames after a potential cut point
- This helps evaluate if a cut will look smooth (similar frames = good) or jarring (big jump = maybe bad)
- Use getFramesAtTimes([...times]) to capture specific moments for comparison`;

const LEMONADE_EDITOR_SYSTEM_PROMPT = `You are a local AI video editing assistant.
Use the provided tools to inspect and edit the timeline.
Prefer the selected clip. If clip IDs are unclear, inspect the timeline first.
Use seconds for all time values.
After every tool result, answer briefly with what you did or found.`;

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolName?: string;
  isToolResult?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface APIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

interface ExecutedToolResult {
  result: { success: boolean; data?: unknown; error?: string };
  toolName: string;
}

type SelectorMenu = 'provider' | 'model' | null;

const MAX_TOOL_RESULT_MESSAGE_CHARS = 12000;
const MAX_TOOL_RESULT_ARRAY_ITEMS = 20;
const MAX_TOOL_RESULT_OBJECT_KEYS = 30;
const MAX_TOOL_RESULT_STRING_CHARS = 1200;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated]`;
}

function summarizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return truncateText(value, MAX_TOOL_RESULT_STRING_CHARS);
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (depth >= 3) {
    return '[truncated nested value]';
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_TOOL_RESULT_ARRAY_ITEMS)
      .map((item) => summarizeToolResultValue(item, depth + 1));

    if (value.length > MAX_TOOL_RESULT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_TOOL_RESULT_ARRAY_ITEMS} more items truncated]`);
    }

    return items;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const summary: Record<string, unknown> = {};

    for (const [key, nestedValue] of entries.slice(0, MAX_TOOL_RESULT_OBJECT_KEYS)) {
      summary[key] = summarizeToolResultValue(nestedValue, depth + 1);
    }

    if (entries.length > MAX_TOOL_RESULT_OBJECT_KEYS) {
      summary.__truncatedKeys = entries.length - MAX_TOOL_RESULT_OBJECT_KEYS;
    }

    return summary;
  }

  return String(value);
}

function formatToolResultForApi(
  result: { success: boolean; data?: unknown; error?: string },
  maxLength = MAX_TOOL_RESULT_MESSAGE_CHARS,
): string {
  const serialized = JSON.stringify(result);

  if (serialized.length <= maxLength) {
    return serialized;
  }

  const summarized = JSON.stringify({
    data: summarizeToolResultValue(result.data),
    error: result.error ?? null,
    success: result.success,
    truncated: true,
  });

  if (summarized.length <= maxLength) {
    return summarized;
  }

  return JSON.stringify({
    error: result.error ?? null,
    preview: truncateText(serialized, Math.max(256, maxLength - 128)),
    success: result.success,
    truncated: true,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { error?: unknown; message?: unknown };

    if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
      return candidate.message;
    }

    if (typeof candidate.error === 'string' && candidate.error.trim().length > 0) {
      return candidate.error;
    }
  }

  return 'Failed to send message';
}

function getNumericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatSecondsForChat(value: unknown): string | null {
  const seconds = getNumericValue(value);
  if (seconds === null) {
    return null;
  }

  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 2)}s`;
}

function summarizeTimelineToolResult(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const timeline = data as {
    duration?: unknown;
    playheadPosition?: unknown;
    selectedClipIds?: unknown;
    totalClips?: unknown;
  };
  const parts: string[] = [];
  const clipCount = getNumericValue(timeline.totalClips);
  const duration = formatSecondsForChat(timeline.duration);
  const playhead = formatSecondsForChat(timeline.playheadPosition);
  const selectedCount = Array.isArray(timeline.selectedClipIds) ? timeline.selectedClipIds.length : null;

  if (clipCount !== null) {
    parts.push(`${clipCount} clip${clipCount === 1 ? '' : 's'}`);
  }
  if (duration) {
    parts.push(`${duration} duration`);
  }
  if (playhead) {
    parts.push(`playhead at ${playhead}`);
  }
  if (selectedCount !== null) {
    parts.push(`${selectedCount} selected`);
  }

  return parts.length > 0 ? `I checked the timeline: ${parts.join(', ')}.` : null;
}

function summarizeMediaToolResult(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const media = data as { items?: unknown; files?: unknown; folders?: unknown };
  const itemCount = Array.isArray(media.items)
    ? media.items.length
    : Array.isArray(media.files)
      ? media.files.length
      : null;
  const folderCount = Array.isArray(media.folders) ? media.folders.length : null;

  if (itemCount === null && folderCount === null) {
    return null;
  }

  const parts: string[] = [];
  if (itemCount !== null) {
    parts.push(`${itemCount} item${itemCount === 1 ? '' : 's'}`);
  }
  if (folderCount !== null) {
    parts.push(`${folderCount} folder${folderCount === 1 ? '' : 's'}`);
  }

  return `I checked the media panel: ${parts.join(', ')}.`;
}

function formatToolFollowupFallback(executedToolResults: ExecutedToolResult[]): string {
  const lastToolResult = executedToolResults[executedToolResults.length - 1];

  if (!lastToolResult) {
    return 'The local model did not return a response.';
  }

  if (!lastToolResult.result.success) {
    return `The ${lastToolResult.toolName} tool failed: ${lastToolResult.result.error || 'Unknown error'}.`;
  }

  if (lastToolResult.toolName === 'getTimelineState') {
    return summarizeTimelineToolResult(lastToolResult.result.data)
      || 'I checked the timeline. The local model did not return a follow-up answer.';
  }

  if (lastToolResult.toolName === 'getMediaItems') {
    return summarizeMediaToolResult(lastToolResult.result.data)
      || 'I checked the media panel. The local model did not return a follow-up answer.';
  }

  const toolNames = Array.from(new Set(executedToolResults.map((entry) => entry.toolName)));
  return `Done. I ran ${toolNames.join(', ')}.`;
}

function buildSystemPromptForApi(prompt: string): string {
  return `${prompt.trim()}\n\nCurrent timeline summary: ${getQuickTimelineSummary()}`;
}

function createHostedPromptIdempotencyKey(): string {
  return `hosted-chat:${Date.now()}:${crypto.randomUUID()}`;
}

function sanitizeConversationHistory(messages: Message[]): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
    return messages.slice(0, -1);
  }

  let cursor = messages.length - 1;

  while (cursor >= 0 && messages[cursor].role === 'tool') {
    cursor -= 1;
  }

  if (cursor >= 0) {
    const candidate = messages[cursor];
    if (candidate.role === 'assistant' && candidate.toolCalls && candidate.toolCalls.length > 0) {
      return messages.slice(0, cursor);
    }
  }

  return messages;
}

function shouldRequireConfirmation(
  policy: ToolPolicyEntry | undefined,
  approvalMode: 'auto' | 'confirm-destructive' | 'confirm-all-mutating',
): boolean {
  if (!policy) return true; // unknown tools require confirmation
  if (approvalMode === 'auto') return false;
  if (approvalMode === 'confirm-destructive') {
    return policy.requiresConfirmation || policy.riskLevel === 'high' ||
      policy.localFileAccess || policy.sensitiveDataAccess;
  }
  // confirm-all-mutating
  return !policy.readOnly;
}

function parseChatCompletionPayload(data: unknown): {
  content: string | null;
  toolCalls: ToolCall[];
} {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const choice = payload.choices?.[0];

  return {
    content: choice?.message?.content || null,
    toolCalls: (choice?.message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
  };
}

export function AIChatPanel() {
  const {
    apiKeys,
    openSettings,
    aiApprovalMode,
    aiProvider,
    aiSystemPromptOverrides,
    lemonadeEndpoint,
    lemonadeModel,
    setAiProvider,
    setAiSystemPromptOverride,
    setLemonadeModel,
  } = useSettingsStore();
  const hasSeenAIChatOnboarding = useSettingsStore((s) => s.hasSeenAIChatOnboarding);
  const setHasSeenAIChatOnboarding = useSettingsStore((s) => s.setHasSeenAIChatOnboarding);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const accountSession = useAccountStore((s) => s.session);
  const loadAccountState = useAccountStore((s) => s.loadAccountState);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const openAccountDialog = useAccountStore((s) => s.openAccountDialog);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('gpt-5.1');
  const [lemonadeStatus, setLemonadeStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(true); // Enable tools by default
  const [currentToolAction, setCurrentToolAction] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [onboardingClosing, setOnboardingClosing] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptNameDraft, setPromptNameDraft] = useState('');
  const [savedPromptFiles, setSavedPromptFiles] = useState<SavedAiSystemPrompt[]>([]);
  const [selectedPromptFile, setSelectedPromptFile] = useState('');
  const [promptDialogError, setPromptDialogError] = useState<string | null>(null);
  const [promptDialogStatus, setPromptDialogStatus] = useState<string | null>(null);
  const [isPromptLibraryLoading, setIsPromptLibraryLoading] = useState(false);
  const [openSelectorMenu, setOpenSelectorMenu] = useState<SelectorMenu>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptFileInputRef = useRef<HTMLInputElement>(null);
  const selectorMenuRef = useRef<HTMLDivElement>(null);
  const shouldRefocusInputAfterLoadingRef = useRef(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentToolAction]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        shouldRefocusInputAfterLoadingRef.current = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isLoading]);

  useEffect(() => {
    if (!openSelectorMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!selectorMenuRef.current?.contains(event.target as Node)) {
        setOpenSelectorMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSelectorMenu(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openSelectorMenu]);

  useEffect(() => {
    if (aiProvider !== 'lemonade') {
      return;
    }

    let cancelled = false;
    setLemonadeStatus('checking');

    void checkLemonadeHealth(lemonadeEndpoint).then((health) => {
      if (cancelled) {
        return;
      }

      setLemonadeModels(health.models);
      setLemonadeStatus(health.available ? 'online' : 'offline');
    });

    return () => {
      cancelled = true;
    };
  }, [aiProvider, lemonadeEndpoint]);

  const hasHostedAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const hasApiKey = !!apiKeys.openai;
  const openAiAccessMode: 'hosted' | 'byo' | 'none' = hasHostedAccess ? 'hosted' : hasApiKey ? 'byo' : 'none';
  const accessMode: 'hosted' | 'byo' | 'lemonade' | 'none' =
    aiProvider === 'lemonade'
      ? (lemonadeStatus === 'online' ? 'lemonade' : 'none')
      : openAiAccessMode;
  const hasAccess = accessMode !== 'none';
  const lemonadeModelOptions = getLemonadeModelOptions(lemonadeModels, lemonadeModel);
  const configuredLemonadeModel = lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL;
  const activeLemonadeModel = lemonadeModelOptions.some((option) => option.id === configuredLemonadeModel)
    ? configuredLemonadeModel
    : lemonadeModelOptions[0]?.id || configuredLemonadeModel;
  const accessLabel = accessMode === 'hosted'
    ? 'Cloud'
    : accessMode === 'byo'
      ? 'OpenAI key'
      : accessMode === 'lemonade'
        ? 'Local'
        : 'Locked';
  const activeModelName = aiProvider === 'lemonade'
    ? lemonadeModelOptions.find((option) => option.id === activeLemonadeModel)?.name || activeLemonadeModel
    : OPENAI_MODELS.find((option) => option.id === model)?.name || model;
  const activeProviderName = aiProvider === 'lemonade' ? 'Lemonade' : 'OpenAI';
  const activeProviderFullName = aiProvider === 'lemonade' ? 'Lemonade Local' : 'OpenAI / Cloud';
  const activeModelId = aiProvider === 'lemonade' ? activeLemonadeModel : model;
  const modelMenuOptions = aiProvider === 'lemonade'
    ? lemonadeModelOptions.map((option) => ({
      id: option.id,
      label: option.available ? option.name : `${option.name} (preset)`,
      meta: option.available ? 'loaded' : 'preset',
      disabled: false,
    }))
    : OPENAI_MODELS.map((option) => ({
      id: option.id,
      label: option.name,
      meta: option.credits === 1 ? '1 credit' : `${option.credits} credits`,
      disabled: false,
    }));
  const modelMenuDisabled = isLoading || (aiProvider === 'lemonade' && lemonadeModelOptions.length === 0);
  const defaultSystemPrompt = aiProvider === 'lemonade'
    ? LEMONADE_EDITOR_SYSTEM_PROMPT
    : EDITOR_SYSTEM_PROMPT;
  const activeSystemPrompt = aiSystemPromptOverrides[aiProvider]?.trim()
    ? aiSystemPromptOverrides[aiProvider]!
    : defaultSystemPrompt;
  const promptHasOverride = Boolean(aiSystemPromptOverrides[aiProvider]?.trim());
  const projectPromptStorageReady = isProjectPromptStorageAvailable();

  // Build API messages from chat history
  const buildAPIMessages = useCallback((userContent: string): APIMessage[] => {
    const apiMessages: APIMessage[] = [];
    const safeMessages = sanitizeConversationHistory(messages);
    const includeHistory = aiProvider !== 'lemonade' || !editorMode;

    // Add system prompt in editor mode
    if (editorMode) {
      apiMessages.push({
        role: 'system',
        content: buildSystemPromptForApi(activeSystemPrompt),
      });
    }

    // Add conversation history
    if (includeHistory) {
      for (const msg of safeMessages) {
        if (msg.role === 'user') {
          apiMessages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          if (aiProvider === 'lemonade' && msg.toolCalls && msg.toolCalls.length > 0) {
            continue;
          }

          if (msg.toolCalls && msg.toolCalls.length > 0) {
            apiMessages.push({
              role: 'assistant',
              content: msg.content || null,
              tool_calls: msg.toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            });
          } else {
            apiMessages.push({ role: 'assistant', content: msg.content });
          }
        } else if (msg.role === 'tool' && msg.toolName) {
          if (aiProvider === 'lemonade') {
            continue;
          }

          apiMessages.push({
            role: 'tool',
            content: msg.content,
            tool_call_id: msg.id,
          });
        }
      }
    }

    // Add new user message
    apiMessages.push({ role: 'user', content: userContent });

    return apiMessages;
  }, [messages, editorMode, activeSystemPrompt, aiProvider]);

  // Call OpenAI API
  const callOpenAI = useCallback(async (
    apiMessages: APIMessage[],
    idempotencyKey?: string,
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
  }> => {
    // Newer models (GPT-5.x, o3, o4) use max_completion_tokens instead of max_tokens
    const isNewerModel = model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4');

    const requestBody: Record<string, unknown> = {
      model,
      messages: apiMessages,
      ...(isNewerModel
        ? { max_completion_tokens: 4096 }
        : { max_tokens: 4096 }),
    };

    // Add tools in editor mode
    if (editorMode) {
      requestBody.tools = AI_TOOLS;
      requestBody.tool_choice = 'auto';
    }

    if (accessMode === 'hosted') {
      if (idempotencyKey) {
        requestBody.idempotencyKey = idempotencyKey;
      }

      return parseChatCompletionPayload(await cloudAiService.createChatCompletion(requestBody));
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeys.openai}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    return parseChatCompletionPayload(await response.json());
  }, [accessMode, model, editorMode, apiKeys.openai]);

  const callLemonade = useCallback(async (
    apiMessages: APIMessage[],
    onContentDelta?: (delta: string) => void,
    options?: {
      allowTools?: boolean;
      streamIdleTimeoutMs?: number;
      timeoutMs?: number;
    },
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
  }> => createLemonadeChatCompletionStream({
    endpoint: lemonadeEndpoint,
    model: activeLemonadeModel,
    messages: apiMessages,
    tools: editorMode && options?.allowTools !== false ? LEMONADE_EDITOR_TOOLS : undefined,
    maxTokens: LEMONADE_MAX_COMPLETION_TOKENS,
    onContentDelta,
    streamIdleTimeoutMs: options?.streamIdleTimeoutMs ?? LEMONADE_STREAM_IDLE_TIMEOUT_MS,
    timeoutMs: options?.timeoutMs ?? LEMONADE_CHAT_TIMEOUT_MS,
  }), [activeLemonadeModel, editorMode, lemonadeEndpoint]);

  // Send message to the selected AI provider (with tool calling loop)
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !hasAccess || isLoading) return;

    const userContent = input.trim();
    const transientMessageIds = new Set<string>();
    const executedToolResults: ExecutedToolResult[] = [];
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsLoading(true);
    shouldRefocusInputAfterLoadingRef.current = true;

    try {
      const apiMessages = buildAPIMessages(userContent);
      const hostedPromptIdempotencyKey = accessMode === 'hosted'
        ? createHostedPromptIdempotencyKey()
        : undefined;
      let iterationCount = 0;
      const maxIterations = 50; // Safety limit for tool iterations

      while (iterationCount < maxIterations) {
        iterationCount++;

        let content: string | null;
        let toolCalls: ToolCall[];
        let streamedAssistantMessageId: string | null = null;

        if (aiProvider === 'lemonade') {
          const assistantMessageId = `assistant-${Date.now()}-${iterationCount}`;
          streamedAssistantMessageId = assistantMessageId;
          transientMessageIds.add(assistantMessageId);
          let streamedContent = '';
          const hasToolContext = executedToolResults.length > 0;

          setMessages(prev => [...prev, {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date(),
          }]);
          setStreamingMessageId(assistantMessageId);

          let result: { content: string | null; toolCalls: ToolCall[] };

          try {
            result = await callLemonade(apiMessages, (delta) => {
              streamedContent += delta;
              setMessages(prev => prev.map((message) => (
                message.id === assistantMessageId
                  ? { ...message, content: streamedContent }
                  : message
              )));
            }, {
              allowTools: !hasToolContext,
              streamIdleTimeoutMs: LEMONADE_STREAM_IDLE_TIMEOUT_MS,
              timeoutMs: hasToolContext ? LEMONADE_TOOL_FOLLOWUP_TIMEOUT_MS : LEMONADE_CHAT_TIMEOUT_MS,
            });
          } catch (lemonadeError) {
            if (!hasToolContext && editorMode && streamedContent.length === 0) {
              result = await callLemonade(apiMessages, (delta) => {
                streamedContent += delta;
                setMessages(prev => prev.map((message) => (
                  message.id === assistantMessageId
                    ? { ...message, content: streamedContent }
                    : message
                )));
              }, {
                allowTools: false,
                streamIdleTimeoutMs: LEMONADE_STREAM_IDLE_TIMEOUT_MS,
                timeoutMs: LEMONADE_CHAT_TIMEOUT_MS,
              });
            } else if (!hasToolContext) {
              throw lemonadeError;
            } else {
              result = {
                content: formatToolFollowupFallback(executedToolResults),
                toolCalls: [],
              };
            }
          }

          setStreamingMessageId(null);
          content = result.content || (hasToolContext ? formatToolFollowupFallback(executedToolResults) : null);
          toolCalls = result.toolCalls;

          if (content !== streamedContent) {
            setMessages(prev => prev.map((message) => (
              message.id === assistantMessageId
                ? { ...message, content: content || '' }
                : message
            )));
          }
        } else {
          const result = await callOpenAI(apiMessages, hostedPromptIdempotencyKey);
          content = result.content;
          toolCalls = result.toolCalls;
        }

        if (toolCalls.length === 0) {
          const finalContent = content || (executedToolResults.length > 0
            ? formatToolFollowupFallback(executedToolResults)
            : null);

          // No tool calls - add final assistant message
          if (streamedAssistantMessageId) {
            if (finalContent) {
              if (finalContent !== content) {
                setMessages(prev => prev.map((message) => (
                  message.id === streamedAssistantMessageId
                    ? { ...message, content: finalContent }
                    : message
                )));
              }
              transientMessageIds.delete(streamedAssistantMessageId);
            } else {
              setMessages(prev => prev.filter((message) => message.id !== streamedAssistantMessageId));
            }
          } else if (finalContent) {
            const assistantMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: finalContent,
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMessage]);
          }
          break;
        }

        // Handle tool calls
        const assistantMessage: Message = {
          id: streamedAssistantMessageId || `assistant-${Date.now()}-${iterationCount}`,
          role: 'assistant',
          content: content || '',
          timestamp: new Date(),
          toolCalls,
        };
        if (streamedAssistantMessageId) {
          setMessages(prev => prev.map((message) => (
            message.id === streamedAssistantMessageId ? assistantMessage : message
          )));
        } else {
          transientMessageIds.add(assistantMessage.id);
          setMessages(prev => [...prev, assistantMessage]);
        }

        // Add assistant message to API messages
        apiMessages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Execute each tool call
        // IMPORTANT: Always add a tool result for every tool_call to keep
        // the conversation valid for the OpenAI API. If a tool crashes,
        // we still send an error result back.
        for (const toolCall of toolCalls) {
          setCurrentToolAction(`Executing: ${toolCall.name}`);

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.arguments);
          } catch {
            args = {};
          }

          // Check if this tool requires user confirmation
          const policy = getToolPolicy(toolCall.name);
          const needsConfirmation = shouldRequireConfirmation(policy, aiApprovalMode);

          let result: { success: boolean; data?: unknown; error?: string };

          if (needsConfirmation) {
            // Show confirmation UI and wait for user response
            const approved = await new Promise<boolean>((resolve) => {
              setPendingApproval({ toolName: toolCall.name, args, resolve });
            });
            setPendingApproval(null);

            if (!approved) {
              result = { success: false, error: 'User denied tool execution' };
            } else {
              try {
                result = await executeAITool(toolCall.name, args, 'chat');
              } catch (toolErr) {
                result = { success: false, error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
              }
            }
          } else {
            try {
              result = await executeAITool(toolCall.name, args, 'chat');
            } catch (toolErr) {
              result = { success: false, error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
            }
          }

          const toolResultMessage: Message = {
            id: toolCall.id,
            role: 'tool',
            content: JSON.stringify(result, null, 2),
            timestamp: new Date(),
            toolName: toolCall.name,
            isToolResult: true,
          };
          transientMessageIds.add(toolResultMessage.id);
          executedToolResults.push({ toolName: toolCall.name, result });
          setMessages(prev => [...prev, toolResultMessage]);

          // Add tool result to API messages
          apiMessages.push({
            role: 'tool',
            content: formatToolResultForApi(
              result,
              aiProvider === 'lemonade'
                ? LEMONADE_MAX_TOOL_RESULT_MESSAGE_CHARS
                : MAX_TOOL_RESULT_MESSAGE_CHARS,
            ),
            tool_call_id: toolCall.id,
          });
        }

        setCurrentToolAction(null);
      }

      if (iterationCount >= maxIterations) {
        setError('Too many tool iterations - stopping to prevent infinite loop');
      }
    } catch (err) {
      setStreamingMessageId(null);
      setMessages((prev) => sanitizeConversationHistory(
        prev.filter((message) => !transientMessageIds.has(message.id)),
      ));
      setError(getErrorMessage(err));
    } finally {
      if (accessMode === 'hosted') {
        void loadAccountState();
      }
      setIsLoading(false);
      setCurrentToolAction(null);
      setStreamingMessageId(null);
      window.setTimeout(() => {
        if (shouldRefocusInputAfterLoadingRef.current) {
          inputRef.current?.focus();
        }
        shouldRefocusInputAfterLoadingRef.current = false;
      }, 0);
    }
  }, [input, hasAccess, isLoading, buildAPIMessages, accessMode, aiProvider, callLemonade, callOpenAI, aiApprovalMode, editorMode, loadAccountState]);

  // Handle key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isLoading) {
        return;
      }

      e.preventDefault();
      sendMessage();
    }
  }, [isLoading, sendMessage]);

  // Clear chat
  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Dismiss AI chat onboarding
  const dismissOnboarding = useCallback(() => {
    setOnboardingClosing(true);
    setTimeout(() => {
      setHasSeenAIChatOnboarding(true);
    }, 300);
  }, [setHasSeenAIChatOnboarding]);

  const selectProvider = useCallback((provider: AIProvider) => {
    setAiProvider(provider);
    setOpenSelectorMenu(null);
  }, [setAiProvider]);

  const selectModel = useCallback((modelId: string) => {
    if (aiProvider === 'lemonade') {
      setLemonadeModel(modelId);
    } else {
      setModel(modelId);
    }
    setOpenSelectorMenu(null);
  }, [aiProvider, setLemonadeModel]);

  const refreshSavedPromptFiles = useCallback(async () => {
    setIsPromptLibraryLoading(true);
    setPromptDialogError(null);

    try {
      const prompts = await listProjectSystemPrompts(aiProvider);
      setSavedPromptFiles(prompts);
      setSelectedPromptFile((current) => (
        prompts.some((prompt) => prompt.fileName === current)
          ? current
          : prompts[0]?.fileName || ''
      ));
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [aiProvider]);

  const openPromptDialog = useCallback(() => {
    setPromptDraft(activeSystemPrompt);
    setPromptNameDraft(getDefaultProjectPromptName(aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptDialogOpen(true);
    void refreshSavedPromptFiles();
  }, [activeSystemPrompt, aiProvider, refreshSavedPromptFiles]);

  const savePromptDialog = useCallback(async () => {
    if (!promptDraft.trim()) {
      return;
    }

    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      const savedPrompt = await saveProjectSystemPrompt(aiProvider, promptNameDraft, promptDraft);
      const nextPrompt = promptDraft.trim() === defaultSystemPrompt.trim() ? '' : promptDraft;
      setAiSystemPromptOverride(aiProvider, nextPrompt);
      setPromptNameDraft(savedPrompt.name);
      setSelectedPromptFile(savedPrompt.fileName);
      setPromptDialogStatus('Saved to project.');
      await refreshSavedPromptFiles();
      setSelectedPromptFile(savedPrompt.fileName);
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [
    aiProvider,
    defaultSystemPrompt,
    promptDraft,
    promptNameDraft,
    refreshSavedPromptFiles,
    setAiSystemPromptOverride,
  ]);

  const loadSelectedProjectPrompt = useCallback(async () => {
    if (!selectedPromptFile) {
      return;
    }

    setPromptDialogError(null);
    setPromptDialogStatus(null);
    setIsPromptLibraryLoading(true);

    try {
      const loadedPrompt = await loadProjectSystemPrompt(selectedPromptFile);
      const nextPrompt = loadedPrompt.prompt.trim() === defaultSystemPrompt.trim() ? '' : loadedPrompt.prompt;
      setPromptDraft(loadedPrompt.prompt);
      setPromptNameDraft(loadedPrompt.name);
      setAiSystemPromptOverride(loadedPrompt.provider, nextPrompt);
      setPromptDialogStatus('Loaded and applied.');
    } catch (promptError) {
      setPromptDialogError(getErrorMessage(promptError));
    } finally {
      setIsPromptLibraryLoading(false);
    }
  }, [defaultSystemPrompt, selectedPromptFile, setAiSystemPromptOverride]);

  const resetPromptDraft = useCallback(() => {
    setPromptDraft(defaultSystemPrompt);
    setPromptNameDraft(getDefaultProjectPromptName(aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus(null);
  }, [aiProvider, defaultSystemPrompt]);

  const exportPromptDraft = useCallback(() => {
    const blob = new Blob([promptDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `masterselects-${aiProvider}-system-prompt.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [aiProvider, promptDraft]);

  const loadPromptFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setPromptDraft(await file.text());
    setPromptNameDraft(normalizeProjectPromptName(file.name.replace(/\.[^.]+$/, ''), aiProvider));
    setPromptDialogError(null);
    setPromptDialogStatus('Imported. Save to project.');
    event.target.value = '';
  }, [aiProvider]);

  return (
    <div ref={panelRef} className={`ai-chat-panel ${!hasAccess ? 'no-api-key' : ''}`}>
      {/* AI access overlay */}
      {!hasAccess && (
        <div className="ai-panel-overlay">
          <div className="ai-panel-overlay-content">
            <span className="no-key-icon">🔑</span>
            <p>
              {aiProvider === 'lemonade'
                ? (lemonadeStatus === 'checking' ? 'Checking Lemonade' : 'Lemonade is not ready')
                : 'Choose an AI provider'}
            </p>
            <span className="ai-panel-overlay-subtext">
              {aiProvider === 'lemonade'
                ? `Load a local model in Lemonade, then retry ${lemonadeEndpoint || DEFAULT_LEMONADE_ENDPOINT}.`
                : 'Use a local Lemonade model, sign in for Cloud, or add your own OpenAI key.'}
            </span>
            <div className="ai-panel-overlay-actions">
              {aiProvider === 'lemonade' ? (
                <>
                  <button className="btn-settings primary" onClick={openSettings}>
                    Settings
                  </button>
                  <button className="btn-settings secondary" onClick={() => setAiProvider('openai')}>
                    Use OpenAI
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-settings primary" onClick={() => setAiProvider('lemonade')}>
                    Use Lemonade
                  </button>
                  {!accountSession?.authenticated ? (
                    <button className="btn-settings secondary" onClick={openAuthDialog}>
                      Sign in
                    </button>
                  ) : (
                    <button className="btn-settings secondary" onClick={openPricingDialog}>
                      View plans
                    </button>
                  )}
                  {accountSession?.authenticated && (
                    <button className="btn-settings ghost" onClick={openAccountDialog}>
                      Account
                    </button>
                  )}
                  <button className="btn-settings ghost" onClick={openSettings}>
                    API Keys
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="ai-chat-header">
        <div className="ai-chat-title-group">
          <h2>AI Editor</h2>
          <span className={`ai-access-chip ${accessMode}`}>
            {accessLabel}
          </span>
        </div>
        <div className="ai-chat-controls">
          <div className="ai-selector-group" ref={selectorMenuRef}>
            <div className="ai-selector">
              <button
                className={`ai-selector-trigger ${openSelectorMenu === 'provider' ? 'active' : ''}`}
                onClick={() => setOpenSelectorMenu((current) => current === 'provider' ? null : 'provider')}
                disabled={isLoading}
                title={activeProviderFullName}
                aria-haspopup="menu"
                aria-expanded={openSelectorMenu === 'provider'}
              >
                <span className="ai-selector-value">{activeProviderName}</span>
                <span className="ai-selector-caret" aria-hidden="true" />
              </button>
              {openSelectorMenu === 'provider' && (
                <div className="ai-selector-menu provider-menu" role="menu">
                  <button
                    className={`ai-selector-option ${aiProvider === 'openai' ? 'selected' : ''}`}
                    onClick={() => selectProvider('openai')}
                    role="menuitemradio"
                    aria-checked={aiProvider === 'openai'}
                  >
                    <span className="ai-selector-option-title">OpenAI / Cloud</span>
                    <span className="ai-selector-option-meta">hosted or key</span>
                  </button>
                  <button
                    className={`ai-selector-option ${aiProvider === 'lemonade' ? 'selected' : ''}`}
                    onClick={() => selectProvider('lemonade')}
                    role="menuitemradio"
                    aria-checked={aiProvider === 'lemonade'}
                  >
                    <span className="ai-selector-option-title">Lemonade Local</span>
                    <span className="ai-selector-option-meta">local model</span>
                  </button>
                </div>
              )}
            </div>
            <div className="ai-selector">
              <button
                className={`ai-selector-trigger model-trigger ${openSelectorMenu === 'model' ? 'active' : ''}`}
                onClick={() => setOpenSelectorMenu((current) => current === 'model' ? null : 'model')}
                disabled={modelMenuDisabled}
                title={aiProvider === 'lemonade' && lemonadeModelOptions.length === 0 ? 'No Lemonade models found' : activeModelName}
                aria-haspopup="menu"
                aria-expanded={openSelectorMenu === 'model'}
              >
                <span className="ai-selector-value">{activeModelName}</span>
                <span className="ai-selector-caret" aria-hidden="true" />
              </button>
              {openSelectorMenu === 'model' && (
                <div className="ai-selector-menu model-menu" role="menu">
                  {modelMenuOptions.length === 0 ? (
                    <div className="ai-selector-empty">No Lemonade models found</div>
                  ) : (
                    modelMenuOptions.map((option) => (
                      <button
                        key={option.id}
                        className={`ai-selector-option ${option.id === activeModelId ? 'selected' : ''}`}
                        onClick={() => selectModel(option.id)}
                        disabled={option.disabled}
                        role="menuitemradio"
                        aria-checked={option.id === activeModelId}
                        title={option.label}
                      >
                        <span className="ai-selector-option-title">{option.label}</span>
                        <span className="ai-selector-option-meta">{option.meta}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <label className="editor-mode-toggle" title="Enable timeline editing tools">
            <input
              type="checkbox"
              checked={editorMode}
              onChange={(e) => setEditorMode(e.target.checked)}
              disabled={isLoading}
            />
            <span className="toggle-label">Tools</span>
          </label>
          <button
            className={`btn-prompt ${promptHasOverride ? 'active' : ''}`}
            onClick={openPromptDialog}
            disabled={isLoading}
            title="Edit system prompt"
          >
            Prompt
          </button>
          <button
            className="btn-clear"
            onClick={clearChat}
            disabled={isLoading || messages.length === 0}
            title="Clear chat"
          >
            Clear
          </button>
        </div>
      </div>

      {isPromptDialogOpen && (
        <div className="ai-prompt-dialog-backdrop" onClick={() => setIsPromptDialogOpen(false)}>
          <div className="ai-prompt-dialog" onClick={(event) => event.stopPropagation()}>
            <input
              ref={promptFileInputRef}
              type="file"
              accept=".txt,.md,.prompt,text/plain,text/markdown"
              className="ai-prompt-file-input"
              onChange={loadPromptFile}
            />
            <div className="ai-prompt-dialog-header">
              <div>
                <h3>System Prompt</h3>
                <span>{aiProvider === 'lemonade' ? 'Lemonade Local' : 'OpenAI / Cloud'}</span>
              </div>
              <button
                className="ai-prompt-dialog-close"
                onClick={() => setIsPromptDialogOpen(false)}
                title="Close"
              >
                x
              </button>
            </div>
            <div className="ai-prompt-library">
              <label className="ai-prompt-name-field">
                <span>Name</span>
                <input
                  value={promptNameDraft}
                  onChange={(event) => setPromptNameDraft(event.target.value)}
                  placeholder={getDefaultProjectPromptName(aiProvider)}
                  disabled={isPromptLibraryLoading}
                />
              </label>
              <div className="ai-prompt-load-row">
                <select
                  className="ai-prompt-select"
                  value={selectedPromptFile}
                  onChange={(event) => setSelectedPromptFile(event.target.value)}
                  disabled={!projectPromptStorageReady || isPromptLibraryLoading || savedPromptFiles.length === 0}
                >
                  {savedPromptFiles.length === 0 ? (
                    <option value="">No saved prompts</option>
                  ) : (
                    savedPromptFiles.map((prompt) => (
                      <option key={prompt.fileName} value={prompt.fileName}>
                        {prompt.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  onClick={loadSelectedProjectPrompt}
                  disabled={!selectedPromptFile || isPromptLibraryLoading}
                >
                  Load
                </button>
                <button onClick={refreshSavedPromptFiles} disabled={isPromptLibraryLoading}>
                  Refresh
                </button>
              </div>
              {(promptDialogError || promptDialogStatus || !projectPromptStorageReady) && (
                <div className={`ai-prompt-feedback ${promptDialogError ? 'error' : ''}`}>
                  {promptDialogError || promptDialogStatus || 'Open a project to use saved prompts.'}
                </div>
              )}
            </div>
            <textarea
              className="ai-prompt-textarea"
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              spellCheck={false}
            />
            <div className="ai-prompt-dialog-footer">
              <span className="ai-prompt-status">
                {promptHasOverride ? 'Custom' : 'Default'} - {promptDraft.length} chars
              </span>
              <div className="ai-prompt-actions">
                <button onClick={() => promptFileInputRef.current?.click()} disabled={isPromptLibraryLoading}>
                  Import
                </button>
                <button onClick={exportPromptDraft} disabled={!promptDraft.trim()}>
                  Export
                </button>
                <button onClick={resetPromptDraft} disabled={isPromptLibraryLoading}>
                  Reset
                </button>
                <button onClick={() => setIsPromptDialogOpen(false)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={savePromptDialog}
                  disabled={!promptDraft.trim() || !projectPromptStorageReady || isPromptLibraryLoading}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="ai-chat-messages">
        {messages.length === 0 ? (
          <>
            {/* Onboarding hint — shown once after first login */}
            {hasAccess && !hasSeenAIChatOnboarding && (
              <div className={`ai-chat-onboarding ${onboardingClosing ? 'closing' : ''}`}>
                <div className="ai-chat-onboarding-card">
                  <div className="ai-chat-onboarding-header">
                    <span className="ai-chat-onboarding-icon">AI</span>
                    <h3>Welcome to the AI Editor</h3>
                  </div>
                  <div className="ai-chat-onboarding-body">
                    <p className="ai-chat-onboarding-intro">
                      This AI assistant can directly edit your timeline. Just describe what you want in plain language.
                    </p>
                    <ul className="ai-chat-onboarding-tips">
                      <li><strong>Cut &amp; trim:</strong> "Remove the first 3 seconds" or "Split at 10s"</li>
                      <li><strong>Remove silence:</strong> "Find and remove all silent parts"</li>
                      <li><strong>Analyze:</strong> "What clips are on the timeline?" or "Transcribe this clip"</li>
                      <li><strong>Batch edits:</strong> "Delete all clips shorter than 1 second"</li>
                      <li><strong>Downloads:</strong> "Search YouTube for nature footage and download it"</li>
                    </ul>
                    <p className="ai-chat-onboarding-note">
                      The <strong>Tools</strong> toggle enables timeline editing. Turn it off for a normal chat.
                      Use the approval mode in Settings to control which actions need your confirmation.
                    </p>
                  </div>
                  <button className="ai-chat-onboarding-dismiss" onClick={dismissOnboarding}>
                    Got it
                  </button>
                </div>
              </div>
            )}
            <div className="ai-chat-welcome">
              <p>{editorMode ? 'AI Editor Ready' : 'Start a conversation'}</p>
              <span className="welcome-hint">
                {editorMode
                  ? (aiProvider === 'lemonade'
                    ? `Using local ${activeModelName} with timeline tools`
                    : 'Ask me to edit your timeline - cut clips, remove silence, etc.')
                  : `Using ${activeModelName}`}
              </span>
            </div>
          </>
        ) : (
          messages.map(msg => {
            // Tool result messages - show compact
            if (msg.isToolResult) {
              return (
                <div key={msg.id} className="ai-chat-message tool-result">
                  <div className="tool-result-header">
                    <span className="tool-icon">🔧</span>
                    <span className="tool-name">{msg.toolName}</span>
                  </div>
                  <pre className="tool-result-content">
                    {msg.content.length > 500
                      ? msg.content.substring(0, 500) + '...'
                      : msg.content}
                  </pre>
                </div>
              );
            }

            // Assistant message with tool calls
            if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
              return (
                <div key={msg.id} className="ai-chat-message assistant">
                  <div className="message-header">
                    <span className="message-role">AI</span>
                    <span className="message-time">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {msg.content && (
                    <div className="message-content">
                      {msg.content.split('\n').map((line, i) => (
                        <p key={i}>{line || '\u00A0'}</p>
                      ))}
                    </div>
                  )}
                  <div className="tool-calls">
                    {msg.toolCalls.map(tc => (
                      <div key={tc.id} className="tool-call">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">
                          {tc.arguments.length > 100
                            ? tc.arguments.substring(0, 100) + '...'
                            : tc.arguments}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            // Regular user/assistant message
            return (
              <div key={msg.id} className={`ai-chat-message ${msg.role}`}>
                <div className="message-header">
                  <span className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
                  <span className="message-time">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="message-content">
                  {msg.id === streamingMessageId && msg.content.length === 0 ? (
                    <span className="typing-indicator">
                      <span></span><span></span><span></span>
                    </span>
                  ) : (
                    msg.content.split('\n').map((line, i) => (
                      <p key={i}>{line || '\u00A0'}</p>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
        {pendingApproval && (
          <div className="ai-chat-message tool-approval">
            <div className="tool-approval-banner">
              <span className="tool-approval-label">Confirm action:</span>
              <span className="tool-approval-name">{pendingApproval.toolName}</span>
              <pre className="tool-approval-args">
                {JSON.stringify(pendingApproval.args, null, 2).substring(0, 200)}
              </pre>
              <div className="tool-approval-buttons">
                <button
                  className="btn-approve"
                  onClick={() => pendingApproval.resolve(true)}
                >
                  Allow
                </button>
                <button
                  className="btn-deny"
                  onClick={() => pendingApproval.resolve(false)}
                >
                  Deny
                </button>
              </div>
            </div>
          </div>
        )}
        {isLoading && (currentToolAction || !streamingMessageId) && (
          <div className="ai-chat-message assistant loading">
            <div className="message-header">
              <span className="message-role">AI</span>
            </div>
            <div className="message-content">
              {currentToolAction ? (
                <span className="tool-action">{currentToolAction}</span>
              ) : (
                <span className="typing-indicator">
                  <span></span><span></span><span></span>
                </span>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="ai-chat-error">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="ai-chat-input-area">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={editorMode
            ? "e.g., 'Remove all silent parts' or 'Split clip at 5 seconds'"
            : "Type a message... (Enter to send)"}
          disabled={!hasAccess}
          rows={2}
        />
        <button
          className="btn-send"
          onClick={sendMessage}
          disabled={!input.trim() || isLoading || !hasAccess}
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
