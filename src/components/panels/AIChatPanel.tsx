// AI Chat Panel - Chat interface with timeline editing tools using OpenAI API

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAccountStore } from '../../stores/accountStore';
import { AI_TOOLS, executeAITool, getQuickTimelineSummary, getToolPolicy } from '../../services/aiTools';
import { cloudAiService } from '../../services/cloudAiService';
import type { ToolPolicyEntry } from '../../services/aiTools';
import './AIChatPanel.css';

// Available OpenAI models
const OPENAI_MODELS = [
  // GPT-5.2 series (newest - Dec 2025)
  { id: 'gpt-5.2', name: 'GPT-5.2 (Thinking)' },
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro' },
  // GPT-5.1 series
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
  // GPT-5 series
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano' },
  // Reasoning models
  { id: 'o3', name: 'o3 (Reasoning)' },
  { id: 'o4-mini', name: 'o4-mini (Reasoning)' },
  { id: 'o3-pro', name: 'o3-pro (Deep Reasoning)' },
  // GPT-4.1 series
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
  // GPT-4o series (legacy)
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
];

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

CUT EVALUATION WORKFLOW:
- Use getCutPreviewQuad(cutTime) to see 4 frames before and 4 frames after a potential cut point
- This helps evaluate if a cut will look smooth (similar frames = good) or jarring (big jump = maybe bad)
- Use getFramesAtTimes([...times]) to capture specific moments for comparison

Current timeline summary: `;

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

function formatToolResultForApi(result: { success: boolean; data?: unknown; error?: string }): string {
  const serialized = JSON.stringify(result);

  if (serialized.length <= MAX_TOOL_RESULT_MESSAGE_CHARS) {
    return serialized;
  }

  const summarized = JSON.stringify({
    data: summarizeToolResultValue(result.data),
    error: result.error ?? null,
    success: result.success,
    truncated: true,
  });

  if (summarized.length <= MAX_TOOL_RESULT_MESSAGE_CHARS) {
    return summarized;
  }

  return JSON.stringify({
    error: result.error ?? null,
    preview: truncateText(serialized, MAX_TOOL_RESULT_MESSAGE_CHARS - 128),
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
  const { apiKeys, openSettings, aiApprovalMode } = useSettingsStore();
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
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(true); // Enable tools by default
  const [currentToolAction, setCurrentToolAction] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentToolAction]);

  const hasHostedAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const hasApiKey = !!apiKeys.openai;
  const accessMode: 'hosted' | 'byo' | 'none' = hasHostedAccess ? 'hosted' : hasApiKey ? 'byo' : 'none';
  const hasAccess = accessMode !== 'none';

  // Build API messages from chat history
  const buildAPIMessages = useCallback((userContent: string): APIMessage[] => {
    const apiMessages: APIMessage[] = [];
    const safeMessages = sanitizeConversationHistory(messages);

    // Add system prompt in editor mode
    if (editorMode) {
      apiMessages.push({
        role: 'system',
        content: EDITOR_SYSTEM_PROMPT + getQuickTimelineSummary(),
      });
    }

    // Add conversation history
    for (const msg of safeMessages) {
      if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
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
        apiMessages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.id,
        });
      }
    }

    // Add new user message
    apiMessages.push({ role: 'user', content: userContent });

    return apiMessages;
  }, [messages, editorMode]);

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

  // Send message to OpenAI (with tool calling loop)
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !hasAccess || isLoading) return;

    const userContent = input.trim();
    const transientMessageIds = new Set<string>();
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

    try {
      const apiMessages = buildAPIMessages(userContent);
      const hostedPromptIdempotencyKey = accessMode === 'hosted'
        ? createHostedPromptIdempotencyKey()
        : undefined;
      let iterationCount = 0;
      const maxIterations = 50; // Safety limit for tool iterations

      while (iterationCount < maxIterations) {
        iterationCount++;

        const { content, toolCalls } = await callOpenAI(apiMessages, hostedPromptIdempotencyKey);

        if (toolCalls.length === 0) {
          // No tool calls - add final assistant message
          if (content) {
            const assistantMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content,
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, assistantMessage]);
          }
          break;
        }

        // Handle tool calls
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}-${iterationCount}`,
          role: 'assistant',
          content: content || '',
          timestamp: new Date(),
          toolCalls,
        };
        transientMessageIds.add(assistantMessage.id);
        setMessages(prev => [...prev, assistantMessage]);

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
          setMessages(prev => [...prev, toolResultMessage]);

          // Add tool result to API messages
          apiMessages.push({
            role: 'tool',
            content: formatToolResultForApi(result),
            tool_call_id: toolCall.id,
          });
        }

        setCurrentToolAction(null);
      }

      if (iterationCount >= maxIterations) {
        setError('Too many tool iterations - stopping to prevent infinite loop');
      }
    } catch (err) {
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
    }
  }, [input, hasAccess, isLoading, buildAPIMessages, callOpenAI, aiApprovalMode, accessMode, loadAccountState]);

  // Handle key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // Clear chat
  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <div className={`ai-chat-panel ${!hasAccess ? 'no-api-key' : ''}`}>
      {/* API Key Required Overlay */}
      {!hasAccess && (
        <div className="ai-panel-overlay">
          <div className="ai-panel-overlay-content">
            <span className="no-key-icon">🔑</span>
            <p>{accountSession?.authenticated ? 'Hosted AI chat needs a plan' : 'Sign in for hosted AI chat'}</p>
            <span className="ai-panel-overlay-subtext">
              MasterSelects Cloud is the default path. Advanced users can still add their own OpenAI key.
            </span>
            <div className="ai-panel-overlay-actions">
              {!accountSession?.authenticated ? (
                <button className="btn-settings" onClick={openAuthDialog}>
                  Sign in
                </button>
              ) : (
                <button className="btn-settings" onClick={openPricingDialog}>
                  View plans
                </button>
              )}
              {accountSession?.authenticated && (
                <button className="btn-clear" onClick={openAccountDialog}>
                  Account
                </button>
              )}
              <button className="btn-clear" onClick={openSettings}>
                API Keys
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="ai-chat-header">
        <div className="ai-chat-title-group">
          <h2>AI Editor</h2>
          <span className={`ai-access-chip ${accessMode}`}>
            {accessMode === 'hosted' ? 'Cloud' : accessMode === 'byo' ? 'OpenAI key' : 'Locked'}
          </span>
        </div>
        <div className="ai-chat-controls">
          <label className="editor-mode-toggle" title="Enable timeline editing tools">
            <input
              type="checkbox"
              checked={editorMode}
              onChange={(e) => setEditorMode(e.target.checked)}
              disabled={isLoading}
            />
            <span className="toggle-label">Tools</span>
          </label>
          <select
            className="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isLoading}
          >
            {OPENAI_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
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

      {/* Messages */}
      <div className="ai-chat-messages">
        {messages.length === 0 ? (
          <div className="ai-chat-welcome">
            <p>{editorMode ? 'AI Editor Ready' : 'Start a conversation'}</p>
            <span className="welcome-hint">
              {editorMode
                ? 'Ask me to edit your timeline - cut clips, remove silence, etc.'
                : `Using ${OPENAI_MODELS.find(m => m.id === model)?.name}`}
            </span>
          </div>
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
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i}>{line || '\u00A0'}</p>
                  ))}
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
        {isLoading && (
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
          disabled={isLoading || !hasAccess}
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
