import type {
  RenderCapabilityProbeResult,
  RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerFirstProofPlatform,
} from './workerFirstW5Gates';

export function isWorkerFirstProofPlatform(value: unknown): value is WorkerFirstProofPlatform {
  return typeof value === 'string'
    && WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.includes(value as WorkerFirstProofPlatform);
}

export function isWorkerFirstPresentationStrategy(value: unknown): value is RenderPresentationStrategy {
  return value === 'worker-webgpu-present'
    || value === 'worker-webgpu-main-present'
    || value === 'worker-cpu-present'
    || value === 'main-host-dev';
}

function adapterLooksMesa(adapter: RenderCapabilityProbeResult['gpuAdapter']): boolean {
  const details = [
    adapter?.name,
    adapter?.vendor,
    adapter?.architecture,
    adapter?.device,
    adapter?.description,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(mesa|radv|radeonsi|nvk|llvmpipe|lavapipe)\b/.test(details);
}

export function resolveWorkerFirstProofPlatformFromProbe(
  probe: RenderCapabilityProbeResult,
): WorkerFirstProofPlatform | null {
  if (probe.os === 'windows' && probe.browserEngine === 'chromium') {
    return 'windows-chromium';
  }
  if (probe.os === 'linux' && probe.browserEngine === 'chromium' && adapterLooksMesa(probe.gpuAdapter)) {
    return 'linux-chromium-mesa';
  }
  if (probe.os === 'linux' && probe.browserEngine === 'firefox' && adapterLooksMesa(probe.gpuAdapter)) {
    return 'linux-firefox-mesa';
  }
  if (probe.os === 'macos' && probe.browserEngine === 'webkit') {
    return 'macos-safari';
  }
  if (probe.os === 'macos' && probe.browserEngine === 'firefox') {
    return 'macos-firefox';
  }
  return null;
}
