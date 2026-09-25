import type { ImageOperatorProgram } from '../../types/imageOperatorProgram';
import type { ImageOperatorExternalResource } from './imageOperatorExternalResources';
import type { ImageOperatorFieldResource } from './imageOperatorFieldResources';
import type { ImageOperatorResourceSampling } from './imageOperatorResources';
import type { ImageOperatorValueBinding } from './imageOperatorValueBindings';

export type ImagePlanValue = 'image' | 'rgb' | 'alpha' | 'scalar' | 'boolean' | 'vec2' | 'vec3' | 'vec4';
export type ImageOperatorCapability = 'uv' | 'resolution' | 'time' | 'sample' | 'pixel-load' | 'derivative';
export interface ImageOperatorEvaluationContext {
  uv?: [number, number]; resolution?: [number, number]; timelineTimeSeconds?: number;
  sampleInputHistory?: (uv: [number, number], delay: number, current: [number, number, number, number]) => [number, number, number, number];
  sampleMotionHistory?: (owner: string, uv: [number, number], delay: number) => [number, number, number, number];
  /** Already analysed DIS field in graph-clock UV/second, confidence, validity. */
  sampleDisMotion?: (owner: string, uv: [number, number], delay: number) => [number, number, number, number];
  sampleImage?: (uv: [number, number]) => [number, number, number, number];
  sampleResource?: (resourceId: string, uv: [number, number]) => [number, number, number, number];
  loadImage?: (pixel: [number, number]) => [number, number, number, number];
  loadResource?: (resourceId: string, pixel: [number, number]) => [number, number, number, number];
  readResourceMetadata?: (resourceId: string) => [number, number, number, number];
  loadUintResource?: (resourceId: string, pixel: [number, number]) => number;
  pixelCoordinate?: [number, number]; derivativeAutoMode?: 'fine' | 'coarse';
}
export interface ImagePlanInstruction {
  nodeId: string; operation: string; type: ImagePlanValue; inputs: number[]; value?: number;
  color?: [number, number, number, number]; scope?: number;
  resourceSlots?: number[];
}
export interface ImageOperatorSampleScope {
  id: number; output: number; type?: 'image' | 'scalar'; coordinate?: 'uv' | 'pixel';
  reducerContext?: { kind: 'kernel' | 'sequence'; id: number };
}
export interface ImageOperatorPlan extends ImageOperatorProgram {
  valueBindings?: readonly ImageOperatorValueBinding[];
  fusion: 'inline'; capabilities: readonly ImageOperatorCapability[]; instructions: ImagePlanInstruction[]; output: number;
  sampleScopes: readonly ImageOperatorSampleScope[];
  kernelScopes?: readonly { id: number; sample: number; weight: number }[];
  rectScopes?: readonly { id: number; sample: number; weight: number }[];
  sequenceScopes?: readonly { id: number; sample: number; weight: number; blend?: boolean }[];
  segmentSortScopes?: readonly { id: number; sample: number }[];
  quadtreeScopes?: readonly { id: number; sample: number }[];
  resourceInputs?: readonly string[]; resourceSampling?: readonly ImageOperatorResourceSampling[];
  passes?: readonly { id: string; program: ImageOperatorPlan; inputResources: readonly string[]; outputResource?: string }[];
  resources?: readonly { id: string; producerPassId: string; format: 'rgba16float'; maxEdge?: number }[];
  previewResourceId?: string; frameHistoryResource?: string;
  externalResources?: readonly ImageOperatorExternalResource[]; fieldResources?: readonly ImageOperatorFieldResource[];
}
