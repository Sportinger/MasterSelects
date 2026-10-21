import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxVulkanWarning } from '../../src/components/common/LinuxVulkanWarning';
import { PreviewEngineFailureNotice } from '../../src/components/preview/PreviewEngineFailureNotice';
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

  it('gives no Vulkan setup advice when recovery fails after the GPU already worked', () => {
    platform('Linux x86_64');
    useEngineStore.getState().setEngineInitFailed(true, 'The GPU stopped responding', { setupAdvice: false });
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(false);
    render(<PreviewEngineFailureNotice error="The GPU stopped responding" />);
    expect(screen.getByText('The GPU stopped responding')).toBeTruthy();
    expect(screen.queryByText(/Vulkan support may need to be enabled/)).toBeNull();
    cleanup();
    useEngineStore.getState().setEngineInitFailed(true, 'No compatible GPU');
    expect(useEngineStore.getState().linuxVulkanWarning).toBe(true);
    render(<PreviewEngineFailureNotice error="No compatible GPU" />);
    expect(screen.getByText(/Vulkan support may need to be enabled/)).toBeTruthy();
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
