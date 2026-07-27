import { Logger } from '../logger';
import { APP_VERSION } from '../../version';
import type {
  Command,
  Response,
  FileMetadata,
  SystemInfo,
  EncodeOutput,
  VideoInfo,
  DirEntry,
  MatAnyoneStatusResponse,
  MatAnyoneMatteResult,
} from './protocol';

import type {
  ConnectionStatus,
  DecodedFrame,
  FrameCallback,
  NativeFolderPickResult,
  NativeHelperCommandHost,
  NativeHelperConfig,
  ProgressLikeResponse,
  ResponseCallback,
} from './nativeHelperClientTypes';
import * as videoCommands from './nativeHelperVideoCommands';
import * as downloadCommands from './nativeHelperDownloadCommands';
import * as fileCommands from './nativeHelperFileCommands';
import { createMatAnyoneCommands } from './nativeHelperMatAnyoneCommands';
import { createMuscriptorCommands } from './nativeHelperMuscriptorCommands';
import { handleNativeHelperMessage } from './nativeHelperMessageHandler';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

// LZ4 decompression (we'll use a simple implementation or skip for now)
// In production, use a proper LZ4 library like 'lz4js'

const log = Logger.create('NativeHelper');

export type {
  ConnectionStatus,
  DecodedFrame,
  NativeFolderPickResult,
  NativeHelperConfig,
} from './nativeHelperClientTypes';


class NativeHelperClientImpl {
  private ws: WebSocket | null = null;
  private config: Required<NativeHelperConfig>;
  private status: ConnectionStatus = 'disconnected';
  private connectPromise: Promise<boolean> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, ResponseCallback>();
  private progressCallbacks = new Map<string, (percent: number, speed?: string) => void>();
  private frameCallbacks = new Map<string, FrameCallback>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private reconnectTimer: number | null = null;
  private wasEverConnected = false;
  private readonly commandHost: NativeHelperCommandHost = {
    nextId: () => this.nextId(),
    isConnected: () => this.isConnected(),
    send: (cmd, timeoutMs) => this.send(cmd, timeoutMs),
    sendRaw: (data) => this.sendRaw(data),
    registerPendingRequest: (id, callback) => this.pendingRequests.set(id, callback),
    getPendingRequest: (id) => this.pendingRequests.get(id),
    deletePendingRequest: (id) => {
      this.pendingRequests.delete(id);
    },
    registerFrameCallback: (id, callback) => this.frameCallbacks.set(id, callback),
    deleteFrameCallback: (id) => {
      this.frameCallbacks.delete(id);
    },
    setProgressCallback: (id, callback) => this.progressCallbacks.set(id, callback),
    getProgressCallback: (id) => this.progressCallbacks.get(id),
    deleteProgressCallback: (id) => {
      this.progressCallbacks.delete(id);
    },
    getHttpBaseUrl: () => this.getHttpBaseUrl(),
    getInfo: (timeoutMs) => this.getInfo(timeoutMs),
    fetchWithAuth: (url, init) => this.fetchWithAuth(url, init),
    fetchWithTimeout: (url, init, timeoutMs) => this.fetchWithTimeout(url, init, timeoutMs),
    dispatchFrame: (frame) => this.dispatchFrame(frame),
  };
  private readonly matAnyoneCommands = createMatAnyoneCommands(this.commandHost);
  readonly muscriptor = createMuscriptorCommands(this.commandHost);

  constructor() {
    this.config = {
      port: 9876,
      autoReconnect: true,
      reconnectInterval: 2500,
      connectTimeoutMs: 5000,
      token: '',
      onlyReconnectIfWasConnected: true, // Don't spam reconnects if never connected
    };
  }


  configure(config: NativeHelperConfig): void {
    this.config = { ...this.config, ...config };
  }


