import { useSyncExternalStore } from 'react';
import { getGpuPipelineFailures, subscribeGpuPipelineFailures } from '../../engine/core/gpuPipelineGuard';

/**
 * Names the features this device's GPU driver could not build. They are skipped
 * so the rest of the frame keeps rendering; effects also say so in their inspector.
 */
export function PreviewGpuFailureNotice() {
  const failures = useSyncExternalStore(subscribeGpuPipelineFailures, getGpuPipelineFailures);
  const features = [...new Set(failures.filter(failure => failure.source === 'editor').map(failure => failure.feature))];
  if (features.length === 0) return null;
  return (
    <div className="preview-splat-progress-overlay preview-gpu-failure error" role="status" aria-live="polite"
      title={failures.map(failure => `${failure.label}: ${failure.message}`).join('\n')}>
      <div className="preview-splat-progress-header"><span>Not supported by this graphics driver</span></div>
      <div className="preview-splat-progress-name">
        {features.join(', ')} could not be built on this device and {features.length === 1 ? 'is' : 'are'} skipped. Everything else keeps rendering.
      </div>
    </div>
  );
}
