// Analysis data persistence service
// Handles range-based analysis caching

import { FileStorageService } from '../core/FileStorageService';

/**
 * Project analysis artifact (stored in Analysis/{mediaId}.json)
 */
interface StoredAnalysisFile {
  schemaVersion?: 2 | 3;
  mediaFileId: string;
  analyses: {
    [rangeKey: string]: {
      frames: unknown[];
      sampleInterval: number;
      faceAnalysis?: unknown;
      createdAt: number;
    };
  };
  sceneDescriptions?: {
    segments: unknown[];
    createdAt: number;
  };
}

function getFrameTimestamp(frame: unknown): number {
  if (typeof frame !== 'object' || frame === null || !('timestamp' in frame)) {
    return 0;
  }
  const timestamp = (frame as { timestamp?: unknown }).timestamp;
  return typeof timestamp === 'number' ? timestamp : 0;
}

export class AnalysisService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  /**
   * Get range key for analysis caching (matches format: "inPoint-outPoint")
   */
  private getAnalysisRangeKey(inPoint: number, outPoint: number): string {
    return `${inPoint.toFixed(3)}-${outPoint.toFixed(3)}`;
  }

  /**
   * Get analysis record from file
   */
  private async getAnalysisRecord(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<StoredAnalysisFile | null> {
    const file = await this.fileStorage.readFile(projectHandle, 'ANALYSIS', `${mediaId}.json`);
    if (!file) return null;

    try {
      const text = await file.text();
      return JSON.parse(text) as StoredAnalysisFile;
    } catch (e) {
      return null;
    }
  }

  /**
   * Save analysis data for a media file with range-based caching
   */
  async saveAnalysis(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    inPoint: number,
    outPoint: number,
    frames: unknown[],
    sampleInterval: number,
    faceAnalysis?: unknown,
  ): Promise<boolean> {
    const rangeKey = this.getAnalysisRangeKey(inPoint, outPoint);

    // Get existing record or create new
    const existing = await this.getAnalysisRecord(projectHandle, mediaId);
    const record: StoredAnalysisFile = existing || {
      schemaVersion: 2,
      mediaFileId: mediaId,
      analyses: {},
    };
    record.schemaVersion = 3;

    // Add/update this range
    record.analyses[rangeKey] = {
      frames,
      sampleInterval,
      faceAnalysis,
      createdAt: Date.now(),
    };

    const json = JSON.stringify(record, null, 2);
    return this.fileStorage.writeFile(projectHandle, 'ANALYSIS', `${mediaId}.json`, json);
  }

  /**
   * Get analysis data for a specific time range
   */
  async getAnalysis(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    inPoint: number,
    outPoint: number
  ): Promise<{ frames: unknown[]; sampleInterval: number; faceAnalysis?: unknown } | null> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    if (!record) return null;

    const rangeKey = this.getAnalysisRangeKey(inPoint, outPoint);
    const analysis = record.analyses[rangeKey];

    if (!analysis) return null;
    return {
      frames: analysis.frames,
      sampleInterval: analysis.sampleInterval,
      faceAnalysis: analysis.faceAnalysis,
    };
  }

  /**
   * Check if analysis exists for a specific time range
   */
  async hasAnalysis(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    inPoint: number,
    outPoint: number
  ): Promise<boolean> {
    const analysis = await this.getAnalysis(projectHandle, mediaId, inPoint, outPoint);
    return analysis !== null;
  }

  /**
   * Get all cached analysis ranges for a media file
   */
  async getAnalysisRanges(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<string[]> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    if (!record) return [];
    return Object.keys(record.analyses);
  }

  /**
   * Get all analysis data merged across all ranges for a media file.
   * Frames are sorted by timestamp and deduplicated.
   */
  async getAllAnalysisMerged(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    if (!record) return null;

    const entries = Object.values(record.analyses);
    if (entries.length === 0) return null;

    // Merge all frames, sorted by timestamp, deduplicated
    const allFrames: unknown[] = [];
    let sampleInterval = entries[0].sampleInterval;
    for (const entry of entries) {
      for (const frame of entry.frames) {
        allFrames.push(frame);
      }
      // Use smallest sample interval
      if (entry.sampleInterval < sampleInterval) {
        sampleInterval = entry.sampleInterval;
      }
    }

    // Sort by timestamp and deduplicate
    allFrames.sort((a, b) => getFrameTimestamp(a) - getFrameTimestamp(b));
    const seen = new Set<number>();
    const dedupedFrames = allFrames.filter(f => {
      const ts = Math.round(getFrameTimestamp(f) * 1000);
      if (seen.has(ts)) return false;
      seen.add(ts);
      return true;
    });

    return { frames: dedupedFrames, sampleInterval };
  }

  async saveSceneDescriptions(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    segments: unknown[],
  ): Promise<boolean> {
    const existing = await this.getAnalysisRecord(projectHandle, mediaId);
    const record: StoredAnalysisFile = existing || {
      schemaVersion: 3,
      mediaFileId: mediaId,
      analyses: {},
    };
    record.schemaVersion = 3;
    record.sceneDescriptions = {
      segments,
      createdAt: Date.now(),
    };
    return this.fileStorage.writeFile(
      projectHandle,
      'ANALYSIS',
      `${mediaId}.json`,
      JSON.stringify(record, null, 2),
    );
  }

  async getSceneDescriptions(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
  ): Promise<unknown[] | null> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    return record?.sceneDescriptions?.segments ?? null;
  }

  async deleteSceneDescriptions(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
  ): Promise<boolean> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    if (!record?.sceneDescriptions) return true;
    delete record.sceneDescriptions;
    if (Object.keys(record.analyses).length === 0) {
      return this.deleteAnalysis(projectHandle, mediaId);
    }
    record.schemaVersion = 3;
    return this.fileStorage.writeFile(
      projectHandle,
      'ANALYSIS',
      `${mediaId}.json`,
      JSON.stringify(record, null, 2),
    );
  }

  /**
   * Delete all analysis for a media file
   */
  async deleteAnalysis(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    return this.fileStorage.deleteFile(projectHandle, 'ANALYSIS', `${mediaId}.json`);
  }

  async deleteAnalysisRange(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    inPoint: number,
    outPoint: number,
  ): Promise<boolean> {
    const record = await this.getAnalysisRecord(projectHandle, mediaId);
    if (!record) return true;
    delete record.analyses[this.getAnalysisRangeKey(inPoint, outPoint)];
    if (Object.keys(record.analyses).length === 0) {
      return this.deleteAnalysis(projectHandle, mediaId);
    }
    return this.fileStorage.writeFile(
      projectHandle,
      'ANALYSIS',
      `${mediaId}.json`,
      JSON.stringify(record, null, 2),
    );
  }
}
