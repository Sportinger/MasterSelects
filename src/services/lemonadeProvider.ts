// Lemonade Provider
// Interfaces with Lemonade Server (local AI inference) at http://localhost:8000/api/v1
// OpenAI-compatible API for chat completions and tool calling

import { Logger } from './logger';
import type { ToolDefinition } from './aiTools/types';
import { AI_TOOLS } from './aiTools';

const log = Logger.create('LemonadeProvider');

// Lemonade Server endpoint
const DEFAULT_ENDPOINT = 'http://localhost:8000/api/v1';

// Recommended models for different use cases
export const LEMONADE_MODELS = {
  // Primary editing assistant (balanced quality/speed)
  PRIMARY: 'qwen3-4b-FLM',
  // Fast fallback for simple commands
  FAST_FALLBACK: 'Llama-3.2-1B-Instruct-GGUF',
  // High-quality complex reasoning
  HIGH_QUALITY: 'Gemma-3-4b-it-GGUF',
};

// Model presets with descriptions
export const MODEL_PRESETS: Array<{ id: string; name: string; size: string; description: string }> = [
  { id: 'qwen3-4b-FLM', name: 'Qwen3-4B-FLM', size: '~4GB', description: 'Balanced quality/speed - Recommended' },
  { id: 'Gemma-3-4b-it-GGUF', name: 'Gemma-3-4B-Instruct', size: '~4GB', description: 'High quality reasoning' },
  { id: 'Llama-3.2-3B-Instruct-GGUF', name: 'Llama-3.2-3B-Instruct', size: '~3GB', description: 'Good balance' },
  { id: 'Llama-3.2-1B-Instruct-GGUF', name: 'Llama-3.2-1B-Instruct', size: '~1GB', description: 'Fast, simple commands' },
  { id: 'Phi-3-mini-instruct-GGUF', name: 'Phi-3-Mini-Instruct', size: '~2GB', description: 'Low RAM systems' },
];

// System prompt for editor mode (matches AIChatPanel style)
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

export interface LemonadeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LemonadeResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finish_reason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Model capabilities cache
interface ModelCapabilities {
  supportsToolCalling: boolean;
  lastChecked: number;
}

const modelCapabilitiesCache: Map<string, ModelCapabilities> = new Map();
const CAPABILITIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface LemonadeConfig {
  endpoint: string;
  model: string;
  fallbackModel: string;
  useFallback: boolean;
  timeout: number;
  maxIterations: number;
}

class LemonadeProviderClass {
  private config: LemonadeConfig;
  private serverAvailable: boolean = false;
  private serverCheckPending: boolean = false;

  constructor() {
    this.config = {
      endpoint: DEFAULT_ENDPOINT,
      model: LEMONADE_MODELS.PRIMARY,
      fallbackModel: LEMONADE_MODELS.FAST_FALLBACK,
      useFallback: false,
      timeout: 120000, // 2 minutes for complex operations
      maxIterations: 50,
    };
  }

