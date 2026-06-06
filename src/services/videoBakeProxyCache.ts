import type { Layer, VideoBakeRegion } from '../types';
import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from './timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from './timeline/timelineRuntimeCoordinator';
import { Logger } from './logger';

const log = Logger.create('VideoBakeProxyCache');
const FRAME_SYNC_TOLERANCE_SECONDS = 1 / 30;
const PLAYBACK_DRIFT_TOLERANCE_SECONDS = 0.12;

export interface VideoBakeProxyArtifactInput {
  region: VideoBakeRegion;
  compositionId: string;
  blob: Blob;
  width: number;
  height: number;
  fps: number;
}

interface VideoBakeProxyArtifact {
  regionId: string;
  compositionId: string;
  startTime: number;
  endTime: number;
  url: string;
  video: HTMLVideoElement;
  width: number;
  height: number;
  fps: number;
  pendingSeekTime: number | null;
  runtimeResourceId: string;
}

function getArtifactOwnerId(compositionId: string, regionId: string): string {
  return `video-bake-proxy:${compositionId}:${regionId}`;
}

function createVideoBakeProxyResource(input: VideoBakeProxyArtifactInput): RenderResourceDescriptor {
  const ownerId = getArtifactOwnerId(input.compositionId, input.region.id);
  const duration = Math.max(0, input.region.endTime - input.region.startTime);
  return {
    id: `${ownerId}:html-media:video`,
    kind: 'html-media',
    policyId: 'composition-render',
    owner: {
      ownerId,
      ownerType: 'composition',
      compositionId: input.compositionId,
    },
    source: {
      sourceId: input.region.id,
      compositionId: input.compositionId,
    },
    mediaElementKind: 'video',
    elementId: `${ownerId}:video`,
    srcKind: 'blob-url',
    dimensions: {
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationSeconds: duration,
    },
    diagnostics: {
      status: 'unknown',
      provider: {
        providerId: `${ownerId}:video`,
        providerKind: 'html-video',
        status: 'unknown',
      },
    },
    label: 'Video bake proxy element',
    tags: ['composition-render', 'video-bake-proxy'],
  };
}

function createVideoBakeProxyAdmissionError(
  input: VideoBakeProxyArtifactInput,
  decision: TimelineRuntimeAdmissionDecision,
): Error {
  const rejected = decision.rejectedUnits
    .map((unit) => `${unit.unit} ${unit.used}/${unit.limit ?? 'unlimited'}`)
    .join(', ');
  const suffix = rejected ? ` (${rejected})` : '';
  const error = new Error(
    `Video bake proxy refused runtime video for region "${input.region.id}": ${decision.reason ?? 'not admitted'}${suffix}`
  );
  error.name = 'VideoBakeProxyAdmissionError';
  return error;
}

class VideoBakeProxyCache {
  private artifacts = new Map<string, VideoBakeProxyArtifact>();

  async registerCompositionArtifact(input: VideoBakeProxyArtifactInput): Promise<void> {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new Error('Video bake proxies require a browser document.');
    }

    this.remove(input.region.id);

