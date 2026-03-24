// Whisper Service
// Browser-based speech-to-text using Transformers.js
// Can optionally use Lemonade Server's whisper.cpp for faster server-side transcription

import { Logger } from './logger';
import type { TranscriptEntry } from '../stores/multicamStore';
import { useSettingsStore } from '../stores/settingsStore';
import { lemonadeWhisperService } from './lemonadeWhisperService';

const log = Logger.create('WhisperService');
import { useMediaStore } from '../stores/mediaStore';

// We'll dynamically import transformers.js when needed
// This allows the app to work even if the package isn't installed yet

interface WhisperOutput {
  text: string;
  chunks?: Array<{
    text: string;
    timestamp: [number, number | null];
  }>;
}

class WhisperService {
  private pipeline: any = null;
  private isLoading = false;

  /**
   * Load the Whisper model
   */
  private async loadModel(onProgress?: (progress: number) => void): Promise<void> {
    if (this.pipeline) return;
    if (this.isLoading) {
      // Wait for existing load to complete
      while (this.isLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      return;
    }

    this.isLoading = true;

    try {
      // Dynamically import transformers.js
      const { pipeline } = await import('@huggingface/transformers');

      log.info('Loading Whisper model...');

      // Use whisper-tiny for fastest inference
      // Options: whisper-tiny, whisper-base, whisper-small
      this.pipeline = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny',
        {
          progress_callback: (data: any) => {
            if (data.status === 'progress' && onProgress) {
              onProgress(Math.round(data.progress));
            }
          },
        }
      );

      log.info('Model loaded');
    } catch (error) {
      log.error('Failed to load model', error);
      throw new Error(
        'Failed to load Whisper model. Make sure @xenova/transformers is installed: npm install @xenova/transformers'
      );
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Extract audio from a media file as a Float32Array
   */
  private async extractAudio(mediaFileId: string): Promise<Float32Array | null> {
    const mediaStore = useMediaStore.getState();
    const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);

    if (!mediaFile || !mediaFile.file) {
      log.warn('Media file not found', { mediaFileId });
      return null;
    }

    try {
      const audioContext = new AudioContext({ sampleRate: 16000 }); // Whisper expects 16kHz
      const arrayBuffer = await mediaFile.file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get mono audio data
      const channelData = audioBuffer.getChannelData(0);

      // If sample rate doesn't match, we need to resample
      if (audioBuffer.sampleRate !== 16000) {
        // Simple linear interpolation resampling
        const ratio = audioBuffer.sampleRate / 16000;
        const newLength = Math.floor(channelData.length / ratio);
        const resampled = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
          const srcIndex = i * ratio;
          const srcIndexFloor = Math.floor(srcIndex);
          const srcIndexCeil = Math.min(srcIndexFloor + 1, channelData.length - 1);
          const t = srcIndex - srcIndexFloor;
          resampled[i] = channelData[srcIndexFloor] * (1 - t) + channelData[srcIndexCeil] * t;
        }

        audioContext.close();
        return resampled;
      }

      audioContext.close();
      return channelData;
    } catch (error) {
      log.error('Failed to extract audio', error);
      return null;
    }
  }

  /**
   * Transcribe audio from a media file
   * Routes to Lemonade Server if enabled and available, otherwise uses browser-based transcription
   */
  async transcribe(
    mediaFileId: string,
    onProgress?: (progress: number) => void
  ): Promise<TranscriptEntry[]> {
    // Check if Lemonade transcription is enabled
    const { lemonadeTranscriptionEnabled, lemonadeTranscriptionFallback } = useSettingsStore.getState();

    if (lemonadeTranscriptionEnabled) {
      // Check if Lemonade Server is available
      const serverAvailable = lemonadeWhisperService.isAvailable();

      if (serverAvailable) {
        log.info('Using Lemonade Server for transcription');
        return this.transcribeWithLemonade(mediaFileId, onProgress);
      } else if (lemonadeTranscriptionFallback) {
        log.info('Lemonade Server offline, falling back to browser transcription');
      } else {
        throw new Error('Lemonade Server is offline and fallback is disabled');
      }
    }

    // Use browser-based transcription
    return this.transcribeWithBrowser(mediaFileId, onProgress);
  }

