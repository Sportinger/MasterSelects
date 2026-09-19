import type { TimelineClip } from '../../types';
import { WebCodecsPlayer } from '../../engine/WebCodecsPlayer';
import { flags } from '../../engine/featureFlags';
import { useMediaStore } from '../../stores/mediaStore';
import { renderHostPort } from '../render/renderHostPort';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import { mediaRuntimeRegistry } from './registry';
import {
  createWorkerWebCodecsFrameProvider,
  WorkerWebCodecsFrameProvider,
} from './workerWebCodecsFrameProvider';
import { selectRuntimeFrameProviderPlan } from './providerSelection';
import { buildRuntimeMetadataFromMediaFile } from './clipBindings';
import { createTurboResFrameProvider } from './prores/TurboResFrameProvider';
import { createHapFrameProvider } from './hap/HapFrameProvider';
import { Logger } from '../logger';
import {
  reserveRuntimeProviderResources,
  type RuntimeProviderReservation,
} from './runtimeProviderReservation';
import {
  INTERACTIVE_PLAYBACK_SESSION_PREFIX,
  INTERACTIVE_SCRUB_SESSION_PREFIX,
  PLAYBACK_RUNTIME_POLICY_IDS,
  buildPolicyRuntimeSessionKey,
  getPendingProviderLoadKey,
  getRuntimeProviderResourceId,
  hasRuntimeBinding,
  isInteractiveScrubSessionKey,
  shouldReplaceFrameProvider,
  type RuntimeBackedSource,
} from './runtimePlaybackPlanning';
import type {
  DecodeSession,
  DecodeSessionPolicy,
  FrameHandle,
  MediaSourceRuntime,
  RuntimeFrameProvider,
} from './types';

export interface RuntimePlaybackBinding {
  sourceId: string;
  sessionKey: string;
  session: DecodeSession;
  frameProvider: RuntimeFrameProvider | null;
}

const pendingRuntimeProviderLoads = new Map<string, Promise<RuntimeFrameProvider | null>>();
const log = Logger.create('RuntimePlayback');

function getRuntimeFile(runtime: MediaSourceRuntime): File | null {
  if (runtime.descriptor.file) {
    return runtime.descriptor.file;
  }

  if (runtime.descriptor.mediaFileId) {
    const mediaFile = useMediaStore.getState().files.find(
      (file) => file.id === runtime.descriptor.mediaFileId
    );
    if (mediaFile?.file) {
      return mediaFile.file;
    }
  }

  return null;
}

function releaseRuntimeProviderResources(sourceId: string, sessionKey: string): void {
  for (const policy of PLAYBACK_RUNTIME_POLICY_IDS) {
    timelineRuntimeCoordinator.releaseResource(
      getRuntimeProviderResourceId(policy, sourceId, sessionKey, 'runtime-binding')
    );
    timelineRuntimeCoordinator.releaseResource(
      getRuntimeProviderResourceId(policy, sourceId, sessionKey, 'frame-provider')
    );
  }
}

function refreshRuntimeMetadataFromMediaStore(runtime: MediaSourceRuntime): void {
  const mediaFileId = runtime.descriptor.mediaFileId;
  if (!mediaFileId) return;
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (mediaFile) runtime.updateMetadata(buildRuntimeMetadataFromMediaFile(mediaFile));
}

export interface EnsureRuntimeFrameProviderOptions {
  readonly preferWorkerWebCodecs?: boolean;
  readonly onFrame?: () => void;
  readonly onError?: (error: Error) => void;
}

function attachOwnedRuntimeProvider(
  runtime: MediaSourceRuntime,
  binding: RuntimePlaybackBinding,
  provider: RuntimeFrameProvider,
  reservation: RuntimeProviderReservation,
): boolean {
  if (
    mediaRuntimeRegistry.getRuntime(binding.sourceId) !== runtime
    || !runtime.peekSession(binding.sessionKey)
  ) {
    provider.destroy?.();
    reservation.release();
    return false;
  }
  const session = runtime.setSessionFrameProvider(binding.sessionKey, provider, {
    ownsProvider: true,
    onDispose: reservation.release,
  });
  if (session) return true;
  provider.destroy?.();
  reservation.release();
  return false;
}

function canUseWorkerWebCodecsFrameProvider(): boolean {
  return (
    renderHostPort.getTelemetry().mode === 'worker-presenting' ||
    renderHostPort.getTelemetry().mode === 'worker-only' ||
    renderHostPort.getTelemetry().mode === 'worker-gpu-only'
  )
    && typeof Worker !== 'undefined'
    && typeof createImageBitmap === 'function';
}

