import type {
  DecodeSessionPolicy,
  MediaRuntimeLease,
  MediaRuntimeLeaseStatus,
  RuntimeSessionKey,
  RuntimeSourceId,
} from './contracts';

interface ScrubAudioRuntimeHandles {
  createdAt: number;
}

export interface ScrubAudioContextRuntimeHandles extends ScrubAudioRuntimeHandles {
  context: AudioContext;
}

export interface ScrubAudioElementRuntimeHandles extends ScrubAudioRuntimeHandles {
  element: HTMLAudioElement;
}

export interface ScrubAudioBufferRuntimeHandles extends ScrubAudioRuntimeHandles {
  buffer: AudioBuffer;
  mediaFileId?: string;
}

export interface AcquireScrubAudioContextLeaseParams {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy?: DecodeSessionPolicy;
  createContext?: () => AudioContext;
}

export interface AcquireScrubAudioElementLeaseParams {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy?: DecodeSessionPolicy;
  createElement?: () => HTMLAudioElement;
}

export interface TrackScrubAudioBufferLeaseParams {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  buffer: AudioBuffer;
  mediaFileId?: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy?: DecodeSessionPolicy;
}

export interface ScrubAudioLeaseStats {
  liveContexts: number;
  liveElements: number;
  liveBuffers: number;
  contextsCreated: number;
  contextsClosed: number;
  elementsCreated: number;
  elementsReleased: number;
  buffersTracked: number;
  buffersReleased: number;
}

type ScrubAudioContextLease = MediaRuntimeScrubAudioLease<ScrubAudioContextRuntimeHandles>;
type ScrubAudioElementLease = MediaRuntimeScrubAudioLease<ScrubAudioElementRuntimeHandles>;
type ScrubAudioBufferLease = MediaRuntimeScrubAudioLease<ScrubAudioBufferRuntimeHandles>;

function detachScrubAudioElementSource(element: HTMLAudioElement): string {
  const src = element.currentSrc || element.src;
  element.pause();
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // Removing src is enough for teardown; some browsers reject load() during cleanup.
  }
  return src;
}

class MediaRuntimeScrubAudioLease<RuntimeHandles extends ScrubAudioRuntimeHandles>
  implements MediaRuntimeLease<RuntimeHandles> {
  runtimeSourceId: RuntimeSourceId;
  runtimeSessionKey?: RuntimeSessionKey;
  ownerId: string;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus = 'pending';
  acquiredAt = 0;
  releasedAt?: number;

  private handles: RuntimeHandles | null = null;
  private readonly createHandles: () => RuntimeHandles;
  private readonly onAcquire: (lease: MediaRuntimeScrubAudioLease<RuntimeHandles>) => void;
  private readonly onRelease: (
    lease: MediaRuntimeScrubAudioLease<RuntimeHandles>,
    handles: RuntimeHandles
  ) => void;

  constructor(params: {
    runtimeSourceId: RuntimeSourceId;
    runtimeSessionKey?: RuntimeSessionKey;
    ownerId: string;
    policy: DecodeSessionPolicy;
    createHandles: () => RuntimeHandles;
    onAcquire: (lease: MediaRuntimeScrubAudioLease<RuntimeHandles>) => void;
    onRelease: (
      lease: MediaRuntimeScrubAudioLease<RuntimeHandles>,
      handles: RuntimeHandles
    ) => void;
  }) {
    this.runtimeSourceId = params.runtimeSourceId;
    this.runtimeSessionKey = params.runtimeSessionKey;
    this.ownerId = params.ownerId;
    this.policy = params.policy;
    this.createHandles = params.createHandles;
    this.onAcquire = params.onAcquire;
    this.onRelease = params.onRelease;
  }

  acquire(): MediaRuntimeScrubAudioLease<RuntimeHandles> {
    if (this.status === 'active' || this.status === 'released') return this;
    const handles = this.createHandles();
    this.handles = handles;
    this.acquiredAt = handles.createdAt;
    this.status = 'active';
    this.onAcquire(this);
    return this;
  }

  release(reason?: string): void {
    void reason;
    if (this.status === 'released') return;
    const handles = this.handles;
    this.handles = null;
    this.status = 'released';
    this.releasedAt = Date.now();
    if (handles) this.onRelease(this, handles);
  }

  getRuntimeHandles(): RuntimeHandles | null {
    return this.handles;
  }
}

