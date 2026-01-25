// Media-related types

export interface ProjectMediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';

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

  // Folder organization
  folderId: string | null;

  // Timestamps
  importedAt: string;
}
