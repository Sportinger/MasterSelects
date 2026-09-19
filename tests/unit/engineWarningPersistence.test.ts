import { beforeEach, describe, expect, it } from 'vitest';

import { useEngineStore } from '../../src/stores/engineStore';

describe('engine warning persistence', () => {
  beforeEach(() => {
    localStorage.removeItem('linux-vulkan-warning-dismissed');
    useEngineStore.setState({ linuxVulkanWarning: false });
  });

  it('keeps the Linux/Vulkan notice hidden after it is dismissed', () => {
    useEngineStore.getState().setLinuxVulkanWarning(true);
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(true);

    useEngineStore.getState().dismissLinuxVulkanWarning();
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(false);

    useEngineStore.getState().setLinuxVulkanWarning(true);
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(false);
  });
});
