// Transcript persistence service

import { FileStorageService } from '../core/FileStorageService';

/**
 * Stored transcript format.
 * Backward compatible: old format was just TranscriptWord[]. The object format
 * also retains optional hybrid-provider provenance.
 */
export interface StoredTranscript {
  words: unknown[];
  transcribedRanges?: [number, number][];
  artifact?: unknown;
}

export class TranscriptService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  /**
   * Save transcript with optional transcribed ranges
   */
  async saveTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    transcript: unknown,
    transcribedRanges?: [number, number][]
  ): Promise<boolean> {
    const incoming: StoredTranscript = Array.isArray(transcript)
      ? { words: transcript }
      : { ...(transcript as StoredTranscript) };
    let resolvedRanges = transcribedRanges;
    if (resolvedRanges === undefined) {
      const stored = await this.getTranscript(projectHandle, mediaId);
      resolvedRanges = stored?.transcribedRanges ?? incoming.transcribedRanges;
    }
    const data: StoredTranscript = resolvedRanges === undefined
      ? incoming
      : { ...incoming, transcribedRanges: resolvedRanges };

    const json = JSON.stringify(data, null, 2);
    return this.fileStorage.writeFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`, json);
  }

  /**
   * Get transcript for a media file
   * Returns { words, transcribedRanges } — handles both old (array) and new (object) formats
   */
  async getTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<StoredTranscript | null> {
    const file = await this.fileStorage.readFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`);
    if (!file) return null;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Old format: just an array of words
      if (Array.isArray(parsed)) {
        return { words: parsed };
      }

      // New format: { words, transcribedRanges }
      return parsed as StoredTranscript;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get transcribed ranges for a media file
   */
  async getTranscribedRanges(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<[number, number][]> {
    const data = await this.getTranscript(projectHandle, mediaId);
    return data?.transcribedRanges ?? [];
  }

  /**
   * Delete transcript data for a media file.
   */
  async deleteTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    return this.fileStorage.deleteFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`);
  }
}
