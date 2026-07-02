import type {
  FlashBoardGenerationRequest,
  FlashBoardMediaType,
  FlashBoardOutputType,
  FlashBoardService,
} from '../../stores/flashboardStore/types';

export interface SubmitGenerationJobInput {
  recordId: string;
  request: FlashBoardGenerationRequest;
}

export interface SubmitGenerationJobResult {
  recordId: string;
  remoteTaskId?: string;
}

export interface ImportGeneratedMediaInput {
  recordId: string;
  file: File;
  mediaType: FlashBoardMediaType;
  metadata: {
    service?: FlashBoardService;
    providerId: string;
    version: string;
    outputType?: FlashBoardOutputType;
    mediaType?: FlashBoardMediaType;
    prompt: string;
    negativePrompt?: string;
    duration?: number;
    aspectRatio?: string;
    imageSize?: string;
    generateAudio?: boolean;
    multiShots?: boolean;
    multiPrompt?: FlashBoardGenerationRequest['multiPrompt'];
    voiceId?: string;
    voiceName?: string;
    languageOverride?: boolean;
    languageCode?: string;
    outputFormat?: string;
    voiceSettings?: FlashBoardGenerationRequest['voiceSettings'];
    sunoCustomMode?: boolean;
    sunoInstrumental?: boolean;
    sunoStyle?: string;
    sunoTitle?: string;
    sunoNegativeTags?: string;
    sunoVocalGender?: FlashBoardGenerationRequest['sunoVocalGender'];
    sunoStyleWeight?: number;
    sunoWeirdnessConstraint?: number;
    sunoAudioWeight?: number;
    startMediaFileId?: string;
    endMediaFileId?: string;
    referenceMediaFileIds: string[];
  };
}

export interface ImportGeneratedMediaResult {
  mediaFileId: string;
}

export type CatalogReferenceInputKind =
  | 'start-frame'
  | 'end-frame'
  | 'image-reference'
  | 'video-reference'
  | 'audio-reference'
  | 'video-input';

export interface CatalogEntry {
  service: FlashBoardService;
  providerId: string;
  name: string;
  description: string;
  versions: string[];
  modes: string[];
  modeLabels?: Record<string, string>;
  modeControlLabel?: string;
  durations: number[];
  aspectRatios: string[];
  referenceInputKinds?: CatalogReferenceInputKind[];
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsTextToImage?: boolean;
  supportsTextToAudio?: boolean;
  supportsGenerateAudio?: boolean;
  supportsMultiShot?: boolean;
  imageSizes?: string[];
  maxReferenceImages?: number;
  maxReferenceMedia?: number;
  outputType?: FlashBoardOutputType;
  promptRefinerProfile?: string;
  requiredReferenceMediaType?: FlashBoardMediaType | 'visual';
  requiresPrompt?: boolean;
  requiresReferenceMedia?: boolean;
}