  getStatus(): ConnectionStatus {
    return this.status;
  }


  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }


  async connect(): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus('connecting');

    const connectPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      let connectTimeout: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        resolve(result);
      };

      try {
        const ws = new WebSocket(`ws://127.0.0.1:${this.config.port}`);
        this.ws = ws;
        ws.binaryType = 'arraybuffer'; // Ensure binary data comes as ArrayBuffer, not Blob

        connectTimeout = setTimeout(() => {
          if (settled) {
            return;
          }
          if (this.ws === ws) {
            this.ws = null;
          }
          try {
            ws.close();
          } catch {
            // Ignore close errors while unwinding a timed-out connection attempt.
          }
          this.setStatus('disconnected');
          log.warn(`Native helper connection timed out after ${this.config.connectTimeoutMs}ms`);
          finish(false);
        }, this.config.connectTimeoutMs);

        ws.onopen = async () => {
          log.info('Connected to native helper');
          this.wasEverConnected = true;

          // Refresh the token on every new socket. Helper restarts generate a
          // new startup token, so a cached token from the previous process is stale.
          try {
            const httpPort = this.config.port + 1;
            const resp = await this.fetchWithTimeout(
              `http://127.0.0.1:${httpPort}/startup-token`,
              undefined,
              Math.min(this.config.connectTimeoutMs, 1500),
            );
            if (resp.ok) {
              const data = await resp.json();
              if (typeof data.token === 'string' && data.token.length > 0) {
                this.config.token = data.token;
                log.info('Auth token discovered from startup endpoint');
              }
            }
          } catch {
            log.debug('Could not discover auth token from startup endpoint');
          }

          // Authenticate with token
          if (this.config.token) {
            let authenticated = false;
            try {
              const authResp = await this.send({ cmd: 'auth', id: this.nextId(), token: this.config.token });
              authenticated = okField<boolean>(authResp, 'authenticated') === true;
            } catch {
              log.warn('Auth failed');
            }

            if (!authenticated) {
              log.warn('Auth response did not confirm authentication');
              if (this.ws === ws) {
                this.ws = null;
              }
              try {
                ws.close();
              } catch {
                // Ignore close errors while unwinding a failed auth attempt.
              }
              this.setStatus('disconnected');
              finish(false);
              return;
            }
          }

          try {
            const registerResponse = await this.send({
              cmd: 'register_client',
              id: this.nextId(),
              role: 'editor',
              capabilities: ['ai_tools'],
              session_name: 'masterselects-editor',
              app_version: APP_VERSION,
            });
            if (registerResponse.ok !== true) {
              throw new Error(getErrorMessage(registerResponse, 'Registration failed'));
            }
          } catch (error) {
            log.warn('Editor registration with native helper failed', error);
            if (this.ws === ws) {
              this.ws = null;
            }
            try {
              ws.close();
            } catch {
              // Ignore close errors while unwinding a failed registration attempt.
            }
            this.setStatus('disconnected');
            finish(false);
            return;
          }

          this.setStatus('connected');
          finish(true);
        };

        ws.onclose = () => {
          if (this.wasEverConnected) {
            log.info('Disconnected');
          }
          if (this.ws === ws) {
            this.ws = null;
          }
          this.setStatus('disconnected');
          this.handleDisconnect();
          finish(false);
        };

        ws.onerror = () => {
          // Don't log errors when helper isn't running - it's optional
          if (this.ws === ws) {
            this.ws = null;
          }
          this.setStatus('disconnected');
          finish(false);
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch {
        // Silent fail - helper is optional
        this.setStatus('disconnected');
        finish(false);
      }
    }).finally(() => {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    });

    this.connectPromise = connectPromise;
    return connectPromise;
  }


  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
  }


  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }


  async openFile(path: string): Promise<FileMetadata> {
    return videoCommands.openFile(this.commandHost, path);
  }


  async decodeFrame(
    fileId: string,
    frame: number,
    options?: {
      format?: 'rgba8' | 'rgb8' | 'yuv420';
      scale?: number;
      compression?: 'lz4';
    }
  ): Promise<DecodedFrame> {
    return videoCommands.decodeFrame(this.commandHost, fileId, frame, options);
  }


  prefetch(fileId: string, aroundFrame: number, radius = 50): void {
    videoCommands.prefetch(this.commandHost, fileId, aroundFrame, radius);
  }


  async startEncode(output: EncodeOutput, frameCount: number): Promise<string> {
    return videoCommands.startEncode(this.commandHost, output, frameCount);
  }


  async encodeFrame(encodeId: string, frameNum: number, frameData: Uint8Array): Promise<void> {
    return videoCommands.encodeFrame(this.commandHost, encodeId, frameNum, frameData);
  }


  async finishEncode(encodeId: string): Promise<string> {
    return videoCommands.finishEncode(this.commandHost, encodeId);
  }


  async cancelEncode(encodeId: string): Promise<void> {
    return videoCommands.cancelEncode(this.commandHost, encodeId);
  }


  async closeFile(fileId: string): Promise<void> {
    return videoCommands.closeFile(this.commandHost, fileId);
  }


  async getInfo(timeoutMs = 30000): Promise<SystemInfo> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'info', id }, timeoutMs);

    if (!response.ok) {
      throw new Error(getErrorMessage(response, 'Failed to get info'));
    }

    return response as unknown as SystemInfo;
  }


  async ping(timeoutMs = 3000): Promise<boolean> {
    try {
      const id = this.nextId();
      const response = await this.send({ cmd: 'ping', id }, timeoutMs);
      return response.ok === true;
    } catch {
      return false;
    }
  }


  async listFormats(url: string): Promise<VideoInfo | null> {
    return downloadCommands.listFormats(this.commandHost, url);
  }


  async downloadYouTube(
    url: string,
    formatId?: string,
    onProgress?: (percent: number, speed?: string) => void
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    return downloadCommands.downloadYouTube(this.commandHost, url, formatId, onProgress);
  }


  async download(
    url: string,
    formatId?: string,
    onProgress?: (percent: number, speed?: string) => void
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    return downloadCommands.download(this.commandHost, url, formatId, onProgress);
  }


  async locateFile(filename: string, searchDirs?: string[]): Promise<string | null> {
    return downloadCommands.locateFile(this.commandHost, filename, searchDirs);
  }

  // ── File System Commands (for project persistence in Firefox) ──


  getHttpBaseUrl(): string {
    return `http://127.0.0.1:${this.config.port + 1}`;
  }


  async getProjectRoot(timeoutMs = 1500): Promise<string | null> {
    return fileCommands.getProjectRoot(this.commandHost, timeoutMs);
  }


  async hasFsCommands(timeoutMs = 1500): Promise<boolean> {
    return fileCommands.hasFsCommands(this.commandHost, timeoutMs);
  }


  async writeFile(path: string, content: string): Promise<boolean> {
    return fileCommands.writeFile(this.commandHost, path, content, log);
  }


  async writeFileBinary(path: string, data: Blob | ArrayBuffer | Uint8Array): Promise<boolean> {
    return fileCommands.writeFileBinary(this.commandHost, path, data, log);
  }


  async readFileText(path: string): Promise<string | null> {
    return fileCommands.readFileText(this.commandHost, path, log);
  }


  async createDir(path: string, recursive = true): Promise<boolean> {
    return fileCommands.createDir(this.commandHost, path, recursive, log);
  }


  async listDir(path: string): Promise<DirEntry[]> {
    return fileCommands.listDir(this.commandHost, path, log);
  }


  async deleteFile(path: string, recursive = false): Promise<boolean> {
    return fileCommands.deleteFile(this.commandHost, path, recursive, log);
  }


  async exists(path: string): Promise<{ exists: boolean; kind: 'file' | 'directory' | 'none' }> {
    return fileCommands.exists(this.commandHost, path, log);
  }


  async rename(oldPath: string, newPath: string): Promise<boolean> {
    return fileCommands.rename(this.commandHost, oldPath, newPath, log);
  }


  async pickFolderDetailed(title?: string, defaultPath?: string): Promise<NativeFolderPickResult> {
    return fileCommands.pickFolderDetailed(this.commandHost, title, defaultPath, log);
  }


  async grantPath(path: string): Promise<boolean> {
    return fileCommands.grantPath(this.commandHost, path, log);
  }


  async pickFolder(title?: string, defaultPath?: string): Promise<string | null> {
    return (await this.pickFolderDetailed(title, defaultPath)).path;
  }


  getFileUrl(absolutePath: string): string {
    return fileCommands.getFileUrl(this.commandHost, absolutePath);
  }


  getFileReferenceUrl(absolutePath: string): string {
    return fileCommands.getFileReferenceUrl(absolutePath);
  }

  parseFileReferenceUrl(url: string | undefined): string | null {
    return fileCommands.parseFileReferenceUrl(url);
  }

  async getReferencedFile(url: string, fileName: string): Promise<File | null> {
    return fileCommands.getReferencedFile(this.commandHost, url, fileName, log);
  }


  async getDownloadedFile(path: string): Promise<ArrayBuffer | null> {
    return fileCommands.getDownloadedFile(this.commandHost, path, log);
  }

  // ── MatAnyone2 Methods ──


  async matanyoneStatus(): Promise<MatAnyoneStatusResponse> {
    return this.matAnyoneCommands.status();
  }


  async matanyoneSetup(
    onProgress?: (step: string, percent: number, message: string) => void,
    pythonPath?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.matAnyoneCommands.setup(onProgress, pythonPath);
  }


  async matanyoneDownloadModel(
    onProgress?: (percent: number, speed?: string, eta?: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    return this.matAnyoneCommands.downloadModel(onProgress);
  }


  async matanyoneStart(): Promise<{ success: boolean; port?: number; error?: string }> {
    return this.matAnyoneCommands.start();
  }


  async matanyoneStop(): Promise<{ success: boolean; error?: string }> {
    return this.matAnyoneCommands.stop();
  }


  async matanyoneMatte(
    videoPath: string,
    maskPath: string,
    outputDir: string,
    options?: { startFrame?: number; endFrame?: number },
    onProgress?: (currentFrame: number, totalFrames: number, percent: number, jobId?: string) => void,
  ): Promise<MatAnyoneMatteResult> {
    return this.matAnyoneCommands.matte(videoPath, maskPath, outputDir, options, onProgress);
  }


  async matanyoneCancel(jobId: string): Promise<void> {
    return this.matAnyoneCommands.cancel(jobId);
  }


  async matanyoneUninstall(): Promise<{ success: boolean; error?: string }> {
    return this.matAnyoneCommands.uninstall();
  }

  // Private methods


  private fetchWithAuth(url: string, init?: RequestInit): Promise<globalThis.Response> {
    const headers = new Headers(init?.headers);
    if (this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }
    return fetch(url, { ...init, headers });
  }

  private fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs = 3000,
  ): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (init?.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return fetch(url, { ...init, signal: controller.signal })
      .finally(() => clearTimeout(timeout));
  }

  private nextId(): string {
    return `req_${++this.requestId}`;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((listener) => listener(status));
    }
  }

  private handleDisconnect(): void {
    // Reject all pending requests (including decode error handlers)
    this.pendingRequests.forEach((callback) => {
      callback({ id: '', ok: false, error: { code: 'DISCONNECTED', message: 'Connection lost' } });
    });
    this.pendingRequests.clear();
    // Frame callbacks are cleaned up by the pendingRequests error handler above
    // (decodeFrame registers in both maps, cleanup removes from both)
    this.frameCallbacks.clear();

    // Auto-reconnect only if:
    // 1. autoReconnect is enabled
    // 2. Not already trying to connect
    // 3. Either we were connected before OR onlyReconnectIfWasConnected is false
    const shouldReconnect =
      this.config.autoReconnect &&
      this.status !== 'connecting' &&
      (!this.config.onlyReconnectIfWasConnected || this.wasEverConnected);

    if (shouldReconnect && !this.reconnectTimer) {
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        log.debug('Attempting reconnect...');
        this.connect();
      }, this.config.reconnectInterval);
    }
  }

  private async handleMessage(data: string | ArrayBuffer): Promise<void> {
    await handleNativeHelperMessage(this.commandHost, data, log);
  }

  private dispatchFrame(frame: DecodedFrame): void {
    for (const [id, callback] of this.frameCallbacks) {
      callback(frame);
      this.frameCallbacks.delete(id);
      break;
    }
  }

  private async send(cmd: Command, timeoutMs = 30000): Promise<Response> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const id = 'id' in cmd ? cmd.id : '';

      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, timeoutMs);

      // Register callback
      this.pendingRequests.set(id, (response) => {
        if ((response as ProgressLikeResponse).type === 'progress') {
          return;
        }
        clearTimeout(timeout);
        resolve(response);
      });

      // Send command
      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  private async sendRaw(data: string | ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    this.ws.send(data);
  }
}

// Singleton instance
export const NativeHelperClient = new NativeHelperClientImpl();

// Also export the class for testing
export { NativeHelperClientImpl };
