import { renderHostPort } from '../render/renderHostPort';

export const BRUSH_RUNTIME_COMPRESSED_ESTIMATE_BYTES = 6_700_000;

export type ScanGpuStatus = 'checking' | 'ready' | 'limited' | 'unavailable';

export interface ScanGpuCapability {
  status: ScanGpuStatus;
  webGpu: boolean;
  subgroups: boolean;
  adapterName: string;
  maxBufferSize: number;
  maxStorageBufferSize: number;
  isMobile: boolean;
  message: string;
}

const CHECKING_CAPABILITY: ScanGpuCapability = {
  status: 'checking',
  webGpu: false,
  subgroups: false,
  adapterName: 'Checking GPU…',
  maxBufferSize: 0,
  maxStorageBufferSize: 0,
  isMobile: false,
  message: 'Checking WebGPU training support.',
};

export function getCheckingScanGpuCapability(): ScanGpuCapability {
  return { ...CHECKING_CAPABILITY };
}

function looksLikeMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const navigatorWithHints = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return navigatorWithHints.userAgentData?.mobile === true
    || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

type GPUDeviceWithAdapterInfo = GPUDevice & { adapterInfo?: GPUAdapterInfo };

async function waitForEditorDevice(timeoutMs: number): Promise<GPUDevice | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const device = renderHostPort.getDevice();
    if (device) return device;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return renderHostPort.getDevice();
}

export async function probeScanGpuCapability(): Promise<ScanGpuCapability> {
  const isMobile = looksLikeMobileDevice();
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      ...CHECKING_CAPABILITY,
      status: 'unavailable',
      adapterName: 'No WebGPU adapter',
      isMobile,
      message: 'WebGPU is unavailable. Use current Chrome or Edge on a supported GPU.',
    };
  }

  try {
    // Prefer the editor's adapter. Asking WebGPU for another adapter while the
    // main engine initializes can terminate the GPU process on mobile WebKit.
    const editorDevice = renderHostPort.getDevice() ?? await waitForEditorDevice(2_500);
    const adapter = editorDevice ? null : (isMobile
      ? null
      : await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }));
    if (!editorDevice && !adapter) {
      return {
        ...CHECKING_CAPABILITY,
        status: 'unavailable',
        webGpu: true,
        adapterName: isMobile ? 'Editor GPU is still starting' : 'No compatible adapter',
        isMobile,
        message: isMobile
          ? 'Wait for Preview to appear, then reopen 3D Scan. No second mobile GPU adapter was requested.'
          : 'The browser exposes WebGPU but could not select a GPU adapter.',
      };
    }

    const features = editorDevice?.features ?? adapter!.features;
    const limits = editorDevice?.limits ?? adapter!.limits;
    const info = editorDevice
      ? (editorDevice as GPUDeviceWithAdapterInfo).adapterInfo
      : adapter!.info;
    const subgroups = features.has('subgroups');
    const adapterName = info?.description || info?.device || info?.vendor || 'WebGPU adapter';
    return {
      status: subgroups ? 'ready' : 'limited',
      webGpu: true,
      subgroups,
      adapterName,
      maxBufferSize: Number(limits.maxBufferSize),
      maxStorageBufferSize: Number(limits.maxStorageBufferBindingSize),
      isMobile,
      message: subgroups
        ? `GPU splat training is available${isMobile ? '; use the Mobile preset to limit heat and memory' : ''}.`
        : 'WebGPU works, but this adapter lacks the subgroup feature required by Brush training.',
    };
  } catch (error) {
    return {
      ...CHECKING_CAPABILITY,
      status: 'unavailable',
      webGpu: true,
      adapterName: 'WebGPU probe failed',
      isMobile,
      message: error instanceof Error ? error.message : 'The WebGPU capability check failed.',
    };
  }
}

export function formatScanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
