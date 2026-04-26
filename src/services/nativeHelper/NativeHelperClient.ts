/**
 * Native Helper WebSocket Client
 *
 * Manages the connection to the native helper application and provides
 * methods for video decoding and encoding operations.
 */

import { Logger } from '../logger';
import { APP_VERSION } from '../../version';
import type {
  Command,
  Response,
  OkResponse,
  FileMetadata,
  SystemInfo,
  EncodeOutput,
  VideoInfo,
  DirEntry,
  MatAnyoneStatusResponse,
  MatAnyoneMatteResult,
} from './protocol';

import {
  parseFrameHeader,
  isCompressed,
  isJpeg,
} from './protocol';

// LZ4 decompression (we'll use a simple implementation or skip for now)
// In production, use a proper LZ4 library like 'lz4js'

const log = Logger.create('NativeHelper');

export interface NativeHelperConfig {
  port?: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
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
  /** If true, data contains JPEG bytes — use createImageBitmap(Blob) instead of ImageData */
  isJpeg?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type ResponseCallback = (response: Response) => void;
type FrameCallback = (frame: DecodedFrame) => void;
type JsonObject = Record<string, unknown>;
type NativeHelperJsonMessage = JsonObject & {
  id?: string;
  type?: string;
  request_id?: string;
  tool?: string;
  args?: Record<string, unknown>;
};
type ProgressLikeResponse = Response & {
  type?: string;
  percent?: number;
  speed?: string;
  eta?: string;
  step?: string;
  message?: string;
  current_frame?: number;
  total_frames?: number;
};

function getErrorMessage(response: Response, fallback: string): string {
  return response.ok === false ? response.error.message : fallback;
}

function okField<T>(response: Response, key: string): T | undefined {
  return response.ok === true ? (response as OkResponse)[key] as T | undefined : undefined;
}

/**
 * Singleton client for communicating with the Native Helper
 */
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

  constructor() {
    this.config = {
      port: 9876,
      autoReconnect: true,
      reconnectInterval: 10000, // 10 seconds between reconnect attempts
      token: '',
      onlyReconnectIfWasConnected: true, // Don't spam reconnects if never connected
    };
  }

  /**
   * Configure the client
   */
  configure(config: NativeHelperConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Add a status change listener
   */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Connect to the native helper
   */
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
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      try {
        const ws = new WebSocket(`ws://127.0.0.1:${this.config.port}`);
        this.ws = ws;
        ws.binaryType = 'arraybuffer'; // Ensure binary data comes as ArrayBuffer, not Blob

        ws.onopen = async () => {
          log.info('Connected to native helper');
          this.wasEverConnected = true;

          // If no token configured, try to discover it from the startup endpoint
          if (!this.config.token) {
            try {
              const httpPort = this.config.port + 1;
              const resp = await fetch(`http://127.0.0.1:${httpPort}/startup-token`);
              if (resp.ok) {
                const data = await resp.json();
                if (data.token) {
                  this.config.token = data.token;
                  log.info('Auth token discovered from startup endpoint');
                }
              }
            } catch {
              log.debug('Could not discover auth token from startup endpoint');
            }
          }

          // Authenticate with token
          if (this.config.token) {
            try {
              const authResp = await this.send({ cmd: 'auth', id: this.nextId(), token: this.config.token });
              if (okField<boolean>(authResp, 'authenticated') !== true) {
                log.warn('Auth response did not confirm authentication');
              }
            } catch {
              log.warn('Auth failed');
            }
          }

          try {
            await this.send({
              cmd: 'register_client',
              id: this.nextId(),
              role: 'editor',
              capabilities: ['ai_tools'],
              session_name: 'masterselects-editor',
              app_version: APP_VERSION,
            });
          } catch (error) {
            log.warn('Editor registration with native helper failed', error);
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

  /**
   * Disconnect from the native helper
   */
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

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Open a video file
   */
  async openFile(path: string): Promise<FileMetadata> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'open', id, path });

    if (!response.ok) {
      throw new Error(getErrorMessage(response, 'Failed to open file'));
    }

    return response as unknown as FileMetadata;
  }

  /**
   * Decode a single frame
   */
  async decodeFrame(
    fileId: string,
    frame: number,
    options?: {
      format?: 'rgba8' | 'rgb8' | 'yuv420';
      scale?: number;
      compression?: 'lz4';
    }
  ): Promise<DecodedFrame> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.frameCallbacks.delete(id);
        this.pendingRequests.delete(id);
      };

