export type LandmarkKind = 'hand' | 'face' | 'pose';

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
export interface LandmarkFrame {
  time: number;
  duration?: number;
  faceBlendshapes?: Record<string, number>;
  faceTransform?: number[];
  hands: LandmarkPoint[][];
  faces: LandmarkPoint[][];
  poses: LandmarkPoint[][];
}

export interface LandmarkSeries {
  version: 1;
  clipId: string;
  sourceId?: string;
  sampleInterval: number;
  createdAt: number;
  frames: LandmarkFrame[];
  faceTracking?: {
    mode?: 'independent' | 'video';
    sourceStart: number;
    sourceEnd: number;
    detectedFrames: number;
    contours: { name: string; color: string; edges: [number, number][] }[];
  };
}

export interface LandmarkTrackingRequest {
  clipId: string;
  sourceId?: string;
  video: HTMLVideoElement;
  sourceStart: number;
  duration: number;
  kinds: LandmarkKind[];
  maxFrames?: number;
}
