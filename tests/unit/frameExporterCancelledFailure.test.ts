import { describe, expect, it, vi } from 'vitest';
import { FrameExporter } from '../../src/engine/export/FrameExporter';
import { FastSourceUnreadableError } from '../../src/engine/export/clipPreparation/fastSourceContainer';
import { ExportDiskFullError } from '../../src/engine/export/exportDiskSpill';

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

  // Production 3.3.8: a .mpeg clip ended the export with "Try PRECISE mode instead"; the person had to start over.
  it('continues in PRECISE when FAST cannot read a source', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 1_000_000,
      startTime: 0, endTime: 1, includeAudio: false,
    });
    const blob = new Blob(['file']);
    const internals = exporter as unknown as { exportAttempt: () => Promise<Blob | null>; exportMode: string };
    const modes: string[] = [];
    vi.spyOn(internals, 'exportAttempt').mockImplementation(async () => {
      modes.push(internals.exportMode);
      if (modes.length === 1) throw new FastSourceUnreadableError('Clip "a.mpeg" is a MPEG program stream file, which FAST export cannot read (it reads MP4 and MOV).');
      return blob;
    });
    await expect(exporter.export(() => {})).resolves.toBe(blob);
    expect(modes).toEqual(['fast', 'precise']);
  });

  // Measured on Chrome: a private window reports 10 GB of storage and refuses writes at about 1 GB.
  it('starts over in memory when the disk fills up and the export fits there', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 8_000_000_000,
      startTime: 0, endTime: 2, includeAudio: false,
    });
    const blob = new Blob(['file']);
    const internals = exporter as unknown as { exportAttempt: () => Promise<Blob | null>; memoryOnly: boolean };
    const memoryOnly: boolean[] = [];
    vi.spyOn(internals, 'exportAttempt').mockImplementation(async () => {
      memoryOnly.push(internals.memoryOnly);
      if (memoryOnly.length === 1) throw new ExportDiskFullError(1024 ** 3);
      return blob;
    });
    await expect(exporter.export(() => {})).resolves.toBe(blob);
    expect(memoryOnly).toEqual([false, true]);
  });

  it('reports a full disk when the export would not fit into memory either', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 8_000_000_000,
      startTime: 0, endTime: 60, includeAudio: false,
    });
    const attempt = vi.spyOn(exporter as unknown as { exportAttempt: () => Promise<Blob | null> }, 'exportAttempt')
      .mockRejectedValue(new ExportDiskFullError(1024 ** 3));
    await expect(exporter.export(() => {})).rejects.toThrow('ran out of storage after writing 1.0 GB');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('reports a failure of the PRECISE attempt as the export failure', async () => {
    const exporter = new FrameExporter({
      width: 64, height: 64, fps: 30, codec: 'h264', container: 'mp4', bitrate: 1_000_000,
      startTime: 0, endTime: 1, includeAudio: false,
    });
    vi.spyOn(exporter as unknown as { exportAttempt: () => Promise<Blob | null> }, 'exportAttempt')
      .mockRejectedValueOnce(new FastSourceUnreadableError('Clip cannot be read'))
      .mockRejectedValueOnce(new Error('The browser cannot decode this clip'));
    await expect(exporter.export(() => {})).rejects.toThrow('cannot decode');
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
