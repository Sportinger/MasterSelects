import type { FlockAudioSampler } from '../../../services/flock/compiler/flockParamEvaluation';
import type { FlockRenderAssets } from '../gpu/FlockRenderAssets';
import type { FlockRuntimeStatus } from './flockRuntimeApi';

/** Environment operations; the shared GPU runtime owns sessions and caches. */
export interface FlockSimulationHost {
  requestRender(): void;
  renderAssets(device: GPUDevice): FlockRenderAssets;
  audioSampler(clipId: string): FlockAudioSampler;
  audioRevision(): number;
  audioFingerprint(clipId: string, audioClipIds: readonly string[]): string;
  modelState(assetId: string): {
    status: 'loading' | 'ready' | 'missing' | 'failed';
    message?: string;
    decimated?: boolean;
  } | null | undefined;
  status: {
    getStatus(clipId: string): FlockRuntimeStatus | null | undefined;
    publishStatus(status: FlockRuntimeStatus): void;
    clearStatus(clipId: string): void;
  };
}
