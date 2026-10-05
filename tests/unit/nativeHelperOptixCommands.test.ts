import { describe, expect, it, vi } from 'vitest';
import { createOptixCommands } from '../../src/services/nativeHelper/nativeHelperOptixCommands';
import type { NativeHelperCommandHost } from '../../src/services/nativeHelper/nativeHelperClientTypes';

function fixture() {
  const send = vi.fn(), fetchWithAuth = vi.fn();
  const host = { nextId: () => 'request', send, fetchWithAuth, getHttpBaseUrl: () => 'http://127.0.0.1:9877' } as unknown as NativeHelperCommandHost;
  return { commands: createOptixCommands(host), send, fetchWithAuth };
}
describe('OptiX helper client', () => {
  it('uses the connection-owned job and authenticates binary reads', async () => {
    const { commands, send, fetchWithAuth } = fixture();
    send.mockResolvedValue({ ok: true, outputPath: 'C:/render job/result.rgba32f', metrics: { width: 2, height: 1, samples: 4 } });
    fetchWithAuth.mockResolvedValue(new Response(new Float32Array(8)));
    const result = await commands.render('owned-job', 4);
    expect(send).toHaveBeenCalledWith({ cmd: 'optix', id: 'request', action: 'render', job_id: 'owned-job', samples: 4 }, 125_000);
    expect(fetchWithAuth.mock.calls[0][0]).toContain('path=C%3A%2Frender%20job%2Fresult.rgba32f');
    expect(result.pixels.length).toBe(8);
  });
  it('rejects missing workers, inconsistent sample counts and truncated images', async () => {
    const { commands, send, fetchWithAuth } = fixture();
    send.mockResolvedValue({ ok: false, error: { message: 'Worker missing' } });
    await expect(commands.begin()).rejects.toThrow('Worker missing');
    send.mockResolvedValue({ ok: true, outputPath: 'image', metrics: { width: 2, height: 1, samples: 3 } });
    await expect(commands.render('job', 4)).rejects.toThrow('Invalid');
    expect(fetchWithAuth).not.toHaveBeenCalled();
    send.mockResolvedValue({ ok: true, outputPath: 'image', metrics: { width: 2, height: 1, samples: 4 } });
    fetchWithAuth.mockResolvedValue(new Response(new Float32Array(4)));
    await expect(commands.render('job', 4)).rejects.toThrow('Truncated');
  });
});
