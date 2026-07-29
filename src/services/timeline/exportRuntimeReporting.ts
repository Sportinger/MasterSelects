import { EXPORT_POLICY_ID, getExportRunOwnerId } from './exportReporting/core';
export { createExportRunId, getExportRunOwnerId } from './exportReporting/core';
export {
  canRetainExportAudioBuffer,
  canRetainExportPreviewFrame,
  releaseExportAudioBuffer,
  reportExportAudioBuffer,
  reportExportPreviewFrame,
} from './exportReporting/audioPreviewResources';
export {
  canRetainExportFrameProvider,
  canRetainExportRuntimeBinding,
  releaseReservedExportFrameProvider,
  releaseReservedExportRuntimeBinding,
  reportExportClipStates,
  reserveExportFrameProvider,
  reserveExportRuntimeBinding,
} from './exportReporting/clipResources';
export {
  canRetainExportImageElement,
  canRetainExportPreciseVideoElement,
  releaseReservedExportImageElement,
  releaseReservedExportPreciseVideoElement,
  reserveExportImageElement,
  reserveExportPreciseVideoElement,
} from './exportReporting/elementResources';
export {
  canRetainExportParallelDecoder,
  canRetainExportParallelFrameBuffer,
  releaseReservedExportParallelDecoder,
  releaseReservedExportParallelFrameBuffer,
  reportExportParallelDecodeResources,
  reserveExportParallelDecoder,
  reserveExportParallelFrameBuffer,
} from './exportReporting/parallelDecodeResources';
export {
  canRetainExportOutputSurface,
  canRetainExportRunJob,
  reportExportOutputSurface,
  reportExportRunJob,
} from './exportReporting/runResources';
export type {
  ExportAudioBufferReport,
  ExportAudioBufferStage,
  ExportClipElementAdmissionReport,
  ExportFrameProviderAdmissionReport,
  ExportOutputSurfaceReport,
  ExportParallelDecodeAdmissionReport,
  ExportPreviewFrameReport,
  ExportRunReport,
  ExportRuntimeBindingAdmissionReport,
} from './exportReporting/types';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

export function releaseExportRunResources(runId: string): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: getExportRunOwnerId(runId),
    policyId: EXPORT_POLICY_ID,
  });
}
