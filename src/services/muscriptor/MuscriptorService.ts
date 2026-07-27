import type { TimelineClip } from '../../types/timeline';
import { useMuscriptorStore } from '../../stores/muscriptorStore';
import { Logger } from '../logger';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import type {
  MuscriptorDevice,
  MuscriptorModelVariant,
  MuscriptorProgress,
  MuscriptorStatusResponse,
  MuscriptorTranscriptionResult,
} from '../nativeHelper/protocol';
import {
  prepareMuscriptorAudio,
  type PrepareMuscriptorAudioOptions,
  type PreparedMuscriptorAudio,
} from './audioPreparation';
import {
  mapMuscriptorTimelineTranscription,
  type MuscriptorTimelineTranscription,
} from './eventMapping';

const log = Logger.create('Muscriptor');

export interface MuscriptorDownloadOptions {
  variant?: MuscriptorModelVariant;
  /** Transient gated-model credential. Never written into the store. */
  hfToken?: string;
}

export interface MuscriptorStartOptions {
  variant?: MuscriptorModelVariant;
  device?: MuscriptorDevice;
}

export interface MuscriptorTranscribeOptions {
  audioPath: string;
  instruments?: readonly string[];
}

export interface MuscriptorClipTranscribeOptions extends PrepareMuscriptorAudioOptions {
  instruments?: readonly string[];
}

