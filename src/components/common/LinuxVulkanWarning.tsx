// LinuxVulkanWarning - Warning banner for Linux users about Vulkan
// Shows after WebGPU initialization fails on desktop Linux.

import './LinuxPlatformBanner.css';
import { useEngineStore } from '../../stores/engineStore';

export function LinuxVulkanWarning() {
  const linuxVulkanWarning = useEngineStore((s) => s.linuxVulkanWarning);
  const dismissLinuxVulkanWarning = useEngineStore((s) => s.dismissLinuxVulkanWarning);

  if (!linuxVulkanWarning) return null;

  return (
    <div className="linux-banner">
      <div className="linux-banner-content">
        <span className="linux-banner-icon">⚠️</span>
        <span className="linux-banner-text">
          <strong>WebGPU unavailable on Linux:</strong> Check hardware acceleration and your graphics driver. In Chrome, try enabling Vulkan.
          Go to <code>chrome://flags/#enable-vulkan</code> and set it to <strong>Enabled</strong>, then restart Chrome.
        </span>
        <button
          className="linux-banner-dismiss"
          onClick={dismissLinuxVulkanWarning}
          onPointerUp={(event) => event.currentTarget.blur()}
          aria-label="Dismiss Linux GPU warning"
          title="Dismiss (won't show again)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
