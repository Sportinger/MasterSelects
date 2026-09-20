import type { PreviewDrawing } from './previewTypes';

export interface ArtifactSampleRequest {
  id: number; artifact: string; data?: string; format: 'scene' | 'cables'; stage: string; time: number;
}
export interface ArtifactSampleResult { id: number; drawing?: PreviewDrawing; label: string }
