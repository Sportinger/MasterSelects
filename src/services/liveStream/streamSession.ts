import { useStreamStore } from '../../stores/streamStore';
import { createCaptureAudioMix, type CaptureAudioMix } from '../capture/recording/audioMixing';
import { Logger } from '../logger';
import { openCloudStreamConnection } from './cloudStreamClient';
import { isHelperReachable, openHelperStreamConnection } from './helperStreamClient';
import { startLocalStreamRecording, type LocalStreamRecordingHandle } from './localRecorder';
import { createProgramTap } from './programTap';
import { startRtmpSink } from './rtmpSink';
import {
  appendStreamHealthSample,
  getStreamHealthHistory,
  resetStreamHealthHistory,
} from './streamHealthHistory';
import {
  createIdleLiveStreamStats,
  STREAM_RESOLUTION_PRESETS,
  type ActiveStreamSink,
  type LiveStreamConfig,
  type LiveStreamStatus,
  type ProgramTapHandle,
} from './streamTypes';
import { startWhipSink } from './whipSink';

const log = Logger.create('StreamSession');

interface StreamRuntime {
  config: LiveStreamConfig;
  tap: ProgramTapHandle;
  mix: CaptureAudioMix;
  sink: ActiveStreamSink | null;
  recorder: LocalStreamRecordingHandle | null;
  startedAtMs: number;
  statsInterval: ReturnType<typeof globalThis.setInterval> | null;
  endingPromise: Promise<void> | null;
  wentLive: boolean;
}

interface StreamSessionHotData {
  liveStreamSession?: StreamRuntime | null;
}

let activeSession = (import.meta.hot?.data as StreamSessionHotData | undefined)?.liveStreamSession ?? null;

function patchStatus(patch: Partial<LiveStreamStatus>): void {
  useStreamStore.getState()._patchStatus(patch);
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Live streaming failed.');
}

function redactConfigSecrets(message: string, config: LiveStreamConfig): string {
  let redacted = message;
  if (config.rtmpStreamKey) redacted = redacted.replaceAll(config.rtmpStreamKey, '[redacted]');
  if (config.whipBearerToken) redacted = redacted.replaceAll(config.whipBearerToken, '[redacted]');
  return redacted;
}

function appendFailedSessionStart(config: LiveStreamConfig, startedAtMs: number, cause: unknown): Error {
  const safeError = new Error(redactConfigSecrets(asError(cause).message, config));
  const status = useStreamStore.getState().status;
  useStreamStore.getState()._appendSessionLog({
    startedAtMs,
    durationSeconds: 0,
    transport: status.transport ?? config.transport,
    relay: status.activeRtmpRelay,
    avgBitrateKbps: 0,
    droppedFrames: 0,
    endReason: 'error',
    errorMessage: safeError.message,
  });
  return safeError;
}

function beginStatsUpdates(runtime: StreamRuntime): void {
  let previousBytes = 0;
  let previousSampleMs = runtime.startedAtMs;
  runtime.statsInterval = globalThis.setInterval(() => {
    if (activeSession !== runtime || !runtime.sink) return;
    const now = Date.now();
    const sinkStats = runtime.sink.getStats();
    const bytesSent = sinkStats.bytesSent ?? 0;
    const elapsedMs = Math.max(1, now - previousSampleMs);
    const bitrateKbpsEstimate = Math.max(0, (bytesSent - previousBytes) * 8 / elapsedMs);
    const levels = runtime.mix.getLevels();
    const droppedFrames = sinkStats.droppedFrames ?? 0;
    const encodeQueueSize = sinkStats.encodeQueueSize ?? 0;
    const queuedBytes = sinkStats.queuedBytes ?? 0;
    previousBytes = bytesSent;
    previousSampleMs = now;
    patchStatus({
      stats: {
        uptimeSeconds: Math.max(0, Math.floor((now - runtime.startedAtMs) / 1000)),
        droppedFrames,
        encodeQueueSize,
        bytesSent,
        queuedBytes,
        bitrateKbpsEstimate,
        audioLevels: { program: levels.display, microphone: levels.microphone },
      },
    });
    appendStreamHealthSample({
      atMs: now,
      bitrateKbps: bitrateKbpsEstimate,
      droppedFrames,
      queuedBytes,
      encodeQueueSize,
      audioProgram: levels.display,
      audioMicrophone: levels.microphone,
    });
  }, 1_000);
}

