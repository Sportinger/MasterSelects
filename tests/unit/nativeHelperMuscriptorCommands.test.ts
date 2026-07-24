import { describe, expect, it, vi } from 'vitest';
import { createMuscriptorCommands } from '../../src/services/nativeHelper/nativeHelperMuscriptorCommands';
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
    send: vi.fn(async (command: Command) => ({ id: 'id' in command ? command.id : '', ok: true } as Response)),
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

describe('MuScriptor native-helper commands', () => {
  it('sends a transient gated-model token and preserves progress order', async () => {
    vi.useFakeTimers();
    const { host, pending, rawMessages } = createHost();
    const commands = createMuscriptorCommands(host);
    const progress: number[] = [];
    const promise = commands.downloadModel(
      { variant: 'small', hfToken: '  hf_test_token  ' },
      event => progress.push(event.percent),
    );

    const sent = JSON.parse(rawMessages[0]) as Record<string, unknown>;
    expect(sent).toMatchObject({
      cmd: 'muscriptor_download_model',
      variant: 'small',
      hf_token: 'hf_test_token',
    });
    const callback = pending.get(String(sent.id));
    expect(callback).toBeTypeOf('function');

    vi.advanceTimersByTime(299_000);
    callback?.({ id: String(sent.id), type: 'progress', step: 'download', percent: 12 } as never);
    vi.advanceTimersByTime(299_000);
    callback?.({ id: String(sent.id), type: 'progress', step: 'download', percent: 77 } as never);
    callback?.({ id: String(sent.id), ok: true });

    await expect(promise).resolves.toEqual({ success: true });
    expect(progress).toEqual([12, 77]);
    expect(pending.has(String(sent.id))).toBe(false);
    vi.useRealTimers();
  });

  it('returns terminal transcription notes and includes instrument filters', async () => {
    const { host, pending, rawMessages } = createHost();
    const commands = createMuscriptorCommands(host);
    const noteCounts: number[] = [];
    const promise = commands.transcribe(
      { audioPath: 'C:\\Musik 测试\\clip.wav', instruments: ['violin', 'drums'] },
      event => noteCounts.push(event.note_count ?? 0),
    );

    const sent = JSON.parse(rawMessages[0]) as Record<string, unknown>;
    expect(sent).toMatchObject({
      cmd: 'muscriptor_transcribe',
      audio_path: 'C:\\Musik 测试\\clip.wav',
      instruments: ['violin', 'drums'],
    });
    const callback = pending.get(String(sent.id));
    callback?.({
      id: String(sent.id),
      type: 'progress',
      step: 'transcribing',
      percent: 50,
      job_id: 'job-1',
      note_count: 4,
    } as never);
    callback?.({
      id: String(sent.id),
      ok: true,
      job_id: 'job-1',
      notes: [{ pitch: 60, start_time: 0, end_time: 1, instrument: 'violin' }],
    });

    await expect(promise).resolves.toEqual({
      job_id: 'job-1',
      notes: [{ pitch: 60, start_time: 0, end_time: 1, instrument: 'violin' }],
    });
    expect(noteCounts).toEqual([4]);
  });

  it('uses the grouped facade for status and control commands', async () => {
    const { host } = createHost();
    vi.mocked(host.send)
      .mockResolvedValueOnce({
        id: 'request-1',
        ok: true,
        setup_status: 'installed',
        models_downloaded: ['small'],
      })
      .mockResolvedValueOnce({
        id: 'request-2',
        ok: true,
        server_port: 9890,
        active_device: 'cuda',
      })
      .mockResolvedValueOnce({ id: 'request-3', ok: true });
    const commands = createMuscriptorCommands(host);

    await expect(commands.status()).resolves.toMatchObject({ setup_status: 'installed' });
    await expect(commands.start({ variant: 'small', device: 'cpu' })).resolves.toEqual({
      success: true,
      port: 9890,
      activeDevice: 'cuda',
    });
    await expect(commands.stop()).resolves.toEqual({ success: true });
  });

  it('omits the auto device so the local sidecar can choose CUDA, MPS, or CPU', async () => {
    const { host } = createHost();
    const commands = createMuscriptorCommands(host);

    await commands.start({ variant: 'small', device: 'auto' });

    expect(host.send).toHaveBeenCalledWith({
      cmd: 'muscriptor_start',
      id: 'request-1',
      variant: 'small',
    }, 960_000);
  });

  it('hard-cancels before the provider job id arrives and reports a required restart', async () => {
    const { host, pending, rawMessages } = createHost();
    const commands = createMuscriptorCommands(host);
    const transcription = commands.transcribe({ audioPath: 'C:\\Music\\clip.wav' });
    const sent = JSON.parse(rawMessages[0]) as Record<string, unknown>;
    vi.mocked(host.send).mockResolvedValueOnce({
      id: 'request-2',
      ok: true,
      cancelled: true,
      restart_required: true,
    });

    await expect(commands.cancel('__active__')).resolves.toEqual({ restartRequired: true });
    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.send).toHaveBeenCalledWith({
      cmd: 'muscriptor_cancel',
      id: 'request-2',
      job_id: '__active__',
    }, 120_000);
    expect(pending.has(String(sent.id))).toBe(false);
  });
});
