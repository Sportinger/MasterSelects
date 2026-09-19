declare module 'cloudflare:sockets' {
  export interface Socket {
    readonly closed: Promise<void>;
    readonly opened: Promise<unknown>;
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    close(): void;
  }

  export function connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: 'off' | 'on' | 'starttls' },
  ): Socket;
}

interface WebSocket {
  accept(): void;
}

interface ResponseInit {
  webSocket?: WebSocket;
}

declare class WebSocketPair {
  readonly 0: WebSocket;
  readonly 1: WebSocket;
  constructor();
}
