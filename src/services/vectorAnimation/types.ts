import type { VectorAnimationMetadata } from '../../types/vectorAnimation';

export type LottieRuntimePayload =
  | {
    kind: 'json';
    data: string;
    sourceKey: string;
  }
  | {
    kind: 'dotlottie';
    data: ArrayBuffer;
    sourceKey: string;
  };

export interface PreparedLottieAsset {
  metadata: VectorAnimationMetadata;
  payload: LottieRuntimePayload;
}

export interface LottieRuntimePrepareResult {
  canvas: HTMLCanvasElement;
  metadata: VectorAnimationMetadata;
}

export interface RiveRuntimePayload {
  data: ArrayBuffer;
  sourceKey: string;
}

export interface PreparedRiveAsset {
  metadata: VectorAnimationMetadata;
  payload: RiveRuntimePayload;
}

export interface RiveRuntimePrepareResult {
  canvas: HTMLCanvasElement;
  metadata: VectorAnimationMetadata;
}

export type VectorAnimationRuntimePrepareResult =
  | LottieRuntimePrepareResult
  | RiveRuntimePrepareResult;
