import { describe, expect, it, vi } from 'vitest';
import { FrameExporter } from '../../src/engine/export/FrameExporter';

describe('FrameExporter cancellation', () => {
  it('reports an error thrown by a frame still decoding after the cancel as a cancelled export', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 1_000_000,
      startTime: 0, endTime: 1, includeAudio: false,
    });
    vi.spyOn(exporter as unknown as { exportAttempt: () => Promise<Blob | null> }, 'exportAttempt').mockImplementation(async () => {
      exporter.cancel();
      // Production 3.3.5: teardown removed the decoder while a restart was waiting for a frame.
      throw new Error('FAST export decoder missing during waitForBufferedTarget');
    });
    await expect(exporter.export(() => {})).resolves.toBeNull();
  });

  it('still fails an export that was not cancelled', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 1_000_000,
      startTime: 0, endTime: 1, includeAudio: false,
    });
    vi.spyOn(exporter as unknown as { exportAttempt: () => Promise<Blob | null> }, 'exportAttempt')
      .mockRejectedValue(new Error('FAST export decoder missing during waitForBufferedTarget'));
    await expect(exporter.export(() => {})).rejects.toThrow('decoder missing');
  });
});
