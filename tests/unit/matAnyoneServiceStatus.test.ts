import { describe, expect, it } from 'vitest';

import { resolveMatAnyoneSetupStatus } from '../../src/services/matanyone/MatAnyoneService';
import type { MatAnyoneStatusResponse } from '../../src/services/nativeHelper/protocol';

function status(
  overrides: Partial<MatAnyoneStatusResponse> = {},
): MatAnyoneStatusResponse {
  return {
    setup_status: 'partially_installed',
    python_version: '3.11.0',
    cuda_available: false,
    cuda_version: null,
    gpu_name: null,
    vram_mb: null,
    model_downloaded: true,
    venv_exists: true,
    deps_installed: true,
    matanyone_installed: false,
    server_running: false,
    server_port: null,
    server_error: null,
    ...overrides,
  };
}

describe('MatAnyone2 setup status mapping', () => {
  it('requires runtime setup when a stale runtime has valid model weights', () => {
    expect(resolveMatAnyoneSetupStatus(status({ cuda_available: true }))).toBe('not-installed');
  });

  it('blocks CPU fallback when CUDA is unavailable', () => {
    expect(resolveMatAnyoneSetupStatus(status())).toBe('gpu-required');
    expect(resolveMatAnyoneSetupStatus(status({
      setup_status: 'gpu_required',
      server_error: 'stale sidecar error',
    }))).toBe('gpu-required');
  });

  it('requests weights only after the pinned runtime is installed', () => {
    expect(resolveMatAnyoneSetupStatus(status({
      matanyone_installed: true,
      model_downloaded: false,
      cuda_available: true,
    }))).toBe('model-needed');
  });

  it('reports a complete stopped or running installation', () => {
    expect(resolveMatAnyoneSetupStatus(status({
      setup_status: 'installed',
      matanyone_installed: true,
      cuda_available: true,
    }))).toBe('installed');
    expect(resolveMatAnyoneSetupStatus(status({
      setup_status: 'running',
      matanyone_installed: true,
      server_running: true,
      cuda_available: true,
    }))).toBe('ready');
  });

  it('surfaces sidecar crashes as errors', () => {
    expect(resolveMatAnyoneSetupStatus(status({
      setup_status: 'error',
      matanyone_installed: true,
      server_error: 'sidecar exited',
      cuda_available: true,
    }))).toBe('error');
  });
});