async function finishSession(runtime: StreamRuntime, fatalCause?: unknown): Promise<void> {
  if (runtime.endingPromise) return runtime.endingPromise;
  runtime.endingPromise = (async () => {
    let failure = fatalCause === undefined ? null : asError(fatalCause);
    const rememberFailure = (cause: unknown) => { failure ??= asError(cause); };

    try {
      await runtime.sink?.stop();
    } catch (error) {
      rememberFailure(error);
    }
    if (runtime.recorder) {
      try {
        const result = await runtime.recorder.stop();
        if (result.importedMediaName) {
          log.info('Local live recording imported into the Media Panel', {
            importedMediaName: result.importedMediaName,
          });
        }
      } catch (error) {
        rememberFailure(error);
      }
    }
    try {
      await runtime.mix.close();
    } catch (error) {
      rememberFailure(error);
    }
    try {
      runtime.tap.close();
    } catch (error) {
      rememberFailure(error);
    }
    if (runtime.statsInterval) {
      globalThis.clearInterval(runtime.statsInterval);
      runtime.statsInterval = null;
    }
    if (activeSession === runtime) activeSession = null;

    const status = useStreamStore.getState().status;
    const samples = getStreamHealthHistory();
    const safeMessage = failure ? redactConfigSecrets(failure.message, runtime.config) : undefined;
    useStreamStore.getState()._appendSessionLog({
      startedAtMs: runtime.startedAtMs,
      durationSeconds: runtime.wentLive || status.startedAtMs !== null
        ? Math.max(0, Math.floor((Date.now() - runtime.startedAtMs) / 1_000))
        : 0,
      transport: status.transport ?? runtime.config.transport,
      relay: status.activeRtmpRelay,
      avgBitrateKbps: samples.length === 0
        ? 0
        : samples.reduce((total, sample) => total + sample.bitrateKbps, 0) / samples.length,
      droppedFrames: samples.at(-1)?.droppedFrames ?? 0,
      endReason: failure ? 'error' : 'ended',
      ...(safeMessage ? { errorMessage: safeMessage } : {}),
    });

    if (failure) {
      log.error('Live stream session ended with an error', new Error(safeMessage));
      patchStatus({
        phase: 'error',
        transport: null,
        activeRtmpRelay: null,
        startedAtMs: null,
        recording: false,
        lastError: safeMessage,
        stats: createIdleLiveStreamStats(),
      });
      if (fatalCause === undefined) throw new Error(safeMessage);
      return;
    }

    log.info('Live stream session ended');
    patchStatus({
      phase: 'idle',
      transport: null,
      activeRtmpRelay: null,
      startedAtMs: null,
      recording: false,
      lastError: null,
      stats: createIdleLiveStreamStats(),
    });
  })();
  return runtime.endingPromise;
}

export async function startStreamSession(config: LiveStreamConfig): Promise<void> {
  if (activeSession) throw new Error('A live stream session is already active.');
  resetStreamHealthHistory();
  const attemptedAtMs = Date.now();
  const resolution = STREAM_RESOLUTION_PRESETS[config.resolution];
  const relayMode = config.rtmpRelay ?? 'auto';
  let activeRtmpRelay: 'helper' | 'cloud' | null;
  try {
    activeRtmpRelay = config.transport === 'rtmp'
      ? relayMode === 'auto'
        ? await isHelperReachable() ? 'helper' : 'cloud'
        : relayMode
      : null;
  } catch (error) {
    throw appendFailedSessionStart(config, attemptedAtMs, error);
  }
  const connectionFactory = activeRtmpRelay === 'helper'
    ? openHelperStreamConnection
    : openCloudStreamConnection;
  patchStatus({
    phase: 'starting',
    transport: config.transport,
    activeRtmpRelay: null,
    startedAtMs: null,
    lastError: null,
    recording: false,
    stats: createIdleLiveStreamStats(),
  });

  let tap: ProgramTapHandle;
  try {
    tap = createProgramTap({
      width: resolution.width,
      height: resolution.height,
      fps: config.fps,
      includeMasterAudio: config.includeMasterAudio,
    });
  } catch (error) {
    throw appendFailedSessionStart(config, attemptedAtMs, error);
  }
  let mix: CaptureAudioMix;
  try {
    mix = await createCaptureAudioMix({
      displayStream: tap.stream,
      includeDisplayAudio: tap.hasProgramAudio && config.includeMasterAudio,
      includeMicrophone: config.includeMicrophone,
      microphoneDeviceId: config.microphoneDeviceId,
    });
  } catch (error) {
    const safeError = appendFailedSessionStart(config, attemptedAtMs, error);
    try {
      tap.close();
    } catch (closeError) {
      log.warn('Failed to close the program tap after stream startup failed', closeError);
    }
    throw safeError;
  }

  const runtime: StreamRuntime = {
    config,
    tap,
    mix,
    sink: null,
    recorder: null,
    startedAtMs: Date.now(),
    statsInterval: null,
    endingPromise: null,
    wentLive: false,
  };
  activeSession = runtime;

  const callbacks = {
    onFatalError: (error: Error) => { void finishSession(runtime, error); },
    onStatusMessage: (_message: string) => undefined,
  };

  try {
    const sink = config.transport === 'rtmp'
      ? await startRtmpSink({
          mixedStream: mix.recordingStream,
          config,
          callbacks,
          deps: { connectionFactory },
        })
      : await startWhipSink({ mixedStream: mix.recordingStream, config, callbacks });
    if (activeSession !== runtime || runtime.endingPromise) {
      await sink.stop().catch(() => undefined);
      throw new Error('The live stream ended while it was starting.');
    }
    runtime.sink = sink;
    if (config.recordLocally) {
      runtime.recorder = startLocalStreamRecording(mix.recordingStream);
    }
    runtime.startedAtMs = Date.now();
    patchStatus({
      phase: 'live',
      transport: config.transport,
      activeRtmpRelay,
      startedAtMs: runtime.startedAtMs,
      lastError: null,
      recording: runtime.recorder !== null,
    });
    runtime.wentLive = true;
    beginStatsUpdates(runtime);
    log.info(`Live stream session started (${config.transport})`);
  } catch (error) {
    if (activeSession === runtime && !runtime.endingPromise) await finishSession(runtime, error);
    throw error;
  }
}

export async function endStreamSession(): Promise<void> {
  const runtime = activeSession;
  if (!runtime) {
    patchStatus({
      phase: 'idle',
      transport: null,
      activeRtmpRelay: null,
      startedAtMs: null,
      recording: false,
      lastError: null,
      stats: createIdleLiveStreamStats(),
    });
    return;
  }
  patchStatus({ phase: 'stopping' });
  await finishSession(runtime);
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => {
    (data as StreamSessionHotData).liveStreamSession = activeSession;
  });
}
