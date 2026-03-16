/**
 * MatAnyone2 Video Matting Service
 *
 * Manages the lifecycle of the MatAnyone2 inference environment:
 * status checks, setup, model downloads, server management, and matting jobs.
 *
 * Communicates with the native helper via WebSocket commands.
 * All state is written to the matanyoneStore for UI reactivity.
 */

import { Logger } from '../logger';
import { NativeHelperClient } from '@/services/nativeHelper/NativeHelperClient';
import { useMatAnyoneStore } from '@/stores/matanyoneStore';

const log = Logger.create('MatAnyone');

export interface MatteOptions {
  videoPath: string;
  maskPath: string;
  outputDir: string;
  sourceClipId: string;
  startFrame?: number;
  endFrame?: number;
}

export interface MatteResult {
  foregroundPath: string;
  alphaPath: string;
}

export class MatAnyoneService {
  /**
   * Check the current MatAnyone2 environment status via native helper.
   * Updates the store with environment info and derived setup status.
   */
  async checkStatus(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setSetupStatus('not-available');
      return;
    }

    try {
      const response = await this.sendCommand('matanyone_status');

      if (!response.ok) {
        store.setSetupStatus('not-installed');
        return;
      }

      // Update environment info from response
      const data = response as any;
      store.setEnvInfo({
        pythonVersion: data.python_version ?? null,
        cudaAvailable: data.cuda_available ?? false,
        cudaVersion: data.cuda_version ?? null,
        gpuName: data.gpu_name ?? null,
        vramMb: data.vram_mb ?? null,
        modelDownloaded: data.model_downloaded ?? false,
      });

      // Derive setup status from environment info
      if (data.server_running) {
        store.setSetupStatus('ready');
      } else if (data.installed && data.model_downloaded) {
        store.setSetupStatus('installed');
      } else if (data.installed && !data.model_downloaded) {
        store.setSetupStatus('model-needed');
      } else {
        store.setSetupStatus('not-installed');
      }

      log.info('Status check complete', {
        status: useMatAnyoneStore.getState().setupStatus,
        cuda: data.cuda_available,
        gpu: data.gpu_name,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Status check failed', e);
      store.setError(msg);
    }
  }

  /**
   * Run the full automated setup: creates venv, installs dependencies.
   * Receives progress updates from the native helper and writes them to the store.
   *
   * @param pythonPath - Optional explicit path to a Python executable
   */
  async setup(pythonPath?: string): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setError('Native helper not connected');
      return;
    }

    store.setSetupStatus('installing');
    store.setSetupProgress(0, 'Initializing setup...');
    store.clearSetupLog();

    try {
      const response = await this.sendCommandWithProgress(
        'matanyone_setup',
        { python_path: pythonPath },
        (progress) => {
          const current = useMatAnyoneStore.getState();
          current.setSetupProgress(
            progress.percent ?? current.setupProgress,
            progress.step,
            progress.message,
          );
        },
      );

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Setup failed';
        useMatAnyoneStore.getState().setError(errMsg);
        return;
      }

      log.info('Setup complete');

      // Re-check status to update env info and derived status
      await this.checkStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Setup failed', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Download the MatAnyone2 model weights.
   * Receives progress updates and writes them to the store.
   */
  async downloadModel(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setError('Native helper not connected');
      return;
    }

    store.setSetupStatus('downloading-model');
    store.setSetupProgress(0, 'Downloading model weights...');

    try {
      const response = await this.sendCommandWithProgress(
        'matanyone_download_model',
        {},
        (progress) => {
          const current = useMatAnyoneStore.getState();
          current.setSetupProgress(
            progress.percent ?? current.setupProgress,
            progress.step,
            progress.message,
          );
        },
      );

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Model download failed';
        useMatAnyoneStore.getState().setError(errMsg);
        return;
      }

      useMatAnyoneStore.getState().setEnvInfo({ modelDownloaded: true });
      log.info('Model download complete');

      // Re-check status
      await this.checkStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Model download failed', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Start the MatAnyone2 inference server via the native helper.
   */
  async startServer(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setError('Native helper not connected');
      return;
    }

    store.setSetupStatus('starting');

    try {
      const response = await this.sendCommand('matanyone_start_server');

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Failed to start server';
        useMatAnyoneStore.getState().setError(errMsg);
        return;
      }

      useMatAnyoneStore.getState().setSetupStatus('ready');
      log.info('MatAnyone server started');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Failed to start server', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Stop the MatAnyone2 inference server.
   */
  async stopServer(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setError('Native helper not connected');
      return;
    }

    try {
      const response = await this.sendCommand('matanyone_stop_server');

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Failed to stop server';
        log.warn('Stop server returned error', errMsg);
      }

