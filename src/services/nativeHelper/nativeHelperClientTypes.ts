import type { Command, Response, SystemInfo } from './protocol';

export interface NativeHelperConfig {
  port?: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  connectTimeoutMs?: number;
  token?: string;
  /** Only reconnect if we were previously connected */
  onlyReconnectIfWasConnected?: boolean;
}

export interface DecodedFrame {
  width: number;
  height: number;
  frameNum: number;
  data: Uint8ClampedArray;
  requestId: number;
  /** If true, data contains JPEG bytes - use createImageBitmap(Blob) instead of ImageData */
  isJpeg?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface NativeFolderPickResult {
  path: string | null;
  cancelled: boolean;
  error?: string;
}

export type ResponseCallback = (response: Response) => void;
export type FrameCallback = (frame: DecodedFrame) => void;
export type JsonObject = Record<string, unknown>;

export type NativeHelperJsonMessage = JsonObject & {
  id?: string;
  type?: string;
  request_id?: string;
  tool?: string;
  args?: Record<string, unknown>;
};

export type ProgressLikeResponse = Response & {
  type?: string;
  job_id?: string;
  percent?: number;
  speed?: string;
  eta?: string;
  step?: string;
  message?: string;
  current_frame?: number;
  total_frames?: number;
  completed?: number;
  total?: number;
  note_count?: number;
};

export interface NativeHelperCommandHost {
  nextId(): string;
  isConnected(): boolean;
  send(cmd: Command, timeoutMs?: number): Promise<Response>;
  sendRaw(data: string | ArrayBuffer | Uint8Array): Promise<void>;
  registerPendingRequest(id: string, callback: ResponseCallback): void;
  getPendingRequest(id: string): ResponseCallback | undefined;
  deletePendingRequest(id: string): void;
  registerFrameCallback(id: string, callback: FrameCallback): void;
  deleteFrameCallback(id: string): void;
  setProgressCallback(id: string, callback: (percent: number, speed?: string) => void): void;
  getProgressCallback(id: string): ((percent: number, speed?: string) => void) | undefined;
  deleteProgressCallback(id: string): void;
  getHttpBaseUrl(): string;
  getInfo(timeoutMs?: number): Promise<SystemInfo>;
  fetchWithAuth(url: string, init?: RequestInit): Promise<globalThis.Response>;
  fetchWithTimeout(url: string, init?: RequestInit, timeoutMs?: number): Promise<globalThis.Response>;
  dispatchFrame(frame: DecodedFrame): void;
}