  /**
   * Check if Lemonade Server is available
   */
  async checkServerHealth(): Promise<{ available: boolean; models?: string[]; error?: string }> {
    if (this.serverCheckPending) {
      // Wait for pending check
      await new Promise(resolve => setTimeout(resolve, 500));
      return { available: this.serverAvailable };
    }

    this.serverCheckPending = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.config.endpoint}/models`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer lemonade',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          this.serverAvailable = true;
          const models = data.data?.map((m: any) => m.id) || [];
          log.info('Lemonade Server available', { models });
          return { available: true, models };
        } else {
          this.serverAvailable = false;
          log.warn('Lemonade Server returned non-OK status:', response.status);
          return { available: false, error: `Server returned ${response.status}` };
        }
      } catch (error) {
        clearTimeout(timeoutId);
        this.serverAvailable = false;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.warn('Lemonade Server not available:', errorMessage);
        return { available: false, error: errorMessage };
      }
    } finally {
      this.serverCheckPending = false;
    }
  }

  /**
   * Update configuration
   */
  configure(config: Partial<LemonadeConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Lemonade configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): LemonadeConfig {
    return { ...this.config };
  }

  /**
   * Check if server is available (cached)
   */
  isServerAvailable(): boolean {
    return this.serverAvailable;
  }

  /**
   * Force server availability refresh
   */
  async refreshServerStatus(): Promise<boolean> {
    const result = await this.checkServerHealth();
    return result.available;
  }

  /**
   * Get model capabilities including tool calling support
   */
  getModelCapabilities(modelId: string): { supportsToolCalling: boolean; reason?: string } {
    const supportsToolCalling = this.modelSupportsToolCalling(modelId);

    // Provide helpful reason for UI
    let reason: string | undefined;
    if (supportsToolCalling) {
      if (modelId.toLowerCase().includes('qwen')) {
        reason = 'Qwen models have strong tool calling capabilities';
      } else if (modelId.toLowerCase().includes('gemma')) {
        reason = 'Gemma models support tool calling';
      } else {
        reason = 'This model supports tool calling';
      }
    } else {
      if (modelId.toLowerCase().includes('1b')) {
        reason = 'Model too small - limited tool calling support';
      } else if (modelId.toLowerCase().includes('phi')) {
        reason = 'Phi models have limited tool calling support';
      }
    }

    return { supportsToolCalling, reason };
  }

  /**
   * Check if a model supports tool calling
   * Uses heuristic based on model name and caches result
   */
  private modelSupportsToolCalling(modelId: string): boolean {
    // Check cache first
    const cached = modelCapabilitiesCache.get(modelId);
    if (cached && Date.now() - cached.lastChecked < CAPABILITIES_CACHE_TTL) {
      return cached.supportsToolCalling;
    }

    // Heuristic: Qwen3 and Gemma-3 models support tool calling
    // Llama-3.2-1B is too small for reliable tool calling
    const supportsTools =
      modelId.toLowerCase().includes('qwen') ||
      modelId.toLowerCase().includes('gemma') ||
      modelId.toLowerCase().includes('llama-3.2-3b') ||
      modelId.toLowerCase().includes('llama-3.1');

    // Cache the result
    modelCapabilitiesCache.set(modelId, {
      supportsToolCalling: supportsTools,
      lastChecked: Date.now(),
    });

    return supportsTools;
  }

  /**
   * Send chat completion request to Lemonade Server
   */
  async chatCompletion(
    messages: LemonadeMessage[],
    options?: {
      tools?: ToolDefinition[];
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    }
  ): Promise<LemonadeResponse> {
    const model = this.config.useFallback ? this.config.fallbackModel : this.config.model;

    // Check if model supports tool calling
    const supportsToolCalling = this.modelSupportsToolCalling(model);
    const hasTools = options?.tools && options.tools.length > 0;

    if (hasTools && !supportsToolCalling) {
      log.warn('Model may not support tool calling', { model });
    }

    log.info('Sending chat completion request', { model, messageCount: messages.length, tools: options?.tools?.length });

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options?.maxTokens ?? 4096,
    };

    // Add tools if provided and model supports it
    if (hasTools && supportsToolCalling) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = 'auto';
    } else if (hasTools && !supportsToolCalling) {
      // Model doesn't support tools - strip them and warn
      log.warn('Skipping tools - model does not support tool calling', { model });
    }

    // Add temperature if provided
    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer lemonade',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Server returned ${response.status}`;
        log.error('Lemonade API error:', { status: response.status, error: errorMessage });
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Debug: log full response structure
      log.debug('Raw Lemonade response', data);

      // Check for empty choices - this is the main error case
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        log.error('Lemonade returned empty choices', {
          model,
          hasChoices: !!data.choices,
          choicesType: Array.isArray(data.choices) ? 'array' : typeof data.choices,
          choicesLength: Array.isArray(data.choices) ? data.choices.length : 'N/A',
          fullResponse: JSON.stringify(data, null, 2).substring(0, 2000),
        });

        // Check if this looks like a completion without tool support
        if (data.model && typeof data.model === 'string') {
          log.warn('This model may not support tool calling', { model });
        }

