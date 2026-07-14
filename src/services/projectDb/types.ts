import type { ArtifactManifest } from '../../artifacts/types';

// Source thumbnail: 1 per second per source media file
export interface StoredSourceThumbnail {
  id: string;            // Format: "${mediaFileId}_${secondIndex}" e.g., "abc123_000042"
  mediaFileId: string;   // Source media file ID
  fileHash?: string;     // For deduplication across re-imports
  secondIndex: number;   // Which second (0-based)
  blob: Blob;            // JPEG blob (~2-5KB each at 160x90)
}

// Thumbnail stored by file hash for deduplication
export interface StoredThumbnail {
  fileHash: string; // Primary key
  blob: Blob;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface StoredMediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'lottie' | 'rive';
  // No longer storing blob - only metadata and file hash for deduplication
  fileHash?: string; // SHA-256 hash for proxy/thumbnail deduplication
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  container?: string;
  fileSize?: number;
  createdAt: number;
}

// Proxy frame data - stores frames for a media file
export interface StoredProxyFrame {
  id: string; // Format: fileHash_frameIndex (e.g., "abc123_0042")
  mediaFileId: string; // Legacy: kept for backwards compatibility
  fileHash?: string; // SHA-256 hash of file content (for deduplication)
  frameIndex: number;
  blob: Blob; // WebP image blob
}

// Proxy metadata stored with media file
export interface ProxyMetadata {
  mediaFileId: string;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  createdAt: number;
}

// Cached analysis data for a media file
export interface StoredAnalysis {
  mediaFileId: string;
  // Analysis data per time range (key: "inPoint-outPoint")
  // Allows caching different trim ranges of the same file
  analyses: {
    [rangeKey: string]: {
      frames: Array<{
        timestamp: number;
        motion: number;
        globalMotion: number;
        localMotion: number;
        focus: number;
        faceCount: number;
        isSceneCut?: boolean;
      }>;
      sampleInterval: number;
      createdAt: number;
    };
  };
}

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // Full project state
  data: {
    compositions: unknown[];
    folders: unknown[];
    activeCompositionId: string | null;
    openCompositionIds?: string[];
    expandedFolderIds: string[];
    // Media file IDs (actual blobs stored separately)
    mediaFileIds: string[];
    // Text, solid, and mesh items
    textItems?: unknown[];
    solidItems?: unknown[];
    meshItems?: unknown[];
    cameraItems?: unknown[];
    lightItems?: unknown[];
    splatEffectorItems?: unknown[];
    mathSceneItems?: unknown[];
    motionShapeItems?: unknown[];
    signalAssets?: unknown[];
    signalArtifacts?: unknown[];
    signalGraphs?: unknown[];
    signalOperators?: unknown[];
  };
}

export interface StoredArtifactManifest {
  artifactId: string;
  hash: string;
  sourceRefs: string[];
  manifest: ArtifactManifest;
  updatedAt: number;
}

export interface StoredArtifactBlob {
  hash: string;
  artifactId: string;
  blob: Blob;
  updatedAt: number;
}

export interface ProjectDbLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
}
