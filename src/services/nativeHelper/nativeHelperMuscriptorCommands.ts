import type {
  Command,
  MuscriptorDevice,
  MuscriptorModelVariant,
  MuscriptorProgress,
  MuscriptorRuntimeDevice,
  MuscriptorStatusResponse,
  MuscriptorTranscriptionResult,
} from './protocol';
import type {
  NativeHelperCommandHost,
  ProgressLikeResponse,
} from './nativeHelperClientTypes';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

const STATUS_TIMEOUT_MS = 15_000;
const CONTROL_TIMEOUT_MS = 120_000;
const START_TIMEOUT_MS = 16 * 60_000;
const SETUP_ACTIVITY_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_ACTIVITY_TIMEOUT_MS = 5 * 60_000;
const TRANSCRIBE_ACTIVITY_TIMEOUT_MS = 10 * 60_000;

export type MuscriptorProgressCallback = (progress: MuscriptorProgress) => void;

type ActiveTranscription = {
  requestId: string;
  reject: (error: Error) => void;
  cancelTimeout: () => void;
};

interface CommandResult {
  success: boolean;
  error?: string;
}

interface StartResult extends CommandResult {
  port?: number;
  activeDevice?: MuscriptorRuntimeDevice;
}

interface CancelResult {
  restartRequired: boolean;
}

export interface MuscriptorNativeCommands {
  status(): Promise<MuscriptorStatusResponse>;
  setup(onProgress?: MuscriptorProgressCallback): Promise<CommandResult>;
  downloadModel(
    options: { variant: MuscriptorModelVariant; hfToken?: string },
    onProgress?: MuscriptorProgressCallback,
  ): Promise<CommandResult>;
  start(options: { variant: MuscriptorModelVariant; device?: MuscriptorDevice }): Promise<StartResult>;
  stop(): Promise<CommandResult>;
  transcribe(
    options: { audioPath: string; instruments?: readonly string[] },
    onProgress?: MuscriptorProgressCallback,
  ): Promise<MuscriptorTranscriptionResult>;
  cancel(jobId: string): Promise<CancelResult>;
  uninstall(): Promise<CommandResult>;
}

export function createMuscriptorCommands(host: NativeHelperCommandHost): MuscriptorNativeCommands {
  let activeTranscription: ActiveTranscription | null = null;

  return {
    status: async () => {
      const id = host.nextId();
      const response = await host.send({ cmd: 'muscriptor_status', id }, STATUS_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(getErrorMessage(response, 'Failed to get MuScriptor status'));
      }
      return response as unknown as MuscriptorStatusResponse;
    },

    setup: (onProgress) => runProgressCommand(
      host,
      { cmd: 'muscriptor_setup', id: host.nextId() },
      SETUP_ACTIVITY_TIMEOUT_MS,
      'MuScriptor setup',
      onProgress,
      () => ({ success: true }),
    ),

    downloadModel: ({ variant, hfToken }, onProgress) => {
      const command: Command = {
        cmd: 'muscriptor_download_model',
        id: host.nextId(),
        variant,
      };
      const transientToken = hfToken?.trim();
      if (transientToken) command.hf_token = transientToken;
      return runProgressCommand(
        host,
        command,
        DOWNLOAD_ACTIVITY_TIMEOUT_MS,
        'MuScriptor model download',
        onProgress,
        () => ({ success: true }),
      );
    },

    start: async ({ variant, device }) => {
      const id = host.nextId();
      const requestedDevice = device === 'auto' ? undefined : device;
      const response = await host.send({
        cmd: 'muscriptor_start',
        id,
        variant,
        ...(requestedDevice ? { device: requestedDevice } : {}),
      }, START_TIMEOUT_MS);
      if (!response.ok) {
        return { success: false, error: getErrorMessage(response, 'Failed to start MuScriptor') };
      }
      const activeDevice = okField<MuscriptorRuntimeDevice>(response, 'active_device');
      return {
        success: true,
        port: okField<number>(response, 'port') ?? okField<number>(response, 'server_port'),
        ...(activeDevice ? { activeDevice } : {}),
      };
    },

    stop: () => runControlCommand(host, { cmd: 'muscriptor_stop', id: host.nextId() }, 'stop'),

    transcribe: (options, onProgress) => {
      if (activeTranscription) {
        return Promise.reject(new Error('A MuScriptor transcription is already running'));
      }
      const command: Command = {
        cmd: 'muscriptor_transcribe',
        id: host.nextId(),
        audio_path: options.audioPath,
        ...(options.instruments?.length ? { instruments: [...options.instruments] } : {}),
      };

      return new Promise<MuscriptorTranscriptionResult>((resolve, reject) => {
        const requestId = command.id;
        const cancelTimeout = registerProgressRequest(
          host,
          command,
          TRANSCRIBE_ACTIVITY_TIMEOUT_MS,
          'MuScriptor transcription',
          (progress) => {
            onProgress?.(progress);
          },
          (response) => {
            activeTranscription = null;
            if (!response.ok) {
              reject(new Error(getErrorMessage(response, 'MuScriptor transcription failed')));
              return;
            }
            resolve({
              job_id: okField<string>(response, 'job_id') ?? '',
              notes: okField<MuscriptorTranscriptionResult['notes']>(response, 'notes') ?? [],
            });
          },
          (error) => {
            activeTranscription = null;
            reject(error);
          },
        );
        activeTranscription = { requestId, reject, cancelTimeout };
      });
    },

    cancel: async (jobId) => {
      const response = await host.send({
        cmd: 'muscriptor_cancel',
        id: host.nextId(),
        job_id: jobId,
      }, CONTROL_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(getErrorMessage(response, 'Failed to cancel MuScriptor transcription'));
      }

      const active = activeTranscription;
      // The helper's hard-cancel boundary terminates the whole MuScriptor
      // sidecar, so any active transcription request is necessarily cancelled
      // even if the UI acted before receiving its provider job id.
      if (active) {
        active.cancelTimeout();
        host.deletePendingRequest(active.requestId);
        activeTranscription = null;
        active.reject(new DOMException('MuScriptor transcription was cancelled', 'AbortError'));
      }
      return {
        restartRequired: okField<boolean>(response, 'restart_required') ?? false,
      };
    },

    uninstall: () => runControlCommand(host, { cmd: 'muscriptor_uninstall', id: host.nextId() }, 'uninstall'),
  };
}