    const resource = createVideoBakeProxyResource(input);
    const admission = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!admission.admitted) {
      throw createVideoBakeProxyAdmissionError(input, admission);
    }
    timelineRuntimeCoordinator.retainResource(resource);

    let url: string | null = null;

    try {
      url = URL.createObjectURL(input.blob);
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.loop = false;
      video.controls = false;
      video.style.display = 'none';

      const artifact: VideoBakeProxyArtifact = {
        regionId: input.region.id,
        compositionId: input.compositionId,
        startTime: input.region.startTime,
        endTime: input.region.endTime,
        url,
        video,
        width: input.width,
        height: input.height,
        fps: input.fps,
        pendingSeekTime: null,
        runtimeResourceId: resource.id,
      };

      video.addEventListener('seeked', () => {
        artifact.pendingSeekTime = null;
        this.requestRender();
      });

      video.addEventListener('error', () => {
        log.warn('Video bake proxy element failed', {
          regionId: artifact.regionId,
          error: video.error?.message,
        });
      });

      await this.waitForReady(video);
      this.artifacts.set(input.region.id, artifact);
    } catch (error) {
      timelineRuntimeCoordinator.releaseResource(resource.id);
      if (url) {
        URL.revokeObjectURL(url);
      }
      throw error;
    }
  }

  remove(regionId: string): void {
    const artifact = this.artifacts.get(regionId);
    if (!artifact) return;

    artifact.video.pause();
    artifact.video.removeAttribute('src');
    artifact.video.load();
    URL.revokeObjectURL(artifact.url);
    timelineRuntimeCoordinator.releaseResource(artifact.runtimeResourceId);
    this.artifacts.delete(regionId);
  }

  clear(): void {
    for (const regionId of this.artifacts.keys()) {
      this.remove(regionId);
    }
  }

  has(regionId: string): boolean {
    return this.artifacts.has(regionId);
  }

  buildCompositionLayer(
    region: VideoBakeRegion,
    compositionId: string,
    time: number,
    isPlaying: boolean,
    playbackSpeed: number,
  ): Layer | null {
    const artifact = this.artifacts.get(region.id);
    if (!artifact || artifact.compositionId !== compositionId) return null;
    if (time < artifact.startTime || time >= artifact.endTime) {
      this.pauseArtifact(artifact);
      return null;
    }

    this.syncArtifact(artifact, time, isPlaying, playbackSpeed);

    if (artifact.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    return {
      id: `video-bake-proxy:${region.id}`,
      name: 'Video Bake Proxy',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      source: {
        type: 'video',
        videoElement: artifact.video,
      },
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
  }

  private syncArtifact(
    artifact: VideoBakeProxyArtifact,
    time: number,
    isPlaying: boolean,
    playbackSpeed: number,
  ): void {
    const duration = Math.max(0, artifact.endTime - artifact.startTime);
    const targetTime = Math.max(0, Math.min(duration, time - artifact.startTime));
    const video = artifact.video;
    const playbackRate = Number.isFinite(playbackSpeed) && playbackSpeed > 0
      ? playbackSpeed
      : 1;

    if (Math.abs(video.playbackRate - playbackRate) > 0.001) {
      video.playbackRate = playbackRate;
    }

    const drift = Math.abs(video.currentTime - targetTime);
    if (isPlaying) {
      if (drift > PLAYBACK_DRIFT_TOLERANCE_SECONDS) {
        this.seekArtifact(artifact, targetTime);
      }
      if (video.paused) {
        void video.play().catch((error) => {
          log.debug('Video bake proxy play was blocked', error);
        });
      }
      return;
    }

    this.pauseArtifact(artifact);
    if (drift > FRAME_SYNC_TOLERANCE_SECONDS) {
      this.seekArtifact(artifact, targetTime);
    }
  }

  private seekArtifact(artifact: VideoBakeProxyArtifact, targetTime: number): void {
    const pending = artifact.pendingSeekTime;
    if (pending !== null && Math.abs(pending - targetTime) <= FRAME_SYNC_TOLERANCE_SECONDS) {
      return;
    }

    artifact.pendingSeekTime = targetTime;
    try {
      artifact.video.currentTime = targetTime;
    } catch (error) {
      artifact.pendingSeekTime = null;
      log.warn('Could not seek video bake proxy', error);
    }
  }

  private pauseArtifact(artifact: VideoBakeProxyArtifact): void {
    if (!artifact.video.paused) {
      artifact.video.pause();
    }
  }

  private waitForReady(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(video.error?.message || 'Video bake proxy failed to load.'));
      };

      video.addEventListener('loadeddata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
      video.load();
    });
  }

  private requestRender(): void {
    void import('../engine/WebGPUEngine')
      .then(({ engine }) => engine.requestRender())
      .catch(() => undefined);
  }
}

export const videoBakeProxyCache = new VideoBakeProxyCache();
