export interface FlashBoardStoreState {
  activeBoardId: string | null;
  boards: FlashBoard[];
  selectedNodeIds: string[];
  viewMode: 'board';
  composer: { draftNodeId: string | null; isOpen: boolean };
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
  service: 'piapi' | 'kieai' | 'cloud';
  providerId: string;
  version: string;
  outputType?: 'video' | 'image';
  mode?: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
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
  mediaType: 'video' | 'image';
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
  providerId: string;
  version: string;
  prompt: string;
  negativePrompt?: string;
  duration?: number;
  aspectRatio?: string;
  imageSize?: string;
  generateAudio?: boolean;
  startMediaFileId?: string;
  endMediaFileId?: string;
  referenceMediaFileIds: string[];
  createdAt: string;
}
