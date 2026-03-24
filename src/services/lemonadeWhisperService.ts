// Lemonade Whisper Service
// Server-side speech-to-text using Lemonade Server's whisper.cpp endpoint
// OpenAI-compatible API: POST /api/v1/audio/transcriptions

import { Logger } from './logger';
import { lemonadeProvider } from './lemonadeProvider';

const log = Logger.create('LemonadeWhisper');

// Lemonade Server Whisper endpoint
const WHISPER_ENDPOINT = '/audio/transcriptions';

export interface LemonadeTranscriptionOptions {
  language?: string;        // 'en' or 'auto' for auto-detect
  responseFormat?: string;  // 'verbose_json' for segments with timestamps
  timestampGranularities?: string; // 'segment' for segment-level timestamps
}

export interface LemonadeTranscriptionSegment {
  start: number;            // Start time in seconds
  end: number;              // End time in seconds
  text: string;             // Transcribed text for this segment
}

export interface LemonadeTranscriptionResult {
  text: string;             // Full transcription
  segments?: LemonadeTranscriptionSegment[];
  language?: string;
  duration?: number;
}

export interface LemonadeTranscriptionTask {
  id: string;
  mediaFileId: string;
  status: 'pending' | 'transcribing' | 'completed' | 'error';
  progress: number;         // 0-100
  result?: LemonadeTranscriptionResult;
  error?: string;
}

class LemonadeWhisperServiceClass {
  private serverAvailable: boolean = false;
  private serverCheckPending: boolean = false;
  private activeTasks: Map<string, LemonadeTranscriptionTask> = new Map();

  constructor() {
    this.checkServerHealth();
  }

  /**
   * Check if Lemonade Server is available
   */
  async checkServerHealth(): Promise<{ available: boolean; error?: string }> {
    if (this.serverCheckPending) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { available: this.serverAvailable };
    }

    this.serverCheckPending = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        // Check if server responds (we'll use the models endpoint as a health check)
        const response = await fetch(`${this.getBaseUrl()}/models`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer lemonade',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          this.serverAvailable = true;
          log.info('Lemonade Server available for transcription');
          return { available: true };
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
   * Get base URL from lemonadeProvider config
   */
  private getBaseUrl(): string {
    const config = lemonadeProvider.getConfig();
    return config.endpoint;
  }

  /**
   * Transcribe audio using Lemonade Server's whisper.cpp
   * @param audioBlob - Audio file/blob to transcribe
   * @param options - Transcription options
   * @returns Transcription result with text and segments
   */
  async transcribe(
    audioBlob: Blob,
    options?: LemonadeTranscriptionOptions
  ): Promise<LemonadeTranscriptionResult> {
    log.info('Starting transcription', {
      size: audioBlob.size,
      type: audioBlob.type,
      language: options?.language || 'auto'
    });

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-1');

    if (options?.language && options.language !== 'auto') {
      formData.append('language', options.language);
    }

    formData.append('response_format', options?.responseFormat || 'verbose_json');
    formData.append('timestamp_granularities', options?.timestampGranularities || 'segment');

    try {
      const controller = new AbortController();
      // Longer timeout for transcription (can take time for large files)
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

      const response = await fetch(`${this.getBaseUrl()}${WHISPER_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer lemonade',
          // Don't set Content-Type - browser will set it with boundary for FormData
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Server returned ${response.status}`;
        log.error('Transcription API error:', { status: response.status, error: errorMessage });
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Parse response into our format
      const result: LemonadeTranscriptionResult = {
        text: data.text || '',
        segments: data.segments?.map((seg: any) => ({
          start: seg.start,
          end: seg.end,
          text: seg.text,
        })) || [],
        language: data.language,
        duration: data.duration,
      };

      log.info('Transcription complete', {
        textLength: result.text.length,
        segments: result.segments?.length,
        language: result.language,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          log.error('Transcription timeout');
          throw new Error('Transcription timed out. The file may be too large or server is busy.');
        }
        log.error('Transcription failed:', error);
        throw error;
      }
      throw new Error('Unknown error occurred during transcription');
    }
  }

  /**
   * Transcribe with progress tracking (simulated for server-side)
   * @param audioBlob - Audio file/blob to transcribe
   * @param onProgress - Progress callback (0-100)
   * @param options - Transcription options
   * @returns Transcription result
   */
  async transcribeWithProgress(
    audioBlob: Blob,
    onProgress?: (progress: number) => void,
    options?: LemonadeTranscriptionOptions
  ): Promise<LemonadeTranscriptionResult> {
    // Create a task for tracking
    const taskId = `task-${Date.now()}`;
    const task: LemonadeTranscriptionTask = {
      id: taskId,
      mediaFileId: 'unknown',
      status: 'pending',
      progress: 0,
    };

    this.activeTasks.set(taskId, task);

    try {
      // Simulate progress updates (server doesn't send progress)
      task.status = 'transcribing';
      const progressInterval = setInterval(() => {
        if (task.progress < 90) {
          task.progress += 10;
          onProgress?.(task.progress);
        }
      }, 1000);

      const result = await this.transcribe(audioBlob, options);

      clearInterval(progressInterval);
      task.progress = 100;
      task.status = 'completed';
      task.result = result;
      onProgress?.(100);

      return result;
    } catch (error) {
      task.status = 'error';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    } finally {
      // Clean up task after delay
      setTimeout(() => {
        this.activeTasks.delete(taskId);
      }, 60000);
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): LemonadeTranscriptionTask | undefined {
    return this.activeTasks.get(taskId);
  }

  /**
   * Get all active tasks
   */
  getActiveTasks(): LemonadeTranscriptionTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Check if server is available (cached)
   */
  isAvailable(): boolean {
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
   * Get user-friendly status message
   */
  getStatusMessage(): string {
    if (this.serverAvailable) {
      return 'Lemonade Server online for transcription';
    } else {
      return 'Lemonade Server offline - using browser transcription';
    }
  }
}

// HMR-safe singleton
let instance: LemonadeWhisperServiceClass | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.lemonadeWhisperService) {
    instance = import.meta.hot.data.lemonadeWhisperService;
    log.debug('Restored instance from HMR');
  }
  import.meta.hot.dispose((data) => {
    data.lemonadeWhisperService = instance;
  });
}

// Export singleton
export const lemonadeWhisperService = instance ?? new LemonadeWhisperServiceClass();

if (import.meta.hot && !instance) {
  instance = lemonadeWhisperService;
  import.meta.hot.data.lemonadeWhisperService = instance;
}

// Export class for testing
export { LemonadeWhisperServiceClass };
