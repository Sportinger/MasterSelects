import { describe, expect, it, vi } from 'vitest';
import { createMatAnyoneCommands } from '../../src/services/nativeHelper/nativeHelperMatAnyoneCommands';
import type {
  NativeHelperCommandHost,
  ResponseCallback,
} from '../../src/services/nativeHelper/nativeHelperClientTypes';
import type { Command, Response } from '../../src/services/nativeHelper/protocol';

function createHost() {
  const pending = new Map<string, ResponseCallback>();
  const rawMessages: string[] = [];
  let requestId = 0;
  const host: NativeHelperCommandHost = {
    nextId: () => `request-${++requestId}`,
    isConnected: () => true,
    send: vi.fn(async (command: Command) => ({
      id: 'id' in command ? command.id : '',
      ok: true,
    } as Response)),
    sendRaw: vi.fn(async (data) => {
      rawMessages.push(String(data));
    }),
    registerPendingRequest: (id, callback) => pending.set(id, callback),
    getPendingRequest: (id) => pending.get(id),
    deletePendingRequest: (id) => pending.delete(id),
    registerFrameCallback: vi.fn(),
    deleteFrameCallback: vi.fn(),
    setProgressCallback: vi.fn(),
    getProgressCallback: vi.fn(),
    deleteProgressCallback: vi.fn(),
    getHttpBaseUrl: () => 'http://127.0.0.1:9877',
    getInfo: vi.fn(),
    fetchWithAuth: vi.fn(),
    fetchWithTimeout: vi.fn(),
    dispatchFrame: vi.fn(),
  };
  return { host, pending, rawMessages };
}

describe('MatAnyone2 native-helper commands', () => {
  it('keeps a slow server start pending across progress and preserves backend errors', async () => {
    const { host, pending, rawMessages } = createHost();
    const commands = createMatAnyoneCommands(host);
    const promise = commands.start();
    const sent = JSON.parse(rawMessages[0]) as { id: string; cmd: string };

    expect(sent.cmd).toBe('mat_anyone_start');
    pending.get(sent.id)?.({
      id: sent.id,
      type: 'progress',
      step: 'start_server',
      percent: 0,
    } as never);
    expect(pending.has(sent.id)).toBe(true);

    pending.get(sent.id)?.({
      id: sent.id,
      ok: false,
      error: { code: 'MATANYONE_NOT_INSTALLED', message: 'Local model is missing' },
    });

    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Local model is missing',
    });
    expect(pending.has(sent.id)).toBe(false);
  });

  it('delivers matting progress and removes the pending request on completion', async () => {
    const { host, pending, rawMessages } = createHost();
    const commands = createMatAnyoneCommands(host);
    const progress: number[] = [];
    const promise = commands.matte(
      'C:\\project\\source.mp4',
      'C:\\project\\mask.png',
      'C:\\project\\output',
      { startFrame: 4, endFrame: 12 },
      (_current, _total, percent) => progress.push(percent),
    );
    const sent = JSON.parse(rawMessages[0]) as { id: string };

    pending.get(sent.id)?.({
      id: sent.id,
      type: 'progress',
      current_frame: 3,
      total_frames: 8,
      percent: 37.5,
      job_id: 'mat-1',
    } as never);
    pending.get(sent.id)?.({
      id: sent.id,
      ok: true,
      foreground_path: 'C:\\project\\output\\foreground.webm',
      alpha_path: 'C:\\project\\output\\alpha.webm',
      job_id: 'mat-1',
    });

    await expect(promise).resolves.toMatchObject({ job_id: 'mat-1' });
    expect(progress).toEqual([37.5]);
    expect(pending.has(sent.id)).toBe(false);
  });
});
