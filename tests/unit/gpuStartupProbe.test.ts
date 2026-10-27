import { afterEach, describe, expect, it } from 'vitest';
import { collectDiagnosticContext } from '../../src/services/diagnostics/diagnosticContext';
import {
  recordGpuAdapter,
  recordGpuAdapterAttempt,
  recordGpuStartupFailure,
  resetGpuStartupProbeForTests,
} from '../../src/services/diagnostics/gpuStartupProbe';

// Production: ~180 sessions failed with "WebGPU not supported" or "Failed to get GPU
// adapter (all attempts)" and carried `webgpu.adapter: null` — no GPU identity at all.
describe('GPU startup probe in diagnostic context', () => {
  afterEach(() => resetGpuStartupProbeForTests());

  it('is absent until WebGPU startup records something', () => {
    expect(collectDiagnosticContext().webgpu?.startup).toBeUndefined();
  });

  it('carries every adapter attempt and the failure when no adapter exists', () => {
    recordGpuAdapterAttempt('requestAdapter (with powerPreference)', 'null', 12.4);
    recordGpuAdapterAttempt('requestAdapter (no preference)', 'rejected:OperationError', 3);
    recordGpuStartupFailure('adapter_unavailable');
    const startup = collectDiagnosticContext().webgpu?.startup;
    expect(startup).toMatchObject({
      failure: 'adapter_unavailable',
      attempts: [
        { label: 'requestAdapter (with powerPreference)', result: 'null', ms: 12 },
        { label: 'requestAdapter (no preference)', result: 'rejected:OperationError', ms: 3 },
      ],
    });
    expect(startup).toHaveProperty('webgl');
  });

  it('keeps adapter identity for failures after an adapter was obtained', () => {
    recordGpuAdapterAttempt('requestAdapter (with powerPreference)', 'ok', 8);
    recordGpuAdapter({ info: { vendor: 'intel', architecture: 'gen-8', device: '', description: '' }, featureLevel: 'core' } as unknown as GPUAdapter);
    recordGpuStartupFailure('device_timeout');
    expect(collectDiagnosticContext().webgpu?.startup).toMatchObject({
      failure: 'device_timeout',
      adapter: { vendor: 'intel', architecture: 'gen-8', featureLevel: 'core' },
    });
  });

  // Field data (Pixel 10 Pro, PowerVR): init took 27.8 s against a 15 s adapter deadline. After a
  // timeout the GPU process is stuck, and creating a WebGL context there blocks the main thread.
  it('skips the WebGL hint after an adapter request timed out, and says so', () => {
    recordGpuAdapterAttempt('requestAdapter (core)', 'timeout', 15_000);
    recordGpuStartupFailure('adapter_timeout');
    const startup = collectDiagnosticContext().webgpu?.startup;
    expect(startup).toMatchObject({ failure: 'adapter_timeout', webglSkipped: 'adapter_timeout' });
    expect(startup?.webgl).toBeUndefined();
  });

  it('bounds the attempt list', () => {
    for (let index = 0; index < 20; index += 1) recordGpuAdapterAttempt(`attempt ${index}`, 'null', 1);
    expect(collectDiagnosticContext().webgpu?.startup?.attempts).toHaveLength(8);
  });
});
