export interface RtmpTarget {
  app: string;
  connectHost: string;
  displayHost: string;
  port: number;
  secure: boolean;
  tcUrl: string;
}

export interface RtmpTransport {
  close(): Promise<void> | void;
  readable: ReadableStream<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
}

export type RtmpTransportFactory = (
  target: RtmpTarget,
  signal: AbortSignal,
) => Promise<RtmpTransport>;

export type MediaKind = 1 | 2 | 3 | 4;

export interface MediaFrame {
  keyframe: boolean;
  kind: MediaKind;
  payload: Uint8Array;
  timestampMs: number;
}

export interface RelayLease {
  acquire(): Promise<boolean>;
  refresh(): Promise<void>;
  release(): Promise<void>;
}