export class MediaRuntimeScrubAudioLeaseOwner {
  private contextLeases = new Map<RuntimeSourceId, ScrubAudioContextLease>();
  private elementLeases = new Map<RuntimeSourceId, ScrubAudioElementLease>();
  private elementLeaseByElement = new WeakMap<HTMLAudioElement, ScrubAudioElementLease>();
  private bufferLeases = new Map<RuntimeSourceId, ScrubAudioBufferLease>();
  private totalContextsCreated = 0;
  private totalContextsClosed = 0;
  private totalElementsCreated = 0;
  private totalElementsReleased = 0;
  private totalBuffersTracked = 0;
  private totalBuffersReleased = 0;

  acquireAudioContext(params: AcquireScrubAudioContextLeaseParams): ScrubAudioContextLease {
    this.releaseAudioContext(params.runtimeSourceId);
    return new MediaRuntimeScrubAudioLease<ScrubAudioContextRuntimeHandles>({
      runtimeSourceId: params.runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId: params.ownerId,
      policy: params.policy ?? 'interactive',
      createHandles: () => ({
        context: (params.createContext ?? (() => new AudioContext()))(),
        createdAt: Date.now(),
      }),
      onAcquire: (lease) => {
        this.contextLeases.set(lease.runtimeSourceId, lease);
        this.totalContextsCreated++;
      },
      onRelease: (lease, handles) => {
        if (handles.context.state !== 'closed') {
          void handles.context.close();
          this.totalContextsClosed++;
        }
        this.detachContextLease(lease);
      },
    }).acquire();
  }

  acquireAudioElement(params: AcquireScrubAudioElementLeaseParams): ScrubAudioElementLease {
    this.releaseAudioElementById(params.runtimeSourceId);
    return new MediaRuntimeScrubAudioLease<ScrubAudioElementRuntimeHandles>({
      runtimeSourceId: params.runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId: params.ownerId,
      policy: params.policy ?? 'interactive',
      createHandles: () => ({
        element: (params.createElement ?? (() => new Audio()))(),
        createdAt: Date.now(),
      }),
      onAcquire: (lease) => {
        const element = lease.getRuntimeHandles()?.element;
        if (element) this.elementLeaseByElement.set(element, lease);
        this.elementLeases.set(lease.runtimeSourceId, lease);
        this.totalElementsCreated++;
      },
      onRelease: (lease, handles) => {
        detachScrubAudioElementSource(handles.element);
        this.detachElementLease(lease, handles.element);
        this.totalElementsReleased++;
      },
    }).acquire();
  }

  trackAudioBuffer(params: TrackScrubAudioBufferLeaseParams): ScrubAudioBufferLease {
    this.releaseAudioBuffer(params.runtimeSourceId);
    return new MediaRuntimeScrubAudioLease<ScrubAudioBufferRuntimeHandles>({
      runtimeSourceId: params.runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId: params.ownerId,
      policy: params.policy ?? 'interactive',
      createHandles: () => ({
        buffer: params.buffer,
        mediaFileId: params.mediaFileId,
        createdAt: Date.now(),
      }),
      onAcquire: (lease) => {
        this.bufferLeases.set(lease.runtimeSourceId, lease);
        this.totalBuffersTracked++;
      },
      onRelease: (lease) => {
        this.detachBufferLease(lease);
        this.totalBuffersReleased++;
      },
    }).acquire();
  }

  releaseAudioContext(runtimeSourceId: RuntimeSourceId, reason?: string): void {
    void reason;
    this.contextLeases.get(runtimeSourceId)?.release();
  }

