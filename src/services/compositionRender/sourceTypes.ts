import type { Layer, LayerSource } from '../../types/layers';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { VectorAnimationProvider } from '../../types/vectorAnimation';

export type CompositionClipSourceEntry = {
  clipId: string;
  compositionId?: string;
  type: 'video' | 'image' | 'audio' | 'text' | 'math-scene' | 'transition-overlay' | VectorAnimationProvider;
  videoElement?: HTMLVideoElement;
  webCodecsPlayer?: LayerSource['webCodecsPlayer'];
  imageElement?: HTMLImageElement;
  textCanvas?: HTMLCanvasElement;
  file?: File;
  lottieClip?: TimelineClip;
  mathSceneClip?: TimelineClip;
  naturalDuration: number;
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  runtimeOwnerId?: string;
  mediaFileId?: string;
  ownedObjectUrl?: string;
};

export type CompositionImageSource = {
  url: string;
  file?: File;
  objectUrl?: string;
  name: string;
};

export type CompositionLoadClip = {
  id: string;
  name: string;
  mediaFileId?: string;
  naturalDuration?: number;
};

export type CompositionMediaFile = {
  id: string;
  name?: string;
  file?: File;
  url?: string;
  duration?: number;
  proxyFps?: number;
  proxyFormat?: string;
  proxyStatus?: string;
};

export type CompositionInfo = {
  id: string;
  width?: number;
  height?: number;
};

export interface CompositionSources {
  compositionId: string;
  clipSources: Map<string, CompositionClipSourceEntry>;
  pendingSourceDisposers: Map<string, () => void>;
  isReady: boolean;
  disposed: boolean;
  lastAccessTime: number;
}

export interface EvaluatedLayer extends Omit<Layer, 'id'> {
  id: string;
  clipId: string;
}

export type CompositionClip = SerializableClip | TimelineClip;
