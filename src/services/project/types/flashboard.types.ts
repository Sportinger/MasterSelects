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

export interface ProjectFlashBoardChatEditOption {
  index: number;
  title: string;
  description: string;
}

export interface ProjectFlashBoardChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProjectFlashBoardChatToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ProjectFlashBoardChatExecutedToolCall {
  modelContent: string;
  result: ProjectFlashBoardChatToolResult;
  toolCall: ProjectFlashBoardChatToolCall;
}

export interface ProjectFlashBoardChatMessage {
  /** Validated and field-whitelisted before it reaches the chat activity UI. */
  activityEvents?: unknown[];
  conversationRef?: string;
  createdAt?: string;
  id: string;
  role: 'user' | 'assistant';
  text: string;
  decisionId?: string;
  editOptions?: ProjectFlashBoardChatEditOption[];
  inputRequest?: import('../../kernelClient/types').KernelUserInputRequest;
  isError?: boolean;
  isPending?: boolean;
  isStreaming?: boolean;
  /** Stored as-is; validated on load before it reaches the run card. */
  kernelReport?: unknown;
  toolCalls?: ProjectFlashBoardChatExecutedToolCall[];
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
  draftPrompt?: string;
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
  videoOutputFormat?: 'mov' | 'mp4';
  webSearch?: boolean;
  returnLastFrame?: boolean;
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
  idempotencyKey?: string;
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
  outputId?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface ProjectFlashBoardGenerationOutput {
  id: string;
  mediaType: ProjectFlashBoardMediaType;
  availability: 'preview' | 'completed';
  importStatus?: 'pending' | 'importing' | 'completed' | 'failed';
  importError?: string;
  artworkUrl?: string;
  downloadUrl?: string;
  duration?: number;
  mediaFileId?: string;
  previewUrl?: string;
  title?: string;
}

export interface ProjectFlashBoardGenerationMetadata {
  mediaFileId: string;
  workspaceId?: string;
  generationElapsedMs?: number;
  service?: ProjectFlashBoardService;
  providerId: string;
  version: string;
  outputType?: ProjectFlashBoardOutputType;
  mediaType?: ProjectFlashBoardMediaType;
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
  createdAt: string;
}

export interface ProjectFlashBoardGenerationRecord {
  id: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  request?: ProjectFlashBoardGenerationRequest;
  job?: ProjectFlashBoardJobState;
  outputs?: ProjectFlashBoardGenerationOutput[];
  result?: ProjectFlashBoardResult;
  results?: ProjectFlashBoardResult[];
}

export interface ProjectFlashBoardAIWorkspace {
  id: string;
  title: string;
  kind: 'generation' | 'chat' | 'download';
  createdAt: string;
  updatedAt: string;
  chatConversationRef?: string;
  composer: ProjectFlashBoardComposerState;
  chatMessages: ProjectFlashBoardChatMessage[];
}

export interface ProjectFlashBoardState {
  version: 1 | 2;
  composer?: ProjectFlashBoardComposerState;
  promptHistory?: ProjectFlashBoardPromptHistoryEntry[];
  chatMessages?: ProjectFlashBoardChatMessage[];
  workspaces?: ProjectFlashBoardAIWorkspace[];
  activeWorkspaceId?: string;
  generationRecords: ProjectFlashBoardGenerationRecord[];
  generationMetadataByMediaId: Record<string, ProjectFlashBoardGenerationMetadata>;
}