export class MuscriptorService {
  async checkStatus(): Promise<MuscriptorStatusResponse | null> {
    if (!(await this.ensureNativeHelperConnected())) {
      useMuscriptorStore.getState().setSetupStatus('not-available');
      return null;
    }

    try {
      const status = await NativeHelperClient.muscriptor.status();
      this.applyStatus(status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useMuscriptorStore.getState().setSetupStatus('error');
      useMuscriptorStore.getState().setError(message);
      log.warn('MuScriptor status check failed', error);
      return null;
    }
  }

  async setup(): Promise<boolean> {
    if (!(await this.ensureNativeHelperConnected())) {
      this.setUnavailableError();
      return false;
    }

    const store = useMuscriptorStore.getState();
    store.clearSetupLog();
    store.setError(null);
    store.setSetupStatus('installing');
    store.setSetupProgress(0, 'setup', 'Preparing local MuScriptor environment...');

    try {
      const result = await NativeHelperClient.muscriptor.setup(progress => this.applySetupProgress(progress));
      if (!result.success) {
        this.setOperationError(result.error ?? 'MuScriptor setup failed');
        return false;
      }
      await this.checkStatus();
      return true;
    } catch (error) {
      this.setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async downloadModel(options: MuscriptorDownloadOptions = {}): Promise<boolean> {
    if (!(await this.ensureNativeHelperConnected())) {
      this.setUnavailableError();
      return false;
    }

    const variant = options.variant ?? useMuscriptorStore.getState().variant;
    const store = useMuscriptorStore.getState();
    store.setVariant(variant);
    store.setError(null);
    store.setSetupStatus('downloading-model');
    store.setSetupProgress(0, 'download_model', `Downloading MuScriptor ${variant} model...`);

    try {
      const result = await NativeHelperClient.muscriptor.downloadModel({
        variant,
        hfToken: options.hfToken,
      }, progress => this.applySetupProgress(progress));
      if (!result.success) {
        this.setOperationError(result.error ?? 'MuScriptor model download failed');
        return false;
      }
      await this.checkStatus();
      return true;
    } catch (error) {
      this.setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async start(options: MuscriptorStartOptions = {}): Promise<boolean> {
    if (!(await this.ensureNativeHelperConnected())) {
      this.setUnavailableError();
      return false;
    }

    const state = useMuscriptorStore.getState();
    const variant = options.variant ?? state.variant;
    const device = options.device ?? state.device;
    state.setVariant(variant);
    state.setDevice(device);
    state.setError(null);
    state.setSetupStatus('starting');

    try {
      const result = await NativeHelperClient.muscriptor.start({ variant, device });
      if (!result.success) {
        this.setOperationError(result.error ?? 'MuScriptor server failed to start');
        return false;
      }
      useMuscriptorStore.getState().setEnvironment({ serverPort: result.port ?? null });
      if (result.activeDevice) {
        useMuscriptorStore.getState().setSetupProgress(
          100,
          'start_server',
          `MuScriptor is running on ${result.activeDevice.toUpperCase()}`,
        );
      }
      useMuscriptorStore.getState().setSetupStatus('ready');
      log.info('MuScriptor sidecar started', {
        port: result.port,
        requestedDevice: device,
        runtimeDevice: result.activeDevice,
      });
      return true;
    } catch (error) {
      this.setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async stop(): Promise<boolean> {
    try {
      const result = await NativeHelperClient.muscriptor.stop();
      if (!result.success) {
        useMuscriptorStore.getState().setError(result.error ?? 'MuScriptor server failed to stop');
        return false;
      }
      const state = useMuscriptorStore.getState();
      state.setEnvironment({ serverPort: null });
      state.setSetupStatus(state.modelsDownloaded.includes(state.variant) ? 'installed' : 'model-needed');
      return true;
    } catch (error) {
      useMuscriptorStore.getState().setError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async transcribe(options: MuscriptorTranscribeOptions): Promise<MuscriptorTranscriptionResult | null> {
    if (!(await this.ensureNativeHelperConnected())) {
      this.setUnavailableError();
      return null;
    }

    const store = useMuscriptorStore.getState();
    store.setError(null);
    store.setJobState({
      isProcessing: true,
      jobId: null,
      jobProgress: 0,
      noteCount: 0,
    });

    try {
      const result = await NativeHelperClient.muscriptor.transcribe({
        audioPath: options.audioPath,
        instruments: options.instruments?.length ? options.instruments : undefined,
      }, progress => this.applyTranscriptionProgress(progress));
      useMuscriptorStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 100,
        noteCount: result.notes.length,
      });
      return result;
    } catch (error) {
      const wasCancelled = (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && /cancel/i.test(error.message));
      useMuscriptorStore.getState().setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 0,
      });
      if (!wasCancelled) {
        const message = error instanceof Error ? error.message : String(error);
        useMuscriptorStore.getState().setError(message);
        log.error('MuScriptor transcription failed', error);
      }
      return null;
    }
  }

  async transcribePrepared(
    prepared: PreparedMuscriptorAudio,
    instruments?: readonly string[],
  ): Promise<MuscriptorTimelineTranscription | null> {
    try {
      const result = await this.transcribe({ audioPath: prepared.audioPath, instruments });
      return result ? mapMuscriptorTimelineTranscription(result, {
        sourceAudioClipId: prepared.audioClipId,
        sourceFingerprint: prepared.sourceFingerprint,
        processingStateHash: prepared.processingStateHash,
        sourceFileKey: prepared.sourceFileKey,
        timelineStart: prepared.timelineStart,
        duration: prepared.duration,
      }) : null;
    } finally {
      await prepared.cleanup?.();
    }
  }

  async transcribeClip(
    clip: TimelineClip,
    options: MuscriptorClipTranscribeOptions = {},
  ): Promise<MuscriptorTimelineTranscription | null> {
    const { instruments, ...prepareOptions } = options;
    try {
      const prepared = await prepareMuscriptorAudio(clip, prepareOptions);
      return await this.transcribePrepared(
        prepared,
        instruments ?? useMuscriptorStore.getState().instruments,
      );
    } catch (error) {
      const wasCancelled = error instanceof DOMException && error.name === 'AbortError';
      if (!wasCancelled) {
        const message = error instanceof Error ? error.message : String(error);
        useMuscriptorStore.getState().setError(message);
        log.error('MuScriptor audio preparation failed', error);
      }
      return null;
    }
  }

  async cancel(): Promise<boolean> {
    const current = useMuscriptorStore.getState();
    if (!current.isProcessing) return false;
    // A user can cancel before the first queued progress event delivers the
    // provider job id. The helper performs a hard provider-process cancel, so
    // a sentinel id is sufficient at that boundary.
    const jobId = current.jobId ?? '__active__';

    try {
      const result = await NativeHelperClient.muscriptor.cancel(jobId);
      const state = useMuscriptorStore.getState();
      state.setJobState({
        isProcessing: false,
        jobId: null,
        jobProgress: 0,
      });
      if (result.restartRequired) {
        state.setEnvironment({ serverPort: null });
        state.setSetupStatus(state.modelsDownloaded.includes(state.variant)
          ? 'installed'
          : 'model-needed');
      }
      return true;
    } catch (error) {
      useMuscriptorStore.getState().setError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async uninstall(): Promise<boolean> {
    if (!(await this.ensureNativeHelperConnected())) {
      this.setUnavailableError();
      return false;
    }

    if (useMuscriptorStore.getState().isProcessing) {
      await this.cancel();
    }
    await this.stop();

    try {
      const result = await NativeHelperClient.muscriptor.uninstall();
      if (!result.success) {
        this.setOperationError(result.error ?? 'MuScriptor uninstall failed');
        return false;
      }
      useMuscriptorStore.getState().reset();
      return true;
    } catch (error) {
      this.setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private async ensureNativeHelperConnected(): Promise<boolean> {
    if (NativeHelperClient.isConnected()) return true;
    try {
      return await NativeHelperClient.connect();
    } catch {
      return false;
    }
  }

  private applyStatus(status: MuscriptorStatusResponse): void {
    const state = useMuscriptorStore.getState();
    const modelsDownloaded = status.models_downloaded ?? [];
    state.setEnvironment({
      availableInstruments: status.available_instruments ?? [],
      modelsDownloaded,
      pythonVersion: status.python_version ?? null,
      cudaAvailable: status.cuda_available ?? false,
      cudaVersion: status.cuda_version ?? null,
      gpuName: status.gpu_name ?? null,
      vramMb: status.vram_mb ?? null,
      serverPort: status.server_port ?? null,
    });
    if (status.active_variant) state.setVariant(status.active_variant);
    state.setError(status.error ?? null);

    if (status.server_running || status.setup_status === 'running') {
      state.setSetupStatus('ready');
    } else if (status.setup_status === 'error') {
      state.setSetupStatus('error');
    } else if (!status.deps_installed) {
      state.setSetupStatus('not-installed');
    } else if (!modelsDownloaded.includes(useMuscriptorStore.getState().variant)) {
      state.setSetupStatus('model-needed');
    } else {
      state.setSetupStatus('installed');
    }
  }

  private applySetupProgress(progress: MuscriptorProgress): void {
    const details = [progress.message, progress.speed, progress.eta].filter(Boolean).join(' · ');
    useMuscriptorStore.getState().setSetupProgress(progress.percent, progress.step, details || undefined);
  }

  private applyTranscriptionProgress(progress: MuscriptorProgress): void {
    useMuscriptorStore.getState().setJobState({
      ...(progress.job_id ? { jobId: progress.job_id } : {}),
      jobProgress: progress.percent,
      ...(progress.note_count !== undefined ? { noteCount: progress.note_count } : {}),
    });
  }

  private setUnavailableError(): void {
    useMuscriptorStore.getState().setSetupStatus('not-available');
    useMuscriptorStore.getState().setError('Native Helper is not connected');
  }

  private setOperationError(message: string): void {
    useMuscriptorStore.getState().setError(message);
    useMuscriptorStore.getState().setSetupStatus('error');
  }
}

let instance: MuscriptorService | null = null;

export function getMuscriptorService(): MuscriptorService {
  instance ??= new MuscriptorService();
  return instance;
}

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.muscriptorService) {
    instance = import.meta.hot.data.muscriptorService as MuscriptorService;
  }
  import.meta.hot.dispose((data) => {
    data.muscriptorService = instance;
  });
}
