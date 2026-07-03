export type ProjectFlashBoardService =
  | 'piapi'
  | 'kieai'
  | 'evolink'
  | 'cloud'
  | 'elevenlabs'
  | 'suno';
export type ProjectFlashBoardOutputType = 'video' | 'image' | 'audio';
export type ProjectFlashBoardMediaType = 'video' | 'image' | 'audio';
export type ProjectFlashBoardSunoVocalGender = 'm' | 'f';

export interface ProjectFlashBoardVoiceSettings {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface ProjectFlashBoardMultiShotPrompt {
  index: number;
  prompt: string;
  duration: number;
}

export type ProjectFlashBoardPromptHistoryKind = 'generation' | 'chat';

export interface ProjectFlashBoardPromptHistoryEntry {
  id: string;
  kind: ProjectFlashBoardPromptHistoryKind;
  prompt: string;
  createdAt: string;
}

export interface ProjectFlashBoardComposerModelSettings {
  version?: string;
  mode?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
}

export interface ProjectFlashBoardComposerState {
  isOpen?: boolean;
  service?: ProjectFlashBoardService;
  providerId?: string;
  version?: string;
  outputType?: ProjectFlashBoardOutputType;
  mode?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
  multiPrompt?: ProjectFlashBoardMultiShotPrompt[];
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: ProjectFlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: ProjectFlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds?: string[];
  modelSettingsByKey?: Record<string, ProjectFlashBoardComposerModelSettings>;
}

export interface ProjectFlashBoardGenerationRequest {
  service: ProjectFlashBoardService;
  providerId: string;
  version: string;
  outputType?: ProjectFlashBoardOutputType;
  mode?: string;
  originalPrompt?: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
  multiPrompt?: ProjectFlashBoardMultiShotPrompt[];
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: ProjectFlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: ProjectFlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
}

export interface ProjectFlashBoardJobState {
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface ProjectFlashBoardResult {
  mediaFileId: string;
  mediaType: ProjectFlashBoardMediaType;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ProjectFlashBoardGenerationMetadata {
  mediaFileId: string;
  service?: ProjectFlashBoardService;
  providerId: string;
  version: string;
  outputType?: ProjectFlashBoardOutputType;
  mediaType?: ProjectFlashBoardMediaType;
  originalPrompt?: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
  multiPrompt?: ProjectFlashBoardMultiShotPrompt[];
  voiceId?: string;
  voiceName?: string;
  languageOverride?: boolean;
  languageCode?: string;
  outputFormat?: string;
  voiceSettings?: ProjectFlashBoardVoiceSettings;
  sunoCustomMode?: boolean;
  sunoInstrumental?: boolean;
  sunoStyle?: string;
  sunoTitle?: string;
  sunoNegativeTags?: string;
  sunoVocalGender?: ProjectFlashBoardSunoVocalGender;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
  createdAt: string;
}

export interface ProjectFlashBoardGenerationRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  request?: ProjectFlashBoardGenerationRequest;
  job?: ProjectFlashBoardJobState;
  result?: ProjectFlashBoardResult;
}

export interface ProjectFlashBoardState {
  version: 1;
  composer?: ProjectFlashBoardComposerState;
  promptHistory?: ProjectFlashBoardPromptHistoryEntry[];
  generationRecords: ProjectFlashBoardGenerationRecord[];
  generationMetadataByMediaId: Record<string, ProjectFlashBoardGenerationMetadata>;
}
