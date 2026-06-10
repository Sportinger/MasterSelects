import type { MediaFile } from '../../stores/mediaStore/types';
import type { FlashBoardComposerReferenceRole } from '../../stores/flashboardStore/types';
import type { CatalogEntry } from './types';

export interface FlashBoardPromptRefinerReference {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  mediaType: MediaFile['type'];
  file?: File;
  url?: string;
  thumbnailUrl?: string;
}

export interface RefineFlashBoardPromptInput {
  apiKey?: string;
  prompt: string;
  entry: CatalogEntry;
  service: CatalogEntry['service'];
  providerId: string;
  version: string;
  mode: string;
  duration: number;
  aspectRatio: string;
  imageSize: string;
  generateAudio: boolean;
  multiShots: boolean;
  references: FlashBoardPromptRefinerReference[];
  sunoStyle?: string;
  sunoNegativeTags?: string;
  sunoInstrumental?: boolean;
  sunoCustomMode?: boolean;
  sunoVocalGender?: string;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
}

export interface ParsedSunoPromptRefinement {
  lyrics?: string;
  style?: string;
  negativeTags?: string;
}

export interface PreparedPromptReference {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  dataUrl: string;
}

export interface PromptReferenceDescriptor {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  mediaType?: MediaFile['type'];
}

export interface OpenAIOutputContent {
  type?: string;
  text?: string;
}

export interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIOutputContent[];
}

export interface OpenAIResponsePayload {
  output_text?: string;
  output?: OpenAIOutputItem[];
  error?: {
    message?: string;
  };
}

export interface OpenAIStreamEvent {
  type?: string;
  delta?: string;
  text?: string;
  message?: string;
  error?: {
    message?: string;
  };
  response?: OpenAIResponsePayload;
}

export interface RefineFlashBoardPromptStreamOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, fullText: string) => void;
}