async function runControlCommand(
  host: NativeHelperCommandHost,
  command: Command,
  operation: string,
): Promise<CommandResult> {
  const response = await host.send(command, CONTROL_TIMEOUT_MS);
  return response.ok
    ? { success: true }
    : { success: false, error: getErrorMessage(response, `Failed to ${operation} MuScriptor`) };
}

function runProgressCommand<T>(
  host: NativeHelperCommandHost,
  command: Command,
  activityTimeoutMs: number,
  label: string,
  onProgress: MuscriptorProgressCallback | undefined,
  getResult: () => T,
): Promise<T & CommandResult> {
  return new Promise((resolve, reject) => {
    registerProgressRequest(
      host,
      command,
      activityTimeoutMs,
      label,
      onProgress,
      (response) => {
        if (response.ok) {
          resolve({ ...getResult(), success: true });
        } else {
          resolve({
            ...getResult(),
            success: false,
            error: getErrorMessage(response, `${label} failed`),
          });
        }
      },
      reject,
    );
  });
}

function registerProgressRequest(
  host: NativeHelperCommandHost,
  command: Command,
  activityTimeoutMs: number,
  label: string,
  onProgress: MuscriptorProgressCallback | undefined,
  onComplete: (response: ProgressLikeResponse) => void,
  onError: (error: Error) => void,
): () => void {
  if (!('id' in command)) {
    throw new Error(`${label} command is missing a request id`);
  }
  const id = command.id;
  let timeout: ReturnType<typeof setTimeout>;
  let settled = false;

  const cancelTimeout = () => clearTimeout(timeout);
  const armTimeout = () => {
    cancelTimeout();
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      host.deletePendingRequest(id);
      onError(new Error(`${label} timed out while waiting for activity`));
    }, activityTimeoutMs);
  };

  host.registerPendingRequest(id, (response: ProgressLikeResponse) => {
    if (settled) return;
    if (response.type === 'progress') {
      armTimeout();
      onProgress?.(toMuscriptorProgress(response));
      return;
    }

    settled = true;
    cancelTimeout();
    host.deletePendingRequest(id);
    onComplete(response);
  });

  armTimeout();
  host.sendRaw(JSON.stringify(command)).catch((error: unknown) => {
    if (settled) return;
    settled = true;
    cancelTimeout();
    host.deletePendingRequest(id);
    onError(error instanceof Error ? error : new Error(String(error)));
  });

  return cancelTimeout;
}

function toMuscriptorProgress(response: ProgressLikeResponse): MuscriptorProgress {
  return {
    type: 'progress',
    step: response.step ?? '',
    percent: response.percent ?? 0,
    ...(response.message !== undefined ? { message: response.message } : {}),
    ...(response.speed !== undefined ? { speed: response.speed } : {}),
    ...(response.eta !== undefined ? { eta: response.eta } : {}),
    ...(response.job_id !== undefined ? { job_id: response.job_id } : {}),
    ...(response.completed !== undefined ? { completed: response.completed } : {}),
    ...(response.total !== undefined ? { total: response.total } : {}),
    ...(response.note_count !== undefined ? { note_count: response.note_count } : {}),
  };
}
