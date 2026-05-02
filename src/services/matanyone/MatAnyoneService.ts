/**
 * MatAnyone2 Video Matting Service
 *
 * Manages the lifecycle of the MatAnyone2 inference environment:
 * status checks, setup, model downloads, server management, and matting jobs.
 *
 * Uses NativeHelperClient methods (matanyoneStatus, matanyoneSetup, etc.)
 * for all communication with the native helper.
 */

import { Logger } from '../logger';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';

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

type NativeHelperInfoFallback = {
  matanyone_available?: boolean;
  matanyone_status?: string;
};

export class MatAnyoneService {
  private async ensureNativeHelperConnected(): Promise<boolean> {
    if (NativeHelperClient.isConnected()) {
      return true;
    }

    try {
      return await NativeHelperClient.connect();
    } catch {
      return false;
    }
  }

  /**
   * Check the current MatAnyone2 environment status via native helper.
   */
  async checkStatus(): Promise<void> {
    const connected = await this.ensureNativeHelperConnected();
    log.warn('checkStatus called, connected=' + connected);

    if (!connected) {
      useMatAnyoneStore.getState().setSetupStatus('not-available');
      return;
    }

    try {
      log.warn('checkStatus: sending mat_anyone_status...');
      const data = await NativeHelperClient.matanyoneStatus();
      this.applyDetailedStatus(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('checkStatus FAILED, falling back to info: ' + msg);

      try {
        const info = await NativeHelperClient.getInfo() as NativeHelperInfoFallback;
        this.applyInfoFallback(info, msg);
      } catch (infoError) {
        const infoMsg = infoError instanceof Error ? infoError.message : String(infoError);
        log.warn('checkStatus info fallback FAILED: ' + infoMsg);
        // Only set not-installed if we haven't already resolved to a better status
        const current = useMatAnyoneStore.getState().setupStatus;
        if (current === 'not-checked' || current === 'not-available') {
          useMatAnyoneStore.getState().setSetupStatus('not-installed');
        }
      }
    }
  }

  private applyDetailedStatus(data: {
    python_version?: string | null;
    cuda_available?: boolean;
    cuda_version?: string | null;
    gpu_name?: string | null;
    vram_mb?: number | null;
    model_downloaded?: boolean;
    venv_exists?: boolean;
    deps_installed?: boolean;
    matanyone_installed?: boolean;
    server_running?: boolean;
    setup_status?: string;
  }): void {
    log.warn(
      'checkStatus: got response, setup=' + (data.setup_status || 'unknown')
      + ', installed=' + String(data.matanyone_installed)
      + ', model=' + String(data.model_downloaded)
      + ', venv=' + String(data.venv_exists)
      + ', deps=' + String(data.deps_installed)
      + ', gpu=' + (data.gpu_name || 'none')
    );

    useMatAnyoneStore.getState().setEnvInfo({
      pythonVersion: data.python_version ?? null,
      cudaAvailable: data.cuda_available ?? false,
      cudaVersion: data.cuda_version ?? null,
      gpuName: data.gpu_name ?? null,
      vramMb: data.vram_mb ?? null,
      modelDownloaded: data.model_downloaded ?? false,
    });

    if (data.server_running || data.setup_status === 'running') {
      useMatAnyoneStore.getState().setSetupStatus('ready');
    } else if (data.matanyone_installed && data.model_downloaded) {
      useMatAnyoneStore.getState().setSetupStatus('installed');
    } else if (data.matanyone_installed && !data.model_downloaded) {
      useMatAnyoneStore.getState().setSetupStatus('model-needed');
    } else if (data.venv_exists && data.deps_installed) {
      useMatAnyoneStore.getState().setSetupStatus('model-needed');
    } else {
      useMatAnyoneStore.getState().setSetupStatus('not-installed');
    }

    log.info('Status check complete', {
      status: useMatAnyoneStore.getState().setupStatus,
      cuda: data.cuda_available,
      gpu: data.gpu_name,
    });
  }

  private applyInfoFallback(info: NativeHelperInfoFallback, reason: string): void {
    const fallbackStatus = info.matanyone_status ?? 'unknown';
    log.warn(
      'checkStatus info fallback: status=' + fallbackStatus
      + ', available=' + String(info.matanyone_available)
    );

    if (fallbackStatus === 'running') {
      useMatAnyoneStore.getState().setSetupStatus('ready');
      useMatAnyoneStore.getState().setError(null);
      return;
    }

    if (
      fallbackStatus === 'installed'
      || info.matanyone_available
      || fallbackStatus.startsWith('error:')
    ) {
      useMatAnyoneStore.getState().setSetupStatus('installed');
      useMatAnyoneStore.getState().setError(
        fallbackStatus.startsWith('error:') ? fallbackStatus.slice('error:'.length).trim() : null
      );
      return;
    }

    if (fallbackStatus === 'not_installed') {
      useMatAnyoneStore.getState().setSetupStatus('not-installed');
      useMatAnyoneStore.getState().setError(null);
      return;
    }

    useMatAnyoneStore.getState().setSetupStatus('not-installed');
    useMatAnyoneStore.getState().setError(reason);
  }

  /**
   * Run the full automated setup: creates venv, installs dependencies.
   */
  async setup(pythonPath?: string): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!(await this.ensureNativeHelperConnected())) {
      store.setSetupStatus('not-available');
      store.setError('Native helper not connected');
      return;
    }

    store.setSetupStatus('installing');
    store.setSetupProgress(0, 'Initializing setup...');
    store.clearSetupLog();

