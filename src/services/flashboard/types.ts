import type { FlashBoardGenerationRequest } from '../../stores/flashboardStore/types';

export interface SubmitNodeJobInput {
  nodeId: string;
  request: FlashBoardGenerationRequest;
}

export interface SubmitNodeJobResult {
  nodeId: string;
  remoteTaskId: string;
}

export interface ImportGeneratedMediaInput {
  nodeId: string;
  file: File;
  mediaType: 'video' | 'image';
  metadata: {
    providerId: string;
    version: string;
    prompt: string;
    negativePrompt?: string;
    duration?: number;
    aspectRatio?: string;
    generateAudio?: boolean;
    multiShots?: boolean;
    multiPrompt?: FlashBoardGenerationRequest['multiPrompt'];
    startMediaFileId?: string;
    endMediaFileId?: string;
    referenceMediaFileIds: string[];
  };
}

export interface ImportGeneratedMediaResult {
  mediaFileId: string;
}

export interface CatalogEntry {
  service: 'piapi' | 'kieai' | 'cloud';
  providerId: string;
  name: string;
  description: string;
  versions: string[];
  modes: string[];
  durations: number[];
  aspectRatios: string[];
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsTextToImage?: boolean;
  supportsGenerateAudio?: boolean;
  supportsMultiShot?: boolean;
  imageSizes?: string[];
  maxReferenceImages?: number;
  outputType?: 'video' | 'image';
}