export function resolveRuntimePlaybackBinding(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy = 'interactive'
): RuntimePlaybackBinding | null {
  if (!hasRuntimeBinding(source)) {
    return null;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  if (!runtime) {
    return null;
  }

  const session =
    runtime.peekSession(source.runtimeSessionKey) ??
    runtime.getSession(source.runtimeSessionKey, { policy });
  let frameProvider = runtime.getSessionFrameProvider(source.runtimeSessionKey);

  const sourcePlayer = source.webCodecsPlayer ?? null;
  if (
    !isInteractiveScrubSessionKey(source.runtimeSessionKey) &&
    shouldReplaceFrameProvider(frameProvider, sourcePlayer ?? undefined)
  ) {
    runtime.setSessionFrameProvider(source.runtimeSessionKey, sourcePlayer);
    frameProvider = sourcePlayer;
  }

  return {
    sourceId: source.runtimeSourceId,
    sessionKey: source.runtimeSessionKey,
    session,
    frameProvider,
  };
}

export function updateRuntimePlaybackTime(
  source: RuntimeBackedSource | null | undefined,
  time: number,
  policy: DecodeSessionPolicy = 'interactive'
): RuntimePlaybackBinding | null {
  const binding = resolveRuntimePlaybackBinding(source, policy);
  if (!binding) {
    return null;
  }
  mediaRuntimeRegistry.updateSessionTime(binding.sourceId, binding.sessionKey, time);
  return binding;
}

export function getRuntimeFrameProvider(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy = 'interactive'
): RuntimeFrameProvider | null {
  return resolveRuntimePlaybackBinding(source, policy)?.frameProvider ?? null;
}

/**
 * Returns whether the source is eligible for the opt-in TurboRes path.
 * Unlike checking the current provider, this also works before the first
 * asynchronous decoder has been created and lets preview sessions bootstrap.
 */
export function isTurboResRuntimeSource(
  source: RuntimeBackedSource | null | undefined
): boolean {
  if (!flags.turboResProRes || !hasRuntimeBinding(source)) {
    return false;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  if (!runtime) {
    return false;
  }

  refreshRuntimeMetadataFromMediaStore(runtime);

  return selectRuntimeFrameProviderPlan({
    videoCodecId: runtime.metadata.videoCodecId,
    turboResEnabled: flags.turboResProRes,
  }).backend === 'turbores';
}

/**
 * Returns whether the source decodes through the HAP provider. HAP has no
 * HTMLVideoElement or WebCodecs fallback, so this is not feature-gated.
 */
export function isHapRuntimeSource(
  source: RuntimeBackedSource | null | undefined
): boolean {
  if (!hasRuntimeBinding(source)) {
    return false;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  if (!runtime) {
    return false;
  }

  refreshRuntimeMetadataFromMediaStore(runtime);

  return selectRuntimeFrameProviderPlan({
    videoCodecId: runtime.metadata.videoCodecId,
    turboResEnabled: flags.turboResProRes,
  }).backend === 'hap';
}

/**
 * Source is served by a session-owned codec provider (TurboRes or HAP)
 * instead of an HTMLVideoElement/WebCodecs player. Lets preview sessions
 * bootstrap before the first asynchronous decoder exists.
 */
export function isProviderBackedRuntimeSource(
  source: RuntimeBackedSource | null | undefined
): boolean {
  return isTurboResRuntimeSource(source) || isHapRuntimeSource(source);
}

export function peekRuntimeFrameProvider(
  source: RuntimeBackedSource | null | undefined
): RuntimeFrameProvider | null {
  if (!hasRuntimeBinding(source)) {
    return source?.webCodecsPlayer ?? null;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  const sessionProvider = runtime?.getSessionFrameProvider(source.runtimeSessionKey) ?? null;
  const sourcePlayer = source.webCodecsPlayer ?? null;

  if (shouldReplaceFrameProvider(sessionProvider, sourcePlayer ?? undefined)) {
    return sourcePlayer;
  }

  return sessionProvider ?? sourcePlayer;
}

export function isRuntimeFullWebCodecsSource(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy = 'interactive'
): boolean {
  return !!getRuntimeFrameProvider(source, policy)?.isFullMode();
}

export function canUseSharedPreviewRuntimeSession(
  clip: Pick<TimelineClip, 'trackId'>,
  activeClips: Iterable<Pick<TimelineClip, 'trackId'>>
): boolean {
  if (!clip.trackId) {
    return false;
  }

  let activeOnTrack = 0;
  for (const activeClip of activeClips) {
    if (activeClip.trackId !== clip.trackId) {
      continue;
    }
    activeOnTrack += 1;
    if (activeOnTrack > 1) {
      return false;
    }
  }

  return activeOnTrack === 1;
}

export function getSharedPreviewRuntimeSessionKey(
  source: RuntimeBackedSource | null | undefined,
  trackId?: string,
  allowSharedSession = true,
  sessionScope?: string
): string | undefined {
  if (!source?.runtimeSourceId || !source.runtimeSessionKey) {
    return source?.runtimeSessionKey;
  }
  if (!allowSharedSession || !trackId) {
    return source.runtimeSessionKey;
  }

  const clipPlayer = source.webCodecsPlayer;
  const runtimeProvider = clipPlayer?.isFullMode()
    ? clipPlayer
    : getRuntimeFrameProvider(source);
  if (!runtimeProvider?.isFullMode() && !isProviderBackedRuntimeSource(source)) {
    return source.runtimeSessionKey;
  }

  if (sessionScope) {
    return `${INTERACTIVE_PLAYBACK_SESSION_PREFIX}${sessionScope}:${trackId}:${source.runtimeSourceId}`;
  }
  return `${INTERACTIVE_PLAYBACK_SESSION_PREFIX}${trackId}:${source.runtimeSourceId}`;
}

export function getScrubRuntimeSessionKey(
  source: RuntimeBackedSource | null | undefined,
  trackId?: string,
  allowSharedSession = true,
  sessionScope?: string
): string | undefined {
  if (!source?.runtimeSourceId || !source.runtimeSessionKey) {
    return source?.runtimeSessionKey;
  }
  if (!allowSharedSession || !trackId) {
    return source.runtimeSessionKey;
  }

  const clipPlayer = source.webCodecsPlayer;
  const runtimeProvider = clipPlayer?.isFullMode()
    ? clipPlayer
    : getRuntimeFrameProvider(source);
  if (!runtimeProvider?.isFullMode() && !isProviderBackedRuntimeSource(source)) {
    return source.runtimeSessionKey;
  }

  if (sessionScope) {
    return `${INTERACTIVE_SCRUB_SESSION_PREFIX}${sessionScope}:${trackId}:${source.runtimeSourceId}`;
  }
  return `${INTERACTIVE_SCRUB_SESSION_PREFIX}${trackId}:${source.runtimeSourceId}`;
}

export function getPreviewRuntimeSource<
  T extends RuntimeBackedSource | null | undefined,
>(
  source: T,
  trackId?: string,
  allowSharedSession = true,
  sessionScope?: string
): T {
  if (!source) {
    return source;
  }

  const sessionKey = getSharedPreviewRuntimeSessionKey(
    source,
    trackId,
    allowSharedSession,
    sessionScope
  );
  if (!sessionKey || sessionKey === source.runtimeSessionKey) {
    return source;
  }

  return {
    ...source,
    runtimeSessionKey: sessionKey,
  } as T;
}

export function getScrubRuntimeSource<
  T extends RuntimeBackedSource | null | undefined,
>(
  source: T,
  trackId?: string,
  allowSharedSession = true,
  sessionScope?: string
): T {
  if (!source) {
    return source;
  }

  const sessionKey = getScrubRuntimeSessionKey(
    source,
    trackId,
    allowSharedSession,
    sessionScope
  );
  if (!sessionKey || sessionKey === source.runtimeSessionKey) {
    return source;
  }

  return {
    ...source,
    runtimeSessionKey: sessionKey,
  } as T;
}

export function getPolicyRuntimeSessionKey(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy,
  ownerId: string,
  sessionScope?: string
): string | undefined {
  if (!source?.runtimeSourceId || !source.runtimeSessionKey) {
    return source?.runtimeSessionKey;
  }
  return buildPolicyRuntimeSessionKey(
    source.runtimeSourceId,
    policy,
    ownerId,
    sessionScope
  );
}

export function getPolicyRuntimeSource<
  T extends RuntimeBackedSource | null | undefined,
>(
  source: T,
  policy: DecodeSessionPolicy,
  ownerId: string,
  sessionScope?: string
): T {
  if (!source) {
    return source;
  }

  const sessionKey = getPolicyRuntimeSessionKey(
    source,
    policy,
    ownerId,
    sessionScope
  );
  if (!sessionKey || sessionKey === source.runtimeSessionKey) {
    return source;
  }

  return {
    ...source,
    runtimeSessionKey: sessionKey,
  } as T;
}

export function setRuntimeFrameProvider(
  source: RuntimeBackedSource | null | undefined,
  provider: RuntimeFrameProvider | null,
  policy: DecodeSessionPolicy = 'interactive',
  options?: {
    ownsProvider?: boolean;
    onDispose?: () => void;
  }
): RuntimePlaybackBinding | null {
  if (!hasRuntimeBinding(source)) {
    return null;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  if (!runtime) {
    return null;
  }

  const session =
    runtime.peekSession(source.runtimeSessionKey) ??
    runtime.getSession(source.runtimeSessionKey, { policy });
  runtime.setSessionFrameProvider(source.runtimeSessionKey, provider, options);

  return {
    sourceId: source.runtimeSourceId,
    sessionKey: source.runtimeSessionKey,
    session,
    frameProvider: provider,
  };
}

export async function ensureRuntimeFrameProvider(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy = 'interactive',
  sourceTime?: number,
  options: EnsureRuntimeFrameProviderOptions = {}
): Promise<RuntimeFrameProvider | null> {
  const hadSession =
    hasRuntimeBinding(source) &&
    !!mediaRuntimeRegistry
      .getRuntime(source.runtimeSourceId)
      ?.peekSession(source.runtimeSessionKey);
  const binding = resolveRuntimePlaybackBinding(source, policy);
  if (!binding) {
    return null;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(binding.sourceId);
  if (!runtime) {
    return null;
  }

  refreshRuntimeMetadataFromMediaStore(runtime);

  if (sourceTime !== undefined) {
    runtime.updateSessionTime(binding.sessionKey, sourceTime);
  }

  const providerPlan = selectRuntimeFrameProviderPlan({
    videoCodecId: runtime.metadata.videoCodecId,
    turboResEnabled: flags.turboResProRes,
  });
  if (providerPlan.backend === 'unsupported') {
    return null;
  }
  const wantsTurboRes = providerPlan.backend === 'turbores';
  const wantsHap = providerPlan.backend === 'hap';
  const wantsCodecProvider = wantsTurboRes || wantsHap;

  const wantsWorkerWebCodecs =
    !wantsCodecProvider &&
    options.preferWorkerWebCodecs === true &&
    canUseWorkerWebCodecsFrameProvider();

  if (
    binding.frameProvider
    && (wantsCodecProvider
      ? binding.frameProvider.backend === (wantsTurboRes ? 'turbores' : 'hap')
      : !wantsWorkerWebCodecs)
  ) {
    return binding.frameProvider;
  }

  if (!wantsCodecProvider && binding.frameProvider instanceof WorkerWebCodecsFrameProvider) {
    return binding.frameProvider;
  }

  const canBuildMainThreadWebCodecsProvider = source?.webCodecsPlayer?.isFullMode() === true;
  if (
    !wantsCodecProvider && (
      policy !== 'interactive' ||
      (!isInteractiveScrubSessionKey(binding.sessionKey) && !wantsWorkerWebCodecs) ||
      (!wantsWorkerWebCodecs && !canBuildMainThreadWebCodecsProvider)
    )
  ) {
    return null;
  }

  const file = getRuntimeFile(runtime);
  if (!file) {
    return null;
  }

  const loadKey = getPendingProviderLoadKey(binding.sourceId, binding.sessionKey);
  const pendingLoad = pendingRuntimeProviderLoads.get(loadKey);
  if (pendingLoad) {
    return pendingLoad;
  }

  const reservation = reserveRuntimeProviderResources(
    policy,
    runtime,
    binding.sessionKey,
    file,
    wantsTurboRes ? 'turbores' : wantsHap ? 'hap' : 'webcodecs',
  );
  if (!reservation.admitted) {
    if (!hadSession) {
      mediaRuntimeRegistry.releaseSession(binding.sourceId, binding.sessionKey);
    }
    return null;
  }

  const initialTime = sourceTime ?? binding.session.currentTime;
  const loadPromise = (async () => {
    try {
      if (providerPlan.backend === 'hap') {
        const hapProvider = await createHapFrameProvider({
          sourceId: `${binding.sourceId}:${binding.sessionKey}`,
          file,
          fourCC: providerPlan.fourCC,
          policy,
          onFrame: () => {
            options.onFrame?.();
            renderHostPort.requestNewFrameRender();
          },
          onError: (error) => {
            options.onError?.(error);
            log.warn('HAP provider error', { sourceId: binding.sourceId, message: error.message });
            renderHostPort.requestRender();
          },
        });
        if (!hapProvider) {
          log.warn('HAP provider failed to initialize', {
            sourceId: binding.sourceId,
            sessionKey: binding.sessionKey,
            fourCC: providerPlan.fourCC,
          });
          reservation.release();
          return null;
        }
        log.info('HAP provider ready', { sourceId: binding.sourceId, fourCC: providerPlan.fourCC });
        if (!attachOwnedRuntimeProvider(runtime, binding, hapProvider, reservation)) return null;
        if (Number.isFinite(initialTime) && initialTime !== undefined) {
          hapProvider.seek(initialTime);
        }
        renderHostPort.requestRender();
        return hapProvider;
      }

      if (providerPlan.backend === 'turbores') {
        const turboResProvider = await createTurboResFrameProvider({
          sourceId: `${binding.sourceId}:${binding.sessionKey}`,
          file,
          fourCC: providerPlan.fourCC,
          policy,
          onFrame: () => {
            options.onFrame?.();
            renderHostPort.requestNewFrameRender();
          },
          onError: (error) => {
            options.onError?.(error);
            log.warn('TurboRes provider error', { sourceId: binding.sourceId, message: error.message });
            renderHostPort.requestRender();
          },
        });
        if (!turboResProvider) {
          log.warn('TurboRes provider failed to initialize', {
            sourceId: binding.sourceId,
            sessionKey: binding.sessionKey,
            fourCC: providerPlan.fourCC,
          });
          reservation.release();
          return null;
        }
        log.info('TurboRes provider ready', { sourceId: binding.sourceId, fourCC: providerPlan.fourCC });
        if (!attachOwnedRuntimeProvider(runtime, binding, turboResProvider, reservation)) return null;
        if (Number.isFinite(initialTime) && initialTime !== undefined) {
          turboResProvider.seek(initialTime);
        }
        renderHostPort.requestRender();
        return turboResProvider;
      }

      if (wantsWorkerWebCodecs) {
        const workerProvider = await createWorkerWebCodecsFrameProvider({
          sourceId: `${binding.sourceId}:${binding.sessionKey}`,
          file,
          onFrame: () => {
            renderHostPort.requestNewFrameRender();
          },
          onError: () => {
            renderHostPort.requestRender();
          },
        });

        if (workerProvider) {
          if (!attachOwnedRuntimeProvider(runtime, binding, workerProvider, reservation)) return null;
          if (Number.isFinite(initialTime) && initialTime !== undefined) {
            workerProvider.seek(initialTime);
          }
          renderHostPort.requestRender();
          return workerProvider;
        }
      }

      const player = new WebCodecsPlayer({
        loop: false,
        useSimpleMode: false,
        onFrame: () => {
          renderHostPort.requestNewFrameRender();
        },
        onError: () => {
          renderHostPort.requestRender();
        },
      });

      try {
        await player.loadFile(file);
        if (!attachOwnedRuntimeProvider(runtime, binding, player, reservation)) return null;

        if (Number.isFinite(initialTime) && initialTime !== undefined) {
          player.seek(initialTime);
        }
        renderHostPort.requestRender();
        return player;
      } catch {
        reservation.release();
        player.destroy?.();
        return null;
      }
    } finally {
      pendingRuntimeProviderLoads.delete(loadKey);
    }
  })();

  pendingRuntimeProviderLoads.set(loadKey, loadPromise);
  return loadPromise;
}

export function releaseRuntimePlaybackSession(
  source: RuntimeBackedSource | null | undefined
): void {
  if (!hasRuntimeBinding(source)) {
    return;
  }
  releaseRuntimeProviderResources(source.runtimeSourceId, source.runtimeSessionKey);
  pendingRuntimeProviderLoads.delete(
    getPendingProviderLoadKey(source.runtimeSourceId, source.runtimeSessionKey)
  );
  mediaRuntimeRegistry.releaseSession(
    source.runtimeSourceId,
    source.runtimeSessionKey
  );
}

export function readRuntimeFrameForSource(
  source: RuntimeBackedSource | null | undefined,
  policy: DecodeSessionPolicy = 'interactive'
): {
  binding: RuntimePlaybackBinding;
  frameHandle: FrameHandle | null;
} | null {
  const binding = resolveRuntimePlaybackBinding(source, policy);
  if (!binding) {
    return null;
  }

  const runtime = mediaRuntimeRegistry.getRuntime(binding.sourceId);
  if (!runtime) {
    return null;
  }

  const frameHandle = runtime.getFrameSync({
    sourceId: binding.sourceId,
    sessionKey: binding.sessionKey,
    sourceTime: binding.session.currentTime,
    playbackMode: binding.session.policy,
    allowCache: true,
  });

  return {
    binding,
    frameHandle,
  };
}
