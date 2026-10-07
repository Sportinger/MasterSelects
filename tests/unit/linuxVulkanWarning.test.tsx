import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxVulkanWarning } from '../../src/components/common/LinuxVulkanWarning';
import { useEngineStore } from '../../src/stores/engineStore';

describe('Linux GPU troubleshooting', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.removeItem('linux-vulkan-warning-dismissed');
    useEngineStore.getState().setEngineInitFailed(false);
  });

  function platform(platform: string, userAgent = 'Chrome desktop') {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  }

  it('shows on Linux failure and clears after recovery', () => {
    platform('Linux x86_64');
    useEngineStore.getState().setEngineInitFailed(true, 'No compatible GPU');
    render(<LinuxVulkanWarning />);
    expect(screen.getByText('WebGPU unavailable on Linux:')).toBeTruthy();
    cleanup();
    useEngineStore.getState().setEngineInitFailed(false);
    render(<LinuxVulkanWarning />);
    expect(screen.queryByText('WebGPU unavailable on Linux:')).toBeNull();
  });

  it.each([
    ['Win32', 'Chrome desktop'],
    ['MacIntel', 'Chrome desktop'],
    ['Linux armv8l', 'Chrome Android'],
  ])('does not show on %s / %s failure', (os, agent) => {
    platform(os, agent);
    useEngineStore.getState().setEngineInitFailed(true);
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(false);
  });

  it('remembers dismissal across later failures', () => {
    platform('Linux x86_64');
    useEngineStore.getState().setEngineInitFailed(true);
    render(<LinuxVulkanWarning />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Linux GPU warning' }));
    useEngineStore.getState().setEngineInitFailed(false);
    useEngineStore.getState().setEngineInitFailed(true);
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(false);
  });
});