      // Set timeout
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Decode timeout'));
      }, 10000);

      // Register frame callback (for binary success response)
      this.frameCallbacks.set(id, (frame) => {
        cleanup();
        resolve(frame);
      });

      // Also register in pendingRequests (for JSON error responses)
      this.pendingRequests.set(id, (response) => {
        cleanup();
        const err = response.ok === false ? response.error : null;
        reject(new Error(err?.message || 'Decode failed'));
      });

      // Send decode command
      const cmd: Command = {
        cmd: 'decode',
        id,
        file_id: fileId,
        frame,
        format: options?.format,
        scale: options?.scale,
        compression: options?.compression,
      };

      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Prefetch frames around a position (fire and forget)
   */
  prefetch(fileId: string, aroundFrame: number, radius = 50): void {
    if (!this.isConnected()) return;

    const cmd: Command = {
      cmd: 'prefetch',
      file_id: fileId,
      around_frame: aroundFrame,
      radius,
    };

    this.sendRaw(JSON.stringify(cmd)).catch(() => {
      // Ignore prefetch errors
    });
  }

  /**
   * Start an encode job
   */
  async startEncode(output: EncodeOutput, frameCount: number): Promise<string> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'start_encode', id, output, frame_count: frameCount });

    if (!response.ok) {
      throw new Error(getErrorMessage(response, 'Failed to start encode'));
    }

    return id;
  }

  /**
   * Send a frame for encoding
   */
  async encodeFrame(encodeId: string, frameNum: number, frameData: Uint8Array): Promise<void> {
    // Send text command first
    const cmd: Command = {
      cmd: 'encode_frame',
      id: encodeId,
      frame_num: frameNum,
    };

    await this.sendRaw(JSON.stringify(cmd));

    // Then send binary frame data
    await this.sendRaw(frameData);
  }

  /**
   * Finish encoding
   */
  async finishEncode(encodeId: string): Promise<string> {
    const response = await this.send({ cmd: 'finish_encode', id: encodeId });

    if (!response.ok) {
      throw new Error(getErrorMessage(response, 'Failed to finish encode'));
    }

    return okField<string>(response, 'output_path') ?? '';
  }

  /**
   * Cancel encoding
   */
  async cancelEncode(encodeId: string): Promise<void> {
    await this.send({ cmd: 'cancel_encode', id: encodeId });
  }

  /**
   * Close a file
   */
  async closeFile(fileId: string): Promise<void> {
    const id = this.nextId();
    await this.send({ cmd: 'close', id, file_id: fileId });
  }

  /**
   * Get system info
   */
  async getInfo(): Promise<SystemInfo> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'info', id });

    if (!response.ok) {
      throw new Error(getErrorMessage(response, 'Failed to get info'));
    }

    return response as unknown as SystemInfo;
  }

  /**
   * Ping the server
   */
  async ping(): Promise<boolean> {
    try {
      const id = this.nextId();
      const response = await this.send({ cmd: 'ping', id });
      return response.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * List available formats for a video URL (YouTube, TikTok, Instagram, etc.)
   */
  async listFormats(url: string): Promise<VideoInfo | null> {
    const id = this.nextId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(null);
      }, 30000);

      this.pendingRequests.set(id, (response) => {
        clearTimeout(timeout);
        if (response.ok) {
          resolve({
            title: okField<string>(response, 'title') ?? '',
            thumbnail: okField<string>(response, 'thumbnail') ?? '',
            duration: okField<number>(response, 'duration') ?? 0,
            uploader: okField<string>(response, 'uploader') ?? '',
            platform: okField<string>(response, 'platform'),
            recommendations: okField<VideoInfo['recommendations']>(response, 'recommendations') ?? [],
            allFormats: okField<VideoInfo['allFormats']>(response, 'allFormats') ?? [],
          });
        } else {
          resolve(null);
        }
      });

      const cmd = {
        cmd: 'list_formats',
        id,
        url,
      };

      this.sendRaw(JSON.stringify(cmd)).catch(() => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        resolve(null);
      });
    });
  }

  /**
   * Download a YouTube video using yt-dlp
   */
  async downloadYouTube(
    url: string,
    formatId?: string,
    onProgress?: (percent: number, speed?: string) => void
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      // Set timeout (10 minutes for large videos)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.progressCallbacks.delete(id);
        reject(new Error('Download timeout'));
      }, 600000);

      // Register progress callback if provided
      if (onProgress) {
        this.progressCallbacks.set(id, onProgress);
      }

      // Register completion callback
      this.pendingRequests.set(id, (response: ProgressLikeResponse) => {
        // Check if this is a progress message
        if (response.type === 'progress' && response.percent !== undefined) {
          // Don't resolve yet - this is just progress
          const progressCb = this.progressCallbacks.get(id);
          if (progressCb) {
            progressCb(response.percent, response.speed);
          }
          return; // Keep waiting for final response
        }

        // Final response
        clearTimeout(timeout);
        this.progressCallbacks.delete(id);
        if (response.ok) {
          resolve({
            success: true,
            path: okField<string>(response, 'path'),
          });
        } else {
          resolve({
            success: false,
            error: getErrorMessage(response, 'Download failed'),
          });
        }
      });

      // Send download command
      const cmd: Command = {
        cmd: 'download_youtube',
        id,
        url,
      };

      if (formatId) {
        cmd.format_id = formatId;
      }

      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        this.progressCallbacks.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Download a video from any yt-dlp-supported platform
   */
  async download(
    url: string,
    formatId?: string,
    onProgress?: (percent: number, speed?: string) => void
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.progressCallbacks.delete(id);
        reject(new Error('Download timeout'));
      }, 600000);

      if (onProgress) {
        this.progressCallbacks.set(id, onProgress);
      }

      this.pendingRequests.set(id, (response: ProgressLikeResponse) => {
        if (response.type === 'progress' && response.percent !== undefined) {
          const progressCb = this.progressCallbacks.get(id);
          if (progressCb) {
            progressCb(response.percent, response.speed);
          }
          return;
        }

        clearTimeout(timeout);
        this.progressCallbacks.delete(id);
        if (response.ok) {
          resolve({
            success: true,
            path: okField<string>(response, 'path'),
          });
        } else {
          resolve({
            success: false,
            error: getErrorMessage(response, 'Download failed'),
          });
        }
      });

      const cmd: Command = {
        cmd: 'download',
        id,
        url,
      };

      if (formatId) {
        cmd.format_id = formatId;
      }

      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        this.progressCallbacks.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Locate a file by name in common directories (Desktop, Downloads, Videos, Documents, Home)
   * Returns the absolute path if found, or null if not found.
   */
  async locateFile(filename: string, searchDirs?: string[]): Promise<string | null> {
    const id = this.nextId();
    const cmd: Command = { cmd: 'locate', id, filename };
    if (searchDirs?.length) {
      cmd.search_dirs = searchDirs;
    }
    const response = await this.send(cmd);
    if (!response.ok) return null;
    const found = okField<boolean>(response, 'found');
    const path = okField<string>(response, 'path');
    if (found && path) {
      return path;
    }
    return null;
  }

  // ── File System Commands (for project persistence in Firefox) ──

  /**
   * Get the HTTP base URL for the native helper file server
   */
  getHttpBaseUrl(): string {
    return `http://127.0.0.1:${this.config.port + 1}`;
  }

  /**
   * Get the default project root path from the native helper
   */
  async getProjectRoot(): Promise<string | null> {
    try {
      const response = await this.fetchWithAuth(`${this.getHttpBaseUrl()}/project-root`);
      if (response.ok) {
        const data = await response.json();
        return data.path || null;
      }
    } catch {
      // Fallback to info command
      try {
        const info = await this.getInfo();
        return info.project_root || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Check if the native helper supports file system commands
   */
  async hasFsCommands(): Promise<boolean> {
    try {
      const info = await this.getInfo();
      return info.fs_commands === true;
    } catch {
      return false;
    }
  }

  /**
   * Write a text file via WebSocket
   */
  async writeFile(path: string, content: string): Promise<boolean> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'write_file', id, path, data: content, encoding: 'utf8' });
      return response.ok === true;
    } catch (e) {
      log.error('writeFile failed', e);
      return false;
    }
  }

  /**
   * Write binary data via HTTP POST /upload (efficient, no base64 overhead)
   * Falls back to WebSocket base64 if HTTP fails.
   */
  async writeFileBinary(path: string, data: Blob | ArrayBuffer | Uint8Array): Promise<boolean> {
    // Try HTTP upload first (no base64 overhead)
    try {
      const url = `${this.getHttpBaseUrl()}/upload?path=${encodeURIComponent(path)}`;
      const body = data instanceof Blob ? data : data instanceof ArrayBuffer ? new Blob([data]) : new Blob([data.buffer as ArrayBuffer]);
      const response = await this.fetchWithAuth(url, { method: 'POST', body });
      if (response.ok) {
        return true;
      }
    } catch {
      log.debug('HTTP upload failed, falling back to WebSocket');
    }

    // Fallback: base64 via WebSocket
    try {
      let bytes: Uint8Array;
      if (data instanceof Blob) {
        bytes = new Uint8Array(await data.arrayBuffer());
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        bytes = data;
      }

      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const id = this.nextId();
      const response = await this.send({ cmd: 'write_file', id, path, data: base64, encoding: 'base64' });
      return response.ok === true;
    } catch (e) {
      log.error('writeFileBinary failed', e);
      return false;
    }
  }

  /**
   * Read a text file and return its contents as string
   */
  async readFileText(path: string): Promise<string | null> {
    const buffer = await this.getDownloadedFile(path);
    if (!buffer) return null;
    return new TextDecoder().decode(buffer);
  }

  /**
   * Create a directory (recursive by default)
   */
  async createDir(path: string, recursive = true): Promise<boolean> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'create_dir', id, path, recursive });
      return response.ok === true;
    } catch (e) {
      log.error('createDir failed', e);
      return false;
    }
  }

  /**
   * List directory contents
   */
  async listDir(path: string): Promise<DirEntry[]> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'list_dir', id, path });
      if (response.ok) {
        return okField<DirEntry[]>(response, 'entries') ?? [];
      }
    } catch (e) {
      log.error('listDir failed', e);
    }
    return [];
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(path: string, recursive = false): Promise<boolean> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'delete', id, path, recursive });
      return response.ok === true;
    } catch (e) {
      log.error('deleteFile failed', e);
      return false;
    }
  }

  /**
   * Check if a path exists and what type it is
   */
  async exists(path: string): Promise<{ exists: boolean; kind: 'file' | 'directory' | 'none' }> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'exists', id, path });
      if (response.ok) {
        return {
          exists: okField<boolean>(response, 'exists') ?? false,
          kind: okField<'file' | 'directory' | 'none'>(response, 'kind') ?? 'none',
        };
      }
    } catch (e) {
      log.error('exists failed', e);
    }
    return { exists: false, kind: 'none' };
  }

  /**
   * Rename or move a file/directory
   */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const id = this.nextId();
    try {
      const response = await this.send({ cmd: 'rename', id, old_path: oldPath, new_path: newPath });
      return response.ok === true;
    } catch (e) {
      log.error('rename failed', e);
      return false;
    }
  }

  /**
   * Open a native OS folder picker dialog via the Native Helper.
   * Returns the selected folder path, or null if the user cancelled.
   */
  async pickFolder(title?: string, defaultPath?: string): Promise<string | null> {
    const id = this.nextId();
    try {
      const cmd = { cmd: 'pick_folder', id, title, default_path: defaultPath } satisfies JsonObject;
      if (title) cmd.title = title;
      if (defaultPath) cmd.default_path = defaultPath;
      const response = await this.send(cmd as unknown as Command);
      const path = okField<string>(response, 'path');
      if (response.ok && path) {
        return path;
      }
      return null; // cancelled
    } catch (e) {
      log.error('pickFolder failed', e);
      return null;
    }
  }

  /**
   * Build a URL that serves a file via the native helper HTTP server.
   * Use this for media src attributes (video, audio, img) in Firefox.
   */
  getFileUrl(absolutePath: string): string {
    return `${this.getHttpBaseUrl()}/file?path=${encodeURIComponent(absolutePath)}`;
  }

  /**
   * Get a downloaded file from the Native Helper via HTTP (fast) or WebSocket fallback
   */
  async getDownloadedFile(path: string): Promise<ArrayBuffer | null> {
    // Try HTTP first (much faster than WebSocket base64)
    const httpPort = this.config.port + 1; // HTTP on port+1 (9877)
    try {
      log.debug('Fetching file via HTTP:', path);
      const response = await this.fetchWithAuth(`http://127.0.0.1:${httpPort}/file?path=${encodeURIComponent(path)}`);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        log.debug('File received via HTTP:', buffer.byteLength + ' bytes');
        return buffer;
      }
    } catch (e) {
      log.warn('HTTP fetch failed, falling back to WebSocket', e);
    }

    // Fallback to WebSocket (slower but more compatible)
    const id = this.nextId();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(null);
      }, 120000); // 120 seconds for large files via WebSocket

      // For file requests, we expect base64 data in the response
      this.pendingRequests.set(id, async (response) => {
        clearTimeout(timeout);
        const data = okField<string>(response, 'data');
        if (response.ok && data) {
          // Decode base64 to ArrayBuffer using fetch (much faster than manual loop)
          try {
            const dataUrl = `data:application/octet-stream;base64,${data}`;
            const fetchResponse = await fetch(dataUrl);
            const buffer = await fetchResponse.arrayBuffer();
            resolve(buffer);
          } catch (e) {
            log.error('Failed to decode base64 data', e);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      const cmd = {
        cmd: 'get_file',
        id,
        path,
      };

      this.sendRaw(JSON.stringify(cmd)).catch(() => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        resolve(null);
      });
    });
  }

  // ── MatAnyone2 Methods ──

  /**
   * Check MatAnyone2 environment status
   */
  async matanyoneStatus(): Promise<MatAnyoneStatusResponse> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 15000);

      this.pendingRequests.set(id, (response) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        if (!response.ok) {
          reject(new Error(getErrorMessage(response, 'Failed to get MatAnyone2 status')));
        } else {
          resolve(response as unknown as MatAnyoneStatusResponse);
        }
      });

      this.sendRaw(JSON.stringify({ cmd: 'mat_anyone_status', id })).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Run full MatAnyone2 setup with progress
   */
  async matanyoneSetup(
    onProgress?: (step: string, percent: number, message: string) => void,
    pythonPath?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('MatAnyone2 setup timeout'));
      }, 600000); // 10 minutes

      this.pendingRequests.set(id, (response: ProgressLikeResponse) => {
        if (response.type === 'progress') {
          if (onProgress) {
            onProgress(response.step ?? '', response.percent ?? 0, response.message ?? '');
          }
          return;
        }

        clearTimeout(timeout);
        if (response.ok) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: getErrorMessage(response, 'Setup failed'),
          });
        }
      });

      const cmd: Command = { cmd: 'mat_anyone_setup', id };
      if (pythonPath) {
        cmd.python_path = pythonPath;
      }

      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Download MatAnyone2 model weights with progress
   */
  async matanyoneDownloadModel(
    onProgress?: (percent: number, speed?: string, eta?: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Model download timeout'));
      }, 600000); // 10 minutes

      this.pendingRequests.set(id, (response: ProgressLikeResponse) => {
        if (response.type === 'progress') {
          if (onProgress) {
            onProgress(response.percent ?? 0, response.speed, response.eta);
          }
          return;
        }

        clearTimeout(timeout);
        if (response.ok) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: getErrorMessage(response, 'Model download failed'),
          });
        }
      });

      this.sendRaw(JSON.stringify({ cmd: 'mat_anyone_download_model', id })).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Start MatAnyone2 inference server
   */
  async matanyoneStart(): Promise<{ success: boolean; port?: number }> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'mat_anyone_start', id });

    if (!response.ok) {
      return { success: false };
    }

    return { success: true, port: okField<number>(response, 'port') };
  }

  /**
   * Stop MatAnyone2 inference server
   */
  async matanyoneStop(): Promise<{ success: boolean }> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'mat_anyone_stop', id });
    return { success: response.ok === true };
  }

  /**
   * Run MatAnyone2 matting job with progress
   */
  async matanyoneMatte(
    videoPath: string,
    maskPath: string,
    outputDir: string,
    options?: { startFrame?: number; endFrame?: number },
    onProgress?: (currentFrame: number, totalFrames: number, percent: number) => void,
  ): Promise<MatAnyoneMatteResult> {
    const id = this.nextId();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Matting timeout'));
      }, 600000); // 10 minutes

      this.pendingRequests.set(id, (response: ProgressLikeResponse) => {
        if (response.type === 'progress') {
          if (onProgress) {
            onProgress(response.current_frame ?? 0, response.total_frames ?? 0, response.percent ?? 0);
          }
          return;
        }

        clearTimeout(timeout);
        if (response.ok) {
          resolve({
            foreground_path: okField<string>(response, 'foreground_path') ?? '',
            alpha_path: okField<string>(response, 'alpha_path') ?? '',
            job_id: okField<string>(response, 'job_id') ?? '',
          });
        } else {
          reject(new Error(getErrorMessage(response, 'Matting failed')));
        }
      });

      const cmd: Command = {
        cmd: 'mat_anyone_matte',
        id,
        video_path: videoPath,
        mask_path: maskPath,
        output_dir: outputDir,
      };

      if (options?.startFrame !== undefined) {
        cmd.start_frame = options.startFrame;
      }
      if (options?.endFrame !== undefined) {
        cmd.end_frame = options.endFrame;
      }

      this.sendRaw(JSON.stringify(cmd)).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Cancel a running MatAnyone2 matting job
   */
  async matanyoneCancel(jobId: string): Promise<void> {
    const id = this.nextId();
    await this.send({ cmd: 'mat_anyone_cancel', id, job_id: jobId });
  }

  /**
   * Uninstall MatAnyone2 (remove venv, models, etc.)
   */
  async matanyoneUninstall(): Promise<{ success: boolean }> {
    const id = this.nextId();
    const response = await this.send({ cmd: 'mat_anyone_uninstall', id });
    return { success: response.ok === true };
  }

  // Private methods

  /**
   * Fetch with Authorization header injected
   */
  private fetchWithAuth(url: string, init?: RequestInit): Promise<globalThis.Response> {
    const headers = new Headers(init?.headers);
    if (this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }
    return fetch(url, { ...init, headers });
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

    if (shouldReconnect) {
      this.reconnectTimer = window.setTimeout(() => {
        log.debug('Attempting reconnect...');
        this.connect();
      }, this.config.reconnectInterval);
    }
  }

  private async handleMessage(data: string | ArrayBuffer): Promise<void> {
    if (typeof data === 'string') {
      // JSON response
      try {
        const message = JSON.parse(data) as NativeHelperJsonMessage;
        if (message.type === 'ai_tool_request') {
          await this.handleAiToolRequest({
            request_id: message.request_id,
            tool: message.tool,
            args: message.args,
          });
          return;
        }

        if (!message.id) {
          return;
        }

        const response = message as Response;
        const isProgress = message.type === 'progress';
        const callback = this.pendingRequests.get(message.id);

        if (callback) {
          // Check if this is a progress message - don't delete callback yet
          if (!isProgress) {
            this.pendingRequests.delete(message.id);
          }
          callback(response);
        }
      } catch (err) {
        log.error('Failed to parse response', err);
      }
    } else {
      // Binary frame data
      const header = parseFrameHeader(data);

      if (!header) {
        log.error('Invalid frame header');
        return;
      }

      // Extract payload
      const payloadStart = 16;
      const payload = new Uint8Array(data, payloadStart);

      const jpegFrame = isJpeg(header.flags);

      // Decompress if needed (LZ4 — not used when JPEG is active)
      if (!jpegFrame && isCompressed(header.flags)) {
        log.warn('LZ4 decompression not implemented, using raw data');
      }

      const frame: DecodedFrame = {
        width: header.width,
        height: header.height,
        frameNum: header.frameNum,
        data: new Uint8ClampedArray(payload),
        requestId: header.requestId,
        isJpeg: jpegFrame,
      };

      // Find callback by request ID pattern
      // The request ID in the header maps to our string IDs
      for (const [id, callback] of this.frameCallbacks) {
        // Match by checking if any pending decode could be this frame
        callback(frame);
        this.frameCallbacks.delete(id);
        break;
      }
    }
  }

  private async handleAiToolRequest(payload: {
    request_id?: string;
    tool?: string;
    args?: Record<string, unknown>;
  }): Promise<void> {
    const requestId = payload.request_id;
    const tool = payload.tool;

    if (!requestId || !tool) {
      log.warn('Ignoring malformed ai_tool_request from native helper');
      return;
    }

    const commandId = this.nextId();

    try {
      const { executeAITool, AI_TOOLS, getQuickTimelineSummary } = await import('../aiTools');
      let result: unknown;

      if (tool === '_list') {
        result = { success: true, data: AI_TOOLS };
      } else if (tool === '_status') {
        result = { success: true, data: getQuickTimelineSummary() };
      } else {
        result = await executeAITool(tool, payload.args ?? {}, 'nativeHelper');
      }

      await this.send({
        cmd: 'ai_tool_result',
        id: commandId,
        request_id: requestId,
        result,
      });
    } catch (error) {
      try {
        await this.send({
          cmd: 'ai_tool_result',
          id: commandId,
          request_id: requestId,
          result: {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } catch (sendError) {
        log.error('Failed to send ai_tool_result error response', sendError);
      }
    }
  }

  private async send(cmd: Command): Promise<Response> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const id = 'id' in cmd ? cmd.id : '';

      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

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
