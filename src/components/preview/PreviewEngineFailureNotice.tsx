import { useEngineStore } from '../../stores/engineStore';

interface PreviewEngineFailureNoticeProps {
  error: string | null;
}

export function PreviewEngineFailureNotice({ error }: PreviewEngineFailureNoticeProps) {
  // Setup help is wrong when the GPU already worked in this session (recovery failure).
  const setupAdvice = useEngineStore((s) => s.engineInitSetupAdvice);
  return (
    <div className="preview-webgpu-failure" role="alert" aria-live="assertive">
      <span className="preview-webgpu-failure-icon" aria-hidden="true">!</span>
      <h2 className="preview-webgpu-failure-title">WebGPU is not working</h2>
      <p className="preview-webgpu-failure-message">
        {error || 'The preview renderer could not be initialized.'}
      </p>
      {setupAdvice && (
        <p className="preview-webgpu-failure-help">
          Check hardware acceleration and your graphics driver. On Linux, Vulkan support may need to be enabled.
        </p>
      )}
    </div>
  );
}