    try {
      const result = await NativeHelperClient.matanyoneSetup(
        (step, percent, message) => {
          useMatAnyoneStore.getState().setSetupProgress(percent, step, message);
        },
        pythonPath,
      );

      if (!result.success) {
        useMatAnyoneStore.getState().setSetupStatus('error');
        useMatAnyoneStore.getState().setError(result.error || 'Setup failed');
        return;
      }

      log.info('Setup complete');
      await this.checkStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Setup failed', e);
      useMatAnyoneStore.getState().setSetupStatus('error');
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Download the MatAnyone2 model weights.
   */
  async downloadModel(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!(await this.ensureNativeHelperConnected())) {
      store.setSetupStatus('not-available');
      store.setError('Native helper not connected');
      return;
    }

    store.setSetupStatus('downloading-model');
    store.setSetupProgress(0, 'download_model', 'Downloading model...');

    try {
      const result = await NativeHelperClient.matanyoneDownloadModel(
        (percent, speed, eta) => {
          const msg = speed ? `Downloading... ${speed}${eta ? `, ETA: ${eta}` : ''}` : 'Downloading...';
          useMatAnyoneStore.getState().setSetupProgress(percent, 'download_model', msg);
        },
      );

      if (!result.success) {
        useMatAnyoneStore.getState().setSetupStatus('error');
        useMatAnyoneStore.getState().setError(result.error || 'Model download failed');
        return;
      }

      log.info('Model download complete');
      await this.checkStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Model download failed', e);
      useMatAnyoneStore.getState().setSetupStatus('error');
      useMatAnyoneStore.getState().setError(msg);
    }
  }

  /**
   * Start the MatAnyone2 inference server.
   */
  async startServer(): Promise<void> {
    const store = useMatAnyoneStore.getState();

    if (!(await this.ensureNativeHelperConnected())) {
      log.warn('startServer aborted: native helper not connected');
      store.setError('Native helper not connected');
      return;
    }

    store.setError(null);
    store.setSetupStatus('starting');

    try {
      const result = await NativeHelperClient.matanyoneStart();

      if (!result.success) {
        useMatAnyoneStore.getState().setError('Failed to start server');
        store.setSetupStatus('installed');
        return;
      }

      store.setSetupStatus('ready');
      log.info('Server started', { port: result.port });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Failed to start server', e);
      useMatAnyoneStore.getState().setError(msg);
      store.setSetupStatus('installed');
    }
  }

  /**
   * Stop the MatAnyone2 inference server.
   */
  async stopServer(): Promise<void> {
    try {
      await NativeHelperClient.matanyoneStop();
      useMatAnyoneStore.getState().setSetupStatus('installed');
      log.info('Server stopped');
    } catch (e) {
      log.error('Failed to stop server', e);
    }
  }

  /**
   * Run a video matting job.
   */
  async matte(options: MatteOptions): Promise<MatteResult | null> {
    const store = useMatAnyoneStore.getState();

    if (!(await this.ensureNativeHelperConnected())) {
      store.setError('Native helper not connected');
      return null;
    }

    store.setJobState({
      isProcessing: true,
      jobProgress: 0,
      currentFrame: 0,
      totalFrames: 0,
    });
    store.setError(null);

    try {
      const result = await NativeHelperClient.matanyoneMatte(
        options.videoPath,
        options.maskPath,
        options.outputDir,
        { startFrame: options.startFrame, endFrame: options.endFrame },
        (currentFrame, totalFrames, percent, jobId) => {
          useMatAnyoneStore.getState().setJobState({
            ...(jobId ? { jobId } : {}),
            jobProgress: percent,
            currentFrame,
            totalFrames,
          });
        },
      );

      const matteResult: MatteResult = {
        foregroundPath: result.foreground_path,
        alphaPath: result.alpha_path,
      };

      useMatAnyoneStore.getState().setLastResult({
        foregroundPath: matteResult.foregroundPath,
        alphaPath: matteResult.alphaPath,
        sourceClipId: options.sourceClipId,
      });

      useMatAnyoneStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 100,
      });

      log.info('Matting complete', matteResult);
      return matteResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Matting failed', e);
      const wasCancelled = /cancel/i.test(msg);
      useMatAnyoneStore.getState().setError(wasCancelled ? null : msg);
      if (wasCancelled) {
        useMatAnyoneStore.getState().setSetupStatus('installed');
      }
      useMatAnyoneStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 0,
      });
      return null;
    }
  }

  /**
   * Cancel a running matting job.
   */
  async cancelJob(): Promise<void> {
    const jobId = useMatAnyoneStore.getState().jobId;
    if (!jobId) return;

    try {
      await NativeHelperClient.matanyoneCancel(jobId);
      useMatAnyoneStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 0,
      });
      useMatAnyoneStore.getState().setSetupStatus('installed');
      log.info('Job cancelled');
    } catch (e) {
      log.error('Failed to cancel job', e);
    }
  }

  /**
   * Uninstall MatAnyone2: removes venv and model files.
   */
  async uninstall(): Promise<void> {
    if (!(await this.ensureNativeHelperConnected())) {
      useMatAnyoneStore.getState().setError('Native helper not connected');
      return;
    }

    try {
      await this.stopServer();
      const result = await NativeHelperClient.matanyoneUninstall();

      if (!result.success) {
        useMatAnyoneStore.getState().setError('Uninstall failed');
        return;
      }

      useMatAnyoneStore.getState().reset();
      log.info('Uninstalled');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Uninstall failed', e);
      useMatAnyoneStore.getState().setError(msg);
    }
  }
}

let instance: MatAnyoneService | null = null;

/** Get the singleton MatAnyoneService instance */
export function getMatAnyoneService(): MatAnyoneService {
  if (!instance) {
    instance = new MatAnyoneService();
  }
  return instance;
}
