// AI Chat Panel - Chat interface with timeline editing tools using Anthropic Claude API

import { useState, useCallback, useRef, useEffect } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { useSettingsStore } from '../../stores/settingsStore';
import { AI_TOOLS, executeAITool, getQuickTimelineSummary } from '../../services/aiTools';
import type { ToolDefinition } from '../../services/aiTools/types';
import './AIChatPanel.css';

// Available Claude models
const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (Recommended)' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (Most Capable)' },
];

// Convert OpenAI function-calling tool definitions to Anthropic format
function convertToolsForAnthropic(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
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
- Search for videos by keyword via yt-dlp (no API key needed)
- List available download formats/qualities for any video URL
- Download videos and import them directly into the timeline
- View videos already in the Downloads panel
- Supported platforms: YouTube, TikTok, Instagram, Twitter/X, Vimeo, and more (via yt-dlp)
- Downloads require the Native Helper application to be running
- When the user asks for a video on a TOPIC (e.g. "download a jungle video"), ALWAYS use searchYouTube first to find real videos, then download from the results. NEVER make up or guess URLs.

TFE PIPELINE:
- Generate thumbnails and titles using AI
- Generate video clips with Veo (text-to-video, image-to-video)
- Run Mosaic video analysis pipeline
- Trim, concatenate, and process videos with FFmpeg
- Analyze tasks and optimize prompts with Claude
- Run full TFE pipeline jobs
- Check job status for long-running operations

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

// Anthropic message content types
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

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
  input: Record<string, unknown>;
}

export function AIChatPanel() {
  const { apiKeys, openSettings } = useSettingsStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState(true);
  const [currentToolAction, setCurrentToolAction] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentToolAction]);

  // Check if API key is available
  const hasApiKey = !!apiKeys.anthropic;

  // Build Anthropic messages from chat history
  const buildAnthropicMessages = useCallback((userContent: string): AnthropicMessage[] => {
    const anthropicMessages: AnthropicMessage[] = [];

    // Convert conversation history
    for (const msg of messages) {
      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: AnthropicContentBlock[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
          }
          anthropicMessages.push({ role: 'assistant', content });
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool' && msg.toolName) {
        // Anthropic: tool results go in a 'user' message with tool_result blocks
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.id,
            content: msg.content,
          }],
        });
      }
    }

    // Add new user message
    anthropicMessages.push({ role: 'user', content: userContent });

    return anthropicMessages;
  }, [messages]);

  // Call Claude API
  const callClaude = useCallback(async (anthropicMessages: AnthropicMessage[]): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
    rawContent: AnthropicContentBlock[];
  }> => {
    // ローカル使用専用。APIキーがブラウザに露出するため、
    // 公開する場合はサーバー側プロキシ経由に変更すること
    const client = new Anthropic({
      apiKey: apiKeys.anthropic,
      dangerouslyAllowBrowser: true,
    });

    const requestParams: Anthropic.MessageCreateParams = {
      model,
      max_tokens: 4096,
      messages: anthropicMessages as Anthropic.MessageParam[],
    };

    // Add system prompt and tools in editor mode
    if (editorMode) {
      requestParams.system = EDITOR_SYSTEM_PROMPT + getQuickTimelineSummary();
      requestParams.tools = convertToolsForAnthropic(AI_TOOLS);
    }

    const response = await client.messages.create(requestParams);

    // Parse response content blocks
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent || null,
      toolCalls,
      rawContent: response.content as AnthropicContentBlock[],
    };
  }, [model, editorMode, apiKeys.anthropic]);

  // Send message to Claude (with tool calling loop)
  const sendMessage = useCallback(async () => {
    if (!input.trim() || !hasApiKey || isLoading) return;

    const userContent = input.trim();
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
      const anthropicMessages = buildAnthropicMessages(userContent);
      let iterationCount = 0;
      const maxIterations = 50; // Safety limit for tool iterations

      while (iterationCount < maxIterations) {
        iterationCount++;

        const { content, toolCalls, rawContent } = await callClaude(anthropicMessages);

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
        setMessages(prev => [...prev, assistantMessage]);

        // Add assistant message to Anthropic messages (preserve raw content blocks)
        anthropicMessages.push({
          role: 'assistant',
          content: rawContent,
        });

        // Execute each tool call and collect results
        const toolResults: AnthropicContentBlock[] = [];

        for (const toolCall of toolCalls) {
          setCurrentToolAction(`Executing: ${toolCall.name}`);

          let result: { success: boolean; data?: unknown; error?: string };
          try {
            result = await executeAITool(toolCall.name, toolCall.input);
          } catch (toolErr) {
            result = { success: false, error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
          }

          const toolResultMessage: Message = {
            id: toolCall.id,
            role: 'tool',
            content: JSON.stringify(result, null, 2),
            timestamp: new Date(),
            toolName: toolCall.name,
            isToolResult: true,
          };
          setMessages(prev => [...prev, toolResultMessage]);

          // Collect tool results for Anthropic API
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        // Add all tool results in a single 'user' message (Anthropic format)
        anthropicMessages.push({
          role: 'user',
          content: toolResults,
        });

        setCurrentToolAction(null);
      }

      if (iterationCount >= maxIterations) {
        setError('Too many tool iterations - stopping to prevent infinite loop');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsLoading(false);
      setCurrentToolAction(null);
    }
  }, [input, hasApiKey, isLoading, buildAnthropicMessages, callClaude]);

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
    <div className={`ai-chat-panel ${!hasApiKey ? 'no-api-key' : ''}`}>
      {/* API Key Required Overlay */}
      {!hasApiKey && (
        <div className="ai-panel-overlay">
          <div className="ai-panel-overlay-content">
            <span className="no-key-icon">🔑</span>
            <p>Anthropic API key required</p>
            <button className="btn-settings" onClick={openSettings}>
              Open Settings
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="ai-chat-header">
        <h2>AI Editor</h2>
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
            {CLAUDE_MODELS.map(m => (
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
                : `Using ${CLAUDE_MODELS.find(m => m.id === model)?.name}`}
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
                          {(() => {
                            const args = JSON.stringify(tc.input);
                            return args.length > 100 ? args.substring(0, 100) + '...' : args;
                          })()}
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
          disabled={isLoading}
          rows={2}
        />
        <button
          className="btn-send"
          onClick={sendMessage}
          disabled={!input.trim() || isLoading}
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