        throw new Error(
          `Lemonade Server returned no choices. This usually means the model '${model}' does not support tool calling. ` +
          `Try switching to a model that supports tools (e.g., qwen3-4b-FLM or Gemma-3-4b-it-GGUF).`
        );
      }

      const choice = data.choices[0];

      // Additional check: choice exists but has no message
      if (!choice || !choice.message) {
        log.error('Lemonade choice has no message', {
          choice,
          finish_reason: choice?.finish_reason,
        });
        throw new Error(
          `Lemonade Server returned an invalid response format. ` +
          `Finish reason: ${choice?.finish_reason || 'unknown'}. ` +
          `Try a different model or check the server logs.`
        );
      }

      // Parse tool calls if present
      const toolCalls: ToolCall[] = (choice.message?.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      }));

      const result: LemonadeResponse = {
        content: choice.message?.content || null,
        toolCalls,
        finish_reason: choice.finish_reason,
        usage: data.usage,
      };

      log.info('Received response', {
        contentLength: result.content?.length ?? 0,
        toolCalls: toolCalls.length,
        finish_reason: choice.finish_reason,
      });

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          log.error('Request timeout');
          throw new Error('Request timed out. The server may be busy or the model is too slow.');
        }
        log.error('Chat completion failed:', error);
        throw error;
      }
      throw new Error('Unknown error occurred');
    }
  }

  /**
   * Send message with automatic tool execution loop
   * Similar to AIChatPanel's sendMessage pattern
   */
  async sendMessageWithTools(
    userMessage: string,
    conversationHistory: LemonadeMessage[],
    timelineSummary?: string
  ): Promise<{
    messages: LemonadeMessage[];
    finalContent: string;
    toolExecutions: Array<{ name: string; args: unknown; result: unknown }>;
  }> {
    log.info('Starting message with tool execution', { userMessage, historyLength: conversationHistory.length });

    // Build messages array with system prompt if timeline summary provided
    const messages: LemonadeMessage[] = [];

    if (timelineSummary) {
      messages.push({
        role: 'system',
        content: EDITOR_SYSTEM_PROMPT + timelineSummary,
      });
    }

    // Add conversation history
    messages.push(...conversationHistory);

    // Add user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    const toolExecutions: Array<{ name: string; args: unknown; result: unknown }> = [];
    let iterationCount = 0;
    let finalContent = '';

    while (iterationCount < this.config.maxIterations) {
      iterationCount++;
      log.debug('Iteration', iterationCount);

      try {
        const response = await this.chatCompletion(messages, {
          tools: AI_TOOLS,
        });

        // Add assistant response to conversation
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls.length > 0 ? response.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })) : undefined,
        });

        // If no tool calls, we're done
        if (response.toolCalls.length === 0) {
          finalContent = response.content || '';
          log.info('Conversation complete', { iterations: iterationCount, finalContentLength: finalContent.length });
          break;
        }

        // Execute tool calls
        for (const toolCall of response.toolCalls) {
          log.info('Executing tool', { name: toolCall.name, arguments: toolCall.arguments });

          try {
            // Parse arguments
            const args = JSON.parse(toolCall.arguments);

            // Import executeAITool dynamically to avoid circular dependency
            const { executeAITool } = await import('./aiTools');

            // Execute the tool
            const result = await executeAITool(toolCall.name, args);

            toolExecutions.push({
              name: toolCall.name,
              args,
              result,
            });

            // Add tool result to conversation
            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: toolCall.id,
            });

            log.debug('Tool executed', { name: toolCall.name, success: result.success });
          } catch (toolError) {
            log.error('Tool execution failed:', { name: toolCall.name, error: toolError });

            // Add error result to conversation
            messages.push({
              role: 'tool',
              content: JSON.stringify({ success: false, error: String(toolError) }),
              tool_call_id: toolCall.id,
            });
          }
        }

        // Check if we should continue
        const lastChoice = response;
        if (lastChoice.finish_reason === 'stop' || lastChoice.finish_reason === 'end_turn') {
          finalContent = response.content || '';
          break;
        }

        // Safety check: if no content and no tool calls, break
        if (!response.content && response.toolCalls.length === 0) {
          break;
        }
      } catch (error) {
        log.error('Iteration failed:', error);

        // Add error message and break
        messages.push({
          role: 'assistant',
          content: `I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        });

        finalContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        break;
      }
    }

    if (iterationCount >= this.config.maxIterations) {
      log.warn('Max iterations reached');
      finalContent = finalContent || '\n\n[I reached the maximum number of iterations. Some actions may not have completed.]';
    }

    return {
      messages,
      finalContent,
      toolExecutions,
    };
  }

  /**
   * Simple chat without tool execution
   */
  async chat(
    userMessage: string,
    conversationHistory: LemonadeMessage[] = []
  ): Promise<string> {
    const messages: LemonadeMessage[] = [
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    const response = await this.chatCompletion(messages);
    return response.content || '';
  }

  /**
   * Switch to fallback model (for simple commands)
   */
  useFastFallback(): void {
    this.config.useFallback = true;
    log.info('Switched to fallback model:', this.config.fallbackModel);
  }

  /**
   * Switch back to primary model
   */
  usePrimaryModel(): void {
    this.config.useFallback = false;
    log.info('Switched to primary model:', this.config.model);
  }

  /**
   * Toggle fallback model usage
   */
  toggleFallback(useFallback: boolean): void {
    this.config.useFallback = useFallback;
    log.info('Fallback setting updated:', useFallback);
  }
}

// HMR-safe singleton
let instance: LemonadeProviderClass | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.lemonadeProvider) {
    instance = import.meta.hot.data.lemonadeProvider;
    log.debug('Restored instance from HMR');
  }
  import.meta.hot.dispose((data) => {
    data.lemonadeProvider = instance;
  });
}

// Export singleton
export const lemonadeProvider = instance ?? new LemonadeProviderClass();

if (import.meta.hot && !instance) {
  instance = lemonadeProvider;
  import.meta.hot.data.lemonadeProvider = instance;
}

// Export class for testing
export { LemonadeProviderClass };

/**
 * Get capabilities for a specific model
 */
export function getModelCapabilities(modelId: string): { supportsToolCalling: boolean; reason?: string } {
  return lemonadeProvider.getModelCapabilities(modelId);
}

/**
 * Get all model presets with tool calling support info
 */
export function getModelPresetWithCapabilities(): Array<{
  id: string;
  name: string;
  size: string;
  description: string;
  supportsToolCalling: boolean;
  capabilityReason?: string;
}> {
  return MODEL_PRESETS.map(preset => {
    const capabilities = lemonadeProvider.getModelCapabilities(preset.id);
    return {
      ...preset,
      supportsToolCalling: capabilities.supportsToolCalling,
      capabilityReason: capabilities.reason,
    };
  });
}
