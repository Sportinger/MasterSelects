import { expect, it, vi } from 'vitest';
import { WebGPUContext } from '../../src/engine/core/WebGPUContext';
import { attachWebGPUDeviceDiagnostics, getRecentRuntimeDiagnosticEntries } from '../../src/services/runtimeDiagnostics';

it.each([
  { intentional: true, preference: false, reason: 'destroyed', level: 'INFO' },
  { intentional: true, preference: true, reason: 'destroyed', level: 'INFO' },
  { intentional: false, preference: false, reason: 'destroyed', level: 'ERROR' },
  { intentional: true, preference: false, reason: 'unknown', level: 'ERROR' },
])('records $reason loss after intentional destruction=$intentional, preference=$preference as $level', async ({ intentional, preference, reason, level }) => {
  let lose!: (info: GPUDeviceLostInfo) => void;
  const device = {
    lost: new Promise<GPUDeviceLostInfo>(resolve => { lose = resolve; }),
    addEventListener: vi.fn(),
    destroy: () => lose({ reason, message: 'Device lost during audit' } as GPUDeviceLostInfo),
  } as unknown as GPUDevice;
  const context = new WebGPUContext();
  (context as unknown as { device: GPUDevice | null }).device = device;
  attachWebGPUDeviceDiagnostics(device, 'intentional-teardown-audit');
  if (preference) {
    vi.spyOn(context, 'initialize').mockResolvedValue(false);
    await context.reinitializeWithPreference('low-power');
  } else if (intentional) context.destroy();
  else device.destroy();
  await Promise.resolve();
  const entry = getRecentRuntimeDiagnosticEntries(20).findLast(entry => entry.details?.label === 'intentional-teardown-audit');
  expect(entry).toMatchObject({ source: 'webgpu-device-lost', level, details: { reason, expected: level === 'INFO' } });
  if (intentional) expect(context.getDevice()).toBeNull();
});
