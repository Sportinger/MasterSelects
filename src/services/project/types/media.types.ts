// Media-related types

import type { VectorAnimationMetadata } from '../../../types/vectorAnimation';
import type { GaussianSplatSequenceData, ModelSequenceData } from '../../../types';

export interface ProjectMediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'model' | 'gaussian-splat' | 'lottie' | 'rive';

  // Path to original file (absolute or relative to Raw/)
  sourcePath: string;

  // Path to copied file in project folder (e.g., "Raw/video.mp4")
  projectPath?: string;

  // Metadata
  duration?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  codec?: string;
  audioCodec?: string;
  container?: string;
  bitrate?: number;
  fileSize?: number;
  hasAudio?: boolean;

  // Proxy status
  hasProxy: boolean;

  vectorAnimation?: VectorAnimationMetadata;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;

  // Folder organization
  folderId: string | null;

  // Label color
  labelColor?: string;

  // Timestamps
  importedAt: string;
}
