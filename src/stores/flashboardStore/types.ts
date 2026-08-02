import type { KernelProgressEvent } from '../../services/kernelClient/runProgress';
import type { KernelRunReport } from '../../services/kernelClient/runReport';
import type { AgentActivityEvent } from '../../services/flashboard/FlashBoardChatTypes';

export interface FlashBoardStoreState {
  activeGenerationRecords: FlashBoardActiveGenerationRecord[];
  selectedActiveGenerationRecordIds: string[];
  composer: FlashBoardComposerState;
  promptHistory: FlashBoardPromptHistoryEntry[];
  chatMessages: FlashBoardChatMessage[];
  hoveredComposerReference: FlashBoardHoveredComposerReference | null;
}

export const FLASHBOARD_STORE_STATE_KEYS = [
  'activeGenerationRecords',
  'selectedActiveGenerationRecordIds',
  'composer',
  'promptHistory',
  'chatMessages',
  'hoveredComposerReference',
] as const satisfies readonly (keyof FlashBoardStoreState)[];

export type FlashBoardStoreStateKey = typeof FLASHBOARD_STORE_STATE_KEYS[number];

export const FLASHBOARD_ACTIVE_GENERATION_STATE_KEYS = [
  'activeGenerationRecords',
  'selectedActiveGenerationRecordIds',
  'composer',
  'promptHistory',
  'chatMessages',
  'hoveredComposerReference',
] as const satisfies readonly FlashBoardStoreStateKey[];

export const FLASHBOARD_RETIRED_BOARD_WORKSPACE_STATE_KEYS = [] as const satisfies readonly FlashBoardStoreStateKey[];

export interface FlashBoardStateClassification {
  activeGeneration: readonly FlashBoardStoreStateKey[];
  retiredBoardWorkspace: readonly FlashBoardStoreStateKey[];
}

export const FLASHBOARD_STATE_CLASSIFICATION = {
  activeGeneration: FLASHBOARD_ACTIVE_GENERATION_STATE_KEYS,
  retiredBoardWorkspace: FLASHBOARD_RETIRED_BOARD_WORKSPACE_STATE_KEYS,
} as const satisfies FlashBoardStateClassification;

export type FlashBoardService = 'cloud';
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

export type FlashBoardPromptHistoryKind = 'generation' | 'chat';

export interface FlashBoardPromptHistoryEntry {
  id: string;
  kind: FlashBoardPromptHistoryKind;
  prompt: string;
  createdAt: number;
}

export interface FlashBoardChatEditOption {
  index: number;
  title: string;
  description: string;
}

export interface FlashBoardChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface FlashBoardChatToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface FlashBoardChatExecutedToolCall {
  modelContent: string;
  result: FlashBoardChatToolResult;
  toolCall: FlashBoardChatToolCall;
}

export interface FlashBoardChatMessage {
  activityEvents?: AgentActivityEvent[];
  createdAt?: number;
  id: string;
  role: 'user' | 'assistant';
  text: string;
  decisionId?: string;
  editOptions?: FlashBoardChatEditOption[];
  isError?: boolean;
  isPending?: boolean;
  /** True while the pending assistant bubble contains live provider output. */
  isStreaming?: boolean;
  /** Live stage while a kernel turn is running; cleared once it settles. */
  kernelProgress?: KernelProgressEvent;
  /** Structured kernel evidence, rendered as a run card instead of prose. */
  kernelReport?: KernelRunReport;
  toolCalls?: FlashBoardChatExecutedToolCall[];
}

export interface FlashBoardComposerModelSettings {
  version?: string;
  mode?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  multiShots?: boolean;
}

export interface FlashBoardComposerState {
  isOpen: boolean;
  generateAudio: boolean;
  multiShots: boolean;
  multiPrompt: FlashBoardMultiShotPrompt[];
  service?: FlashBoardService;
  providerId?: string;
  version?: string;
  outputType?: FlashBoardOutputType;
  mode?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
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
  modelSettingsByKey?: Record<string, FlashBoardComposerModelSettings>;
}

export type FlashBoardComposerReferenceRole = 'start' | 'end' | 'reference';

export interface FlashBoardHoveredComposerReference {
  mediaFileId: string;
  role: FlashBoardComposerReferenceRole;
}

export interface FlashBoardActiveGenerationRecord {
  id: string;
  kind: 'generation';
  createdAt: number;
  updatedAt: number;
  request?: FlashBoardGenerationRequest;
  job?: FlashBoardJobState;
  outputs?: FlashBoardGenerationOutput[];
  result?: FlashBoardResult;
  results?: FlashBoardResult[];
}

export interface FlashBoardGenerationOutput {
  id: string;
  mediaType: FlashBoardMediaType;
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

export interface FlashBoardGenerationRequest {
  service: FlashBoardService;
  providerId: string;
  version: string;
  /** Stable across reloads so hosted video task creation can be resumed idempotently. */
  idempotencyKey?: string;
  outputType?: FlashBoardOutputType;
  mode?: string;
  originalPrompt?: string;
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
  refund?: FlashBoardJobRefund;
}

export interface FlashBoardJobRefund {
  creditBalance: number;
  credits: number;
  jobId: string;
}

export interface FlashBoardResult {
  mediaFileId: string;
  mediaType: FlashBoardMediaType;
  outputId?: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface FlashBoardGenerationMetadata {
  mediaFileId: string;
  service?: FlashBoardService;
  providerId: string;
  version: string;
  outputType?: FlashBoardOutputType;
  mediaType?: FlashBoardMediaType;
  mode?: string;
  originalPrompt?: string;
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