  /**
   * Transcribe using Lemonade Server's whisper.cpp
   */
  private async transcribeWithLemonade(
    mediaFileId: string,
    onProgress?: (progress: number) => void
  ): Promise<TranscriptEntry[]> {
    const mediaStore = useMediaStore.getState();
    const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);

    if (!mediaFile || !mediaFile.file) {
      throw new Error('Media file not found');
    }

    try {
      // Send file blob directly to Lemonade Server
      const result = await lemonadeWhisperService.transcribeWithProgress(
        mediaFile.file,
        onProgress,
        { language: 'auto', responseFormat: 'verbose_json' }
      );

      // Convert to transcript entries
      const entries: TranscriptEntry[] = [];

      if (result.segments && result.segments.length > 0) {
        for (let i = 0; i < result.segments.length; i++) {
          const segment = result.segments[i];
          const text = segment.text.trim();

          if (!text) continue;

          entries.push({
            id: `transcript-${i}`,
            start: segment.start * 1000,
            end: segment.end * 1000,
            speaker: 'Speaker 1',
            text,
          });
        }
      } else {
        // No segments, create single entry
        entries.push({
          id: 'transcript-0',
          start: 0,
          end: (result.duration || 0) * 1000,
          speaker: 'Speaker 1',
          text: result.text,
        });
      }

      return entries;
    } catch (error) {
      log.error('Lemonade transcription failed:', error);
      throw error;
    }
  }

  /**
   * Transcribe using browser-based Transformers.js
   */
  private async transcribeWithBrowser(
    mediaFileId: string,
    onProgress?: (progress: number) => void
  ): Promise<TranscriptEntry[]> {
    // Load model first
    await this.loadModel((progress) => {
      // Model loading progress (0-50%)
      onProgress?.(Math.round(progress * 0.5));
    });

    // Extract audio
    log.debug('Extracting audio...');
    const audioData = await this.extractAudio(mediaFileId);

    if (!audioData) {
      throw new Error('Failed to extract audio from media file');
    }

    log.debug(`Transcribing ${audioData.length} samples...`);
    onProgress?.(55);

    // Run transcription
    const result: WhisperOutput = await this.pipeline(audioData, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    onProgress?.(95);

    // Convert to transcript entries
    const entries: TranscriptEntry[] = [];

    if (result.chunks && result.chunks.length > 0) {
      // We have timestamps
      for (let i = 0; i < result.chunks.length; i++) {
        const chunk = result.chunks[i];
        const text = chunk.text.trim();

        if (!text) continue;

        const startMs = (chunk.timestamp[0] ?? 0) * 1000;
        const endMs = chunk.timestamp[1] !== null
          ? chunk.timestamp[1] * 1000
          : startMs + 5000; // Default 5s if no end timestamp

        entries.push({
          id: `transcript-${i}`,
          start: startMs,
          end: endMs,
          speaker: 'Speaker 1', // TODO: Implement speaker diarization
          text,
        });
      }
    } else {
      // No timestamps, create single entry
      entries.push({
        id: 'transcript-0',
        start: 0,
        end: audioData.length / 16000 * 1000,
        speaker: 'Speaker 1',
        text: result.text.trim(),
      });
    }

    onProgress?.(100);
    log.info(`Transcription complete: ${entries.length} entries`);

    return entries;
  }

  /**
   * Check if the model is loaded
   */
  isModelLoaded(): boolean {
    return this.pipeline !== null;
  }

  /**
   * Unload the model to free memory
   */
  async unload(): Promise<void> {
    if (this.pipeline) {
      // Transformers.js doesn't have explicit unload, but we can null the reference
      this.pipeline = null;
      log.info('Model unloaded');
    }
  }
}

// Singleton instance
export const whisperService = new WhisperService();
