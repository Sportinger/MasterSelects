// Media-related types

import type { VectorAnimationMetadata } from '../../../types/vectorAnimation';
import type { MediaFileAudioAnalysisRefs, MediaFileStemInfo } from '../../../types/audio';
import type { LiveInputSource } from '../../../types/liveInput';
import type { SourceAnnotation } from '../../../types/sourceAnnotation';
import type { SceneCutAnalysis } from '../../../types/sceneCutAnalysis';
import type { RemoteColorGradeState } from '../../../types/colorGradeOwnership';
import type {
  ExternalMediaOrigin,
  LinkedMediaSource,
  MediaSourceSelection,
  MediaVideoTrackMetadata,
} from '../../../types/mediaMetadata';
import type {
  ProjectGaussianSplatSequenceData,
  ProjectModelSequenceData,
} from './schema.types';

export interface ProjectMediaFile extends MediaVideoTrackMetadata {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'model' | 'gaussian-splat' | 'lottie' | 'rive';

  // Path to original file (absolute or relative to Raw/)
  sourcePath: string;

  // Path to copied file in project folder (e.g., "Raw/video.mp4")
  projectPath?: string;
  // Browser source-folder identity plus a path relative to that approved root.
  sourceRootId?: string;
  sourceRelativePath?: string;
  linkedSources?: LinkedMediaSource[];
  sourceSelection?: MediaSourceSelection;
  externalOrigin?: ExternalMediaOrigin;
  fileHash?: string;

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
  audioAnalysisRefs?: MediaFileAudioAnalysisRefs;
  stemInfo?: MediaFileStemInfo;
  waveform?: number[];
  waveformChannels?: number[][];
  splatCount?: number;
  totalSplatCount?: number;
  splatFrameCount?: number;

  // Proxy status
  hasProxy: boolean;
  proxyFormat?: 'jpeg-sequence' | 'mp4-all-intra';
  sceneCutAnalysis?: SceneCutAnalysis;
  hasAudioProxy?: boolean;
  audioProxyStorageKey?: string;

  vectorAnimation?: VectorAnimationMetadata;
  modelSequence?: ProjectModelSequenceData;
  gaussianSplatSequence?: ProjectGaussianSplatSequenceData;

  // Folder organization
  folderId: string | null;

  // Label color
  labelColor?: string;

  // Source-owned Resolve-style remote grade
  remoteColorGrade?: RemoteColorGradeState;

  // Timestamps
  importedAt: string;
  liveInput?: LiveInputSource;
  sourceAnnotations?: SourceAnnotation[];
}
