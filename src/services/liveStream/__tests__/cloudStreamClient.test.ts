import { describe, expect, it, vi } from 'vitest';
import { openCloudStreamConnection } from '../cloudStreamClient';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  fail(): void {
    this.onerror?.({} as Event);
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

function openConnection() {
  FakeWebSocket.instances = [];
  const promise = openCloudStreamConnection({
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    baseUrl: 'https://studio.example.test/project',
    connectTimeoutMs: 1_000,
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  return { promise, socket };
}

describe('openCloudStreamConnection', () => {
  it('uses the same-origin relay URL and resolves only on relay-hello', async () => {
    const { promise, socket } = openConnection();
    let resolved = false;
    void promise.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(socket.url).toBe('wss://studio.example.test/api/stream/rtmp');
    expect(socket.binaryType).toBe('arraybuffer');

    socket.message({ ok: true, type: 'relay-hello' });
    await expect(promise).resolves.toBeDefined();
  });

  it('rejects with the sign-in guidance when the socket closes before relay-hello', async () => {
    const { promise, socket } = openConnection();
    const rejection = expect(promise).rejects.toThrow(
      'Not signed in / session expired — sign in to use cloud streaming.',
    );
    socket.serverClose();
    await rejection;
  });

  it('delivers relay events after hello and reports a later socket failure once', async () => {
    const { promise, socket } = openConnection();
    socket.message({ ok: true, type: 'relay-hello' });
    const connection = await promise;
    const listener = vi.fn();
    connection.onEvent(listener);

    socket.message({ type: 'rtmp-stats', sentBytes: 12, queuedBytes: 3, queuedMessages: 1, uptimeMs: 50 });
    socket.fail();
    socket.fail();

    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'rtmp-stats', sentBytes: 12, queuedBytes: 3, queuedMessages: 1, uptimeMs: 50,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: 'rtmp-status', state: 'error', message: 'Cloud relay unreachable.',
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('guards binary sends until the relay connection is open', async () => {
    const { promise, socket } = openConnection();
    socket.message({ ok: true, type: 'relay-hello' });
    const connection = await promise;
    socket.readyState = FakeWebSocket.CONNECTING;

    expect(() => connection.sendBinary(new Uint8Array([1]))).toThrow(
      'Cloud relay stream connection is not open.',
    );
    expect(socket.sent).toEqual([]);
  });
});
