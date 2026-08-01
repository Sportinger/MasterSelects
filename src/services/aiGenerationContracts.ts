export interface VideoProvider {
  id: string;
  name: string;
  description: string;
  versions: string[];
  supportedModes: string[];
  supportedDurations: number[];
  supportedAspectRatios: string[];
  supportsImageToVideo: boolean;
  supportsTextToVideo: boolean;
}

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface HostedAiRefundInfo {
  creditBalance: number;
  credits: number;
  idempotencyKey?: string | null;
  jobId: string;
  ledgerEntryId?: string | null;
  refunded: boolean;
}

export interface VideoTask {
  id: string;
  status: TaskStatus;
  progress?: number;
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
  refund?: HostedAiRefundInfo;
  createdAt: Date;
  completedAt?: Date;
}

export interface TextToVideoParams {
  provider: string;
  version: string;
  prompt: string;
  negativePrompt?: string;
  duration: number;
  aspectRatio: string;
  mode: string;
  cfgScale?: number;
  sound?: boolean;
  multiShots?: boolean;
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>;
  referenceMedia?: GenerationReferenceMedia[];
}

export interface ImageToVideoParams {
  provider: string;
  version: string;
  prompt: string;
  negativePrompt?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  duration: number;
  aspectRatio?: string;
  mode: string;
  cfgScale?: number;
  sound?: boolean;
  multiShots?: boolean;
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>;
  referenceMedia?: GenerationReferenceMedia[];
}

export interface AccountInfo {
  accountName: string;
  accountId: string;
  credits: number;
  creditsUsd: number;
}

export type GenerationReferenceMediaType = 'image' | 'video' | 'audio';

export interface GenerationReferenceMedia {
  id?: string;
  mediaType: GenerationReferenceMediaType;
  source: Blob | string;
  fileName?: string;
  label?: string;
  mimeType?: string;
}

export interface TextToImageParams {
  provider: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  imageInputs?: string[];
  referenceMedia?: GenerationReferenceMedia[];
}
