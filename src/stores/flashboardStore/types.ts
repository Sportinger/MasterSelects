export interface FlashBoardStoreState {
  activeBoardId: string | null;
  boards: FlashBoard[];
  selectedNodeIds: string[];
  viewMode: 'board';
  composer: FlashBoardComposerState;
  hoveredComposerReference: FlashBoardHoveredComposerReference | null;
}

export type FlashBoardService = 'piapi' | 'kieai' | 'cloud' | 'elevenlabs' | 'suno';
export type FlashBoardOutputType = 'video' | 'image' | 'audio';
export type FlashBoardMediaType = 'video' | 'image' | 'audio';
export type FlashBoardSunoVocalGender = 'm' | 'f';

export interface FlashBoardVoiceSettings {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface FlashBoardMultiShotPrompt {
  index: number;
  prompt: string;
  duration: number;
}

export interface FlashBoardComposerState {
  draftNodeId: string | null;
  isOpen: boolean;
  generateAudio: boolean;
  multiShots: boolean;
  multiPrompt: FlashBoardMultiShotPrompt[];
  service?: FlashBoardService;
  providerId?: string;
  version?: string;
  outputType?: FlashBoardOutputType;
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: FlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: FlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
}

export type FlashBoardComposerReferenceRole = 'start' | 'end' | 'reference';

export interface FlashBoardHoveredComposerReference {
  mediaFileId: string;
  role: FlashBoardComposerReferenceRole;
}

export interface FlashBoard {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: { zoom: number; panX: number; panY: number };
  nodes: FlashBoardNode[];
}

export interface FlashBoardNode {
  id: string;
  kind: 'generation' | 'reference';
  createdAt: number;
  updatedAt: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  request?: FlashBoardGenerationRequest;
  job?: FlashBoardJobState;
  result?: FlashBoardResult;
}

export interface FlashBoardGenerationRequest {
  service: FlashBoardService;
  providerId: string;
  version: string;
  outputType?: FlashBoardOutputType;
  mode?: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
  multiPrompt?: FlashBoardMultiShotPrompt[];
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: FlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: FlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
}

export interface FlashBoardJobState {
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface FlashBoardResult {
  mediaFileId: string;
  mediaType: FlashBoardMediaType;
  duration?: number;
  width?: number;
  height?: number;
}

// Project persistence types (ISO date strings instead of numbers)

export interface ProjectFlashBoardState {
  version: 1;
  activeBoardId: string | null;
  boards: ProjectFlashBoard[];
  generationMetadataByMediaId: Record<string, FlashBoardGenerationMetadata>;
}

export interface ProjectFlashBoard {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  viewport: { zoom: number; panX: number; panY: number };
  nodes: ProjectFlashBoardNode[];
}

export interface ProjectFlashBoardNode {
  id: string;
  kind: 'generation' | 'reference';
  createdAt: string;
  updatedAt: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  request?: FlashBoardGenerationRequest;
  job?: Omit<FlashBoardJobState, 'remoteTaskId'>;
  result?: FlashBoardResult;
}

export interface FlashBoardGenerationMetadata {
  mediaFileId: string;
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
  multiPrompt?: FlashBoardMultiShotPrompt[];
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: FlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: FlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
  createdAt: string;
}
