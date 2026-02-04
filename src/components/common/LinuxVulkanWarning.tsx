// LinuxVulkanWarning - Warning banner for Linux users about Vulkan
// Shows when Linux is detected, can be dismissed and won't show again

import { useEngineStore } from '../../stores/engineStore';

export function LinuxVulkanWarning() {
  const linuxVulkanWarning = useEngineStore((s) => s.linuxVulkanWarning);
  const dismissLinuxVulkanWarning = useEngineStore((s) => s.dismissLinuxVulkanWarning);

  if (!linuxVulkanWarning) return null;

  return (
    <div className="linux-vulkan-warning">
      <div className="linux-vulkan-warning-content">
        <span className="linux-vulkan-warning-icon">⚠️</span>
        <span className="linux-vulkan-warning-text">
          <strong>Linux detected:</strong> For best performance (60fps), enable Vulkan in Chrome.
          Go to <code>chrome://flags/#enable-vulkan</code> and set it to <strong>Enabled</strong>, then restart Chrome.
        </span>
        <button
          className="linux-vulkan-warning-dismiss"
          onClick={dismissLinuxVulkanWarning}
          title="Dismiss (won't show again)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