      useMatAnyoneStore.getState().setSetupStatus('installed');
      log.info('MatAnyone server stopped');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Failed to stop server', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Run a video matting job.
   * Sends frames to the MatAnyone2 server and receives alpha/foreground results.
   *
   * @param options - Matting job configuration
   * @returns Paths to the generated foreground and alpha videos
   */
  async matte(options: MatteOptions): Promise<MatteResult> {
    const store = useMatAnyoneStore.getState();

    if (store.setupStatus !== 'ready') {
      throw new Error(`MatAnyone server not ready (status: ${store.setupStatus})`);
    }

    const jobId = `matanyone_${Date.now()}`;
    store.setJobState({
      isProcessing: true,
      jobId,
      jobProgress: 0,
      currentFrame: 0,
      totalFrames: 0,
    });

    try {
      const response = await this.sendCommandWithProgress(
        'matanyone_matte',
        {
          video_path: options.videoPath,
          mask_path: options.maskPath,
          output_dir: options.outputDir,
          start_frame: options.startFrame,
          end_frame: options.endFrame,
        },
        (progress) => {
          useMatAnyoneStore.getState().setJobState({
            jobProgress: progress.percent ?? 0,
            currentFrame: progress.current_frame ?? 0,
            totalFrames: progress.total_frames ?? 0,
          });
        },
        600_000, // 10 minute timeout for long videos
      );

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Matting failed';
        throw new Error(errMsg);
      }

      const data = response as any;
      const result: MatteResult = {
        foregroundPath: data.foreground_path,
        alphaPath: data.alpha_path,
      };

      useMatAnyoneStore.getState().setLastResult({
        ...result,
        sourceClipId: options.sourceClipId,
      });

      log.info('Matting complete', result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Matting failed', e);
      useMatAnyoneStore.getState().setError(msg);
      throw e;
    } finally {
      useMatAnyoneStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
      });
    }
  }

  /**
   * Cancel a running matting job.
   */
  async cancelJob(): Promise<void> {
    const store = useMatAnyoneStore.getState();
    const jobId = store.jobId;

    if (!jobId) {
      log.warn('No active job to cancel');
      return;
    }

    try {
      await this.sendCommand('matanyone_cancel', { job_id: jobId });
      useMatAnyoneStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 0,
      });
      log.info('Job cancelled', { jobId });
    } catch (e) {
      log.error('Failed to cancel job', e);
    }
  }

  /**
   * Uninstall MatAnyone2: removes the virtual environment and downloaded models.
   */
  async uninstall(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!NativeHelperClient.isConnected()) {
      store.setError('Native helper not connected');
      return;
    }

    // Stop server first if running
    if (store.setupStatus === 'ready') {
      await this.stopServer();
    }

    try {
      const response = await this.sendCommand('matanyone_uninstall');

      if (!response.ok) {
        const errMsg = (response as any).error?.message || 'Uninstall failed';
        useMatAnyoneStore.getState().setError(errMsg);
        return;
      }

      useMatAnyoneStore.getState().reset();
      log.info('MatAnyone uninstalled');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Uninstall failed', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Dispose the service and reset store state.
   */
  dispose(): void {
    useMatAnyoneStore.getState().reset();
  }

  // --- Private helpers ---

  /**
   * Send a command to the native helper and wait for a response.
   */
  private sendCommand(
    cmd: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<any> {
    const id = `matanyone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      if (!NativeHelperClient.isConnected()) {
        reject(new Error('Native helper not connected'));
        return;
      }

      const ws = (NativeHelperClient as any).ws as WebSocket | null;
      if (!ws) {
        reject(new Error('Native helper WebSocket not available'));
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Command ${cmd} timed out`));
      }, timeoutMs);

      const handler = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            cleanup();
            resolve(data);
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
      };

      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ cmd, id, ...params }));
    });
  }

  /**
   * Send a command that streams progress updates before the final response.
   */
  private sendCommandWithProgress(
    cmd: string,
    params: Record<string, unknown> = {},
    onProgress: (progress: any) => void,
    timeoutMs = 120_000,
  ): Promise<any> {
    const id = `matanyone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      if (!NativeHelperClient.isConnected()) {
        reject(new Error('Native helper not connected'));
        return;
      }

      const ws = (NativeHelperClient as any).ws as WebSocket | null;
      if (!ws) {
        reject(new Error('Native helper WebSocket not available'));
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Command ${cmd} timed out`));
      }, timeoutMs);

      const handler = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          const data = JSON.parse(event.data);
          if (data.id !== id) return;

          // Progress update — not the final response
          if (data.type === 'progress') {
            onProgress(data);
            return;
          }

          // Final response
          cleanup();
          resolve(data);
        } catch {
          // Ignore non-JSON messages
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
      };

      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ cmd, id, ...params }));
    });
  }
}

// --- HMR-safe singleton ---

let instance: MatAnyoneService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.matAnyoneService) {
    instance = import.meta.hot.data.matAnyoneService;
  }
  import.meta.hot.dispose((data) => {
    data.matAnyoneService = instance;
  });
}

/** Get the singleton MatAnyoneService instance */
export function getMatAnyoneService(): MatAnyoneService {
  if (!instance) {
    instance = new MatAnyoneService();
  }
  return instance;
}