  releaseAudioElementById(runtimeSourceId: RuntimeSourceId, reason?: string): string {
    void reason;
    const lease = this.elementLeases.get(runtimeSourceId);
    const element = lease?.getRuntimeHandles()?.element;
    const src = element ? element.currentSrc || element.src : '';
    lease?.release();
    return src;
  }

  releaseAudioElement(element: HTMLAudioElement, reason?: string): string {
    void reason;
    const src = element.currentSrc || element.src;
    const lease = this.elementLeaseByElement.get(element);
    if (lease) {
      lease.release();
    } else {
      detachScrubAudioElementSource(element);
    }
    return src;
  }

  releaseAudioBuffer(runtimeSourceId: RuntimeSourceId, reason?: string): void {
    void reason;
    this.bufferLeases.get(runtimeSourceId)?.release();
  }

  getAudioContext(runtimeSourceId: RuntimeSourceId): ScrubAudioContextLease | null {
    return this.contextLeases.get(runtimeSourceId) ?? null;
  }

  getAudioElement(runtimeSourceId: RuntimeSourceId): ScrubAudioElementLease | null {
    return this.elementLeases.get(runtimeSourceId) ?? null;
  }

  getAudioBuffer(runtimeSourceId: RuntimeSourceId): ScrubAudioBufferLease | null {
    return this.bufferLeases.get(runtimeSourceId) ?? null;
  }

  clear(): void {
    for (const lease of Array.from(this.elementLeases.values())) lease.release('clear');
    for (const lease of Array.from(this.contextLeases.values())) lease.release('clear');
    for (const lease of Array.from(this.bufferLeases.values())) lease.release('clear');
  }

  getStats(): ScrubAudioLeaseStats {
    return {
      liveContexts: this.contextLeases.size,
      liveElements: this.elementLeases.size,
      liveBuffers: this.bufferLeases.size,
      contextsCreated: this.totalContextsCreated,
      contextsClosed: this.totalContextsClosed,
      elementsCreated: this.totalElementsCreated,
      elementsReleased: this.totalElementsReleased,
      buffersTracked: this.totalBuffersTracked,
      buffersReleased: this.totalBuffersReleased,
    };
  }

  private detachContextLease(lease: ScrubAudioContextLease): void {
    if (this.contextLeases.get(lease.runtimeSourceId) === lease) {
      this.contextLeases.delete(lease.runtimeSourceId);
    }
  }

  private detachElementLease(lease: ScrubAudioElementLease, element: HTMLAudioElement): void {
    if (this.elementLeases.get(lease.runtimeSourceId) === lease) {
      this.elementLeases.delete(lease.runtimeSourceId);
    }
    this.elementLeaseByElement.delete(element);
  }

  private detachBufferLease(lease: ScrubAudioBufferLease): void {
    if (this.bufferLeases.get(lease.runtimeSourceId) === lease) {
      this.bufferLeases.delete(lease.runtimeSourceId);
    }
  }
}

export function toScrubAudioRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
  return `scrub-audio:${ownerId}:${type}` as RuntimeSourceId;
}

let mediaRuntimeScrubAudioLeaseOwnerInstance = new MediaRuntimeScrubAudioLeaseOwner();

if (import.meta.hot) {
  import.meta.hot.accept();
  const hotData = (import.meta.hot.data ?? {}) as {
    mediaRuntimeScrubAudioLeaseOwner?: MediaRuntimeScrubAudioLeaseOwner;
  };
  if (hotData.mediaRuntimeScrubAudioLeaseOwner) {
    mediaRuntimeScrubAudioLeaseOwnerInstance = hotData.mediaRuntimeScrubAudioLeaseOwner;
  }
  import.meta.hot.dispose((data) => {
    data.mediaRuntimeScrubAudioLeaseOwner = mediaRuntimeScrubAudioLeaseOwnerInstance;
  });
}

export const mediaRuntimeScrubAudioLeaseOwner = mediaRuntimeScrubAudioLeaseOwnerInstance;
