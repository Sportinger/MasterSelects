import type {
  DecodeSessionPolicy,
  MediaRuntimeLease,
  MediaRuntimeLeaseStatus,
  RuntimeSessionKey,
  RuntimeSourceId,
} from './contracts';

export interface ObjectUrlRuntimeHandles {
  url: string;
  blob?: Blob;
  createdAt: number;
}

export interface AcquireObjectUrlLeaseParams {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  blob: Blob;
  runtimeSessionKey?: RuntimeSessionKey;
  policy?: DecodeSessionPolicy;
  /** Composition cleanup must leave media-wide caches with their owning service. */
  cleanupScope?: 'timeline-clip';
}

export interface TrackExistingObjectUrlLeaseParams {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  url: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy?: DecodeSessionPolicy;
  createdAt?: number;
  replaceExisting?: boolean;
  cleanupScope?: 'timeline-clip';
}

export interface ObjectUrlLeaseStats {
  liveLeases: number;
  created: number;
  revoked: number;
}

export interface ObjectUrlLeaseSnapshot {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus;
  url: string;
  createdAt: number;
}

interface ObjectUrlLeaseTransferOptions {
  replaceExisting?: boolean;
}

type ObjectUrlLeaseSource =
  | { kind: 'blob'; blob: Blob }
  | { kind: 'existing-url'; url: string; createdAt?: number };

class MediaRuntimeObjectUrlLease implements MediaRuntimeLease<ObjectUrlRuntimeHandles> {
  runtimeSourceId: RuntimeSourceId;
  runtimeSessionKey?: RuntimeSessionKey;
  ownerId: string;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus = 'pending';
  acquiredAt = 0;
  releasedAt?: number;
  readonly cleanupScope?: 'timeline-clip';

  private handles: ObjectUrlRuntimeHandles | null = null;
  private readonly source: ObjectUrlLeaseSource;
  private readonly leaseOwner: MediaRuntimeObjectUrlLeaseOwner;

  constructor(params: {
    runtimeSourceId: RuntimeSourceId;
    runtimeSessionKey?: RuntimeSessionKey;
    ownerId: string;
    policy: DecodeSessionPolicy;
    source: ObjectUrlLeaseSource;
    leaseOwner: MediaRuntimeObjectUrlLeaseOwner;
    cleanupScope?: 'timeline-clip';
  }) {
    this.runtimeSourceId = params.runtimeSourceId;
    this.runtimeSessionKey = params.runtimeSessionKey;
    this.ownerId = params.ownerId;
    this.policy = params.policy;
    this.source = params.source;
    this.leaseOwner = params.leaseOwner;
    this.cleanupScope = params.cleanupScope;
  }

  acquire(): MediaRuntimeObjectUrlLease {
    if (this.status === 'active' || this.status === 'released') {
      return this;
    }

    const createdAt = this.source.kind === 'existing-url'
      ? this.source.createdAt ?? Date.now()
      : Date.now();
    const url = this.source.kind === 'existing-url'
      ? this.source.url
      : URL.createObjectURL(this.source.blob);

    this.handles = {
      url,
      blob: this.source.kind === 'blob' ? this.source.blob : undefined,
      createdAt,
    };
    this.acquiredAt = createdAt;
    this.status = 'active';
    this.leaseOwner.activateLease(this, this.source.kind === 'blob');
    return this;
  }

  release(): void {
    if (this.status === 'released') {
      return;
    }

    const handles = this.handles;
    this.handles = null;
    this.status = 'released';
    this.releasedAt = Date.now();

    if (handles) {
      URL.revokeObjectURL(handles.url);
      this.leaseOwner.recordRevoked();
    }
    this.leaseOwner.detachLease(this);
  }

  getRuntimeHandles(): ObjectUrlRuntimeHandles | null {
    return this.handles;
  }

  moveTo(runtimeSourceId: RuntimeSourceId, ownerId: string): void {
    this.runtimeSourceId = runtimeSourceId;
    this.ownerId = ownerId;
  }
}

export class MediaRuntimeObjectUrlLeaseOwner {
  private leases = new Map<RuntimeSourceId, MediaRuntimeObjectUrlLease>();
  private totalCreated = 0;
  private totalRevoked = 0;

  acquire(params: AcquireObjectUrlLeaseParams): MediaRuntimeLease<ObjectUrlRuntimeHandles> {
    this.release(params.runtimeSourceId);
    return new MediaRuntimeObjectUrlLease({
      runtimeSourceId: params.runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId: params.ownerId,
      policy: params.policy ?? 'interactive',
      source: { kind: 'blob', blob: params.blob },
      leaseOwner: this,
      cleanupScope: params.cleanupScope,
    }).acquire();
  }

  trackExisting(params: TrackExistingObjectUrlLeaseParams): MediaRuntimeLease<ObjectUrlRuntimeHandles> {
    if (params.replaceExisting !== false) {
      this.release(params.runtimeSourceId);
    }

    return new MediaRuntimeObjectUrlLease({
      runtimeSourceId: params.runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId: params.ownerId,
      policy: params.policy ?? 'interactive',
      source: {
        kind: 'existing-url',
        url: params.url,
        createdAt: params.createdAt,
      },
      leaseOwner: this,
      cleanupScope: params.cleanupScope,
    }).acquire();
  }

  release(runtimeSourceId: RuntimeSourceId, reason?: string): void {
    void reason;
    this.leases.get(runtimeSourceId)?.release();
  }

  get(runtimeSourceId: RuntimeSourceId): MediaRuntimeLease<ObjectUrlRuntimeHandles> | null {
    return this.leases.get(runtimeSourceId) ?? null;
  }

  getUrl(runtimeSourceId: RuntimeSourceId): string | undefined {
    return this.leases.get(runtimeSourceId)?.getRuntimeHandles()?.url;
  }

  has(runtimeSourceId: RuntimeSourceId): boolean {
    return this.leases.has(runtimeSourceId);
  }

  transfer(
    fromRuntimeSourceId: RuntimeSourceId,
    toRuntimeSourceId: RuntimeSourceId,
    ownerId: string,
    options?: ObjectUrlLeaseTransferOptions
  ): void {
    const lease = this.leases.get(fromRuntimeSourceId);
    if (!lease) {
      return;
    }

    this.leases.delete(fromRuntimeSourceId);
    const existingLease = this.leases.get(toRuntimeSourceId);
    if (existingLease && existingLease !== lease && options?.replaceExisting !== false) {
      existingLease.release();
    }
    lease.moveTo(toRuntimeSourceId, ownerId);
    this.leases.set(toRuntimeSourceId, lease);
  }

  share(
    fromRuntimeSourceId: RuntimeSourceId,
    toRuntimeSourceId: RuntimeSourceId,
    ownerId: string,
    options?: ObjectUrlLeaseTransferOptions
  ): string | undefined {
    const sourceLease = this.leases.get(fromRuntimeSourceId);
    const handles = sourceLease?.getRuntimeHandles();
    if (!handles) {
      return undefined;
    }

    this.trackExisting({
      runtimeSourceId: toRuntimeSourceId,
      ownerId,
      url: handles.url,
      replaceExisting: options?.replaceExisting,
      cleanupScope: sourceLease?.cleanupScope,
    });
    return handles.url;
  }

  clear(cleanupScope?: 'timeline-clip'): void {
    for (const lease of Array.from(this.leases.values())) {
      if (!cleanupScope || lease.cleanupScope === cleanupScope) lease.release();
    }
  }

  getLiveLeaseCount(): number {
    return this.leases.size;
  }

  getStats(): ObjectUrlLeaseStats {
    return {
      liveLeases: this.getLiveLeaseCount(),
      created: this.totalCreated,
      revoked: this.totalRevoked,
    };
  }

  listLeases(): ObjectUrlLeaseSnapshot[] {
    return Array.from(this.leases.values()).flatMap((lease) => {
      const handles = lease.getRuntimeHandles();
      if (!handles) {
        return [];
      }
      return [{
        runtimeSourceId: lease.runtimeSourceId,
        ownerId: lease.ownerId,
        runtimeSessionKey: lease.runtimeSessionKey,
        policy: lease.policy,
        status: lease.status,
        url: handles.url,
        createdAt: handles.createdAt,
      }];
    });
  }

  activateLease(lease: MediaRuntimeObjectUrlLease, createdObjectUrl: boolean): void {
    this.leases.set(lease.runtimeSourceId, lease);
    if (createdObjectUrl) {
      this.totalCreated++;
    }
  }

  detachLease(lease: MediaRuntimeObjectUrlLease): void {
    if (this.leases.get(lease.runtimeSourceId) === lease) {
      this.leases.delete(lease.runtimeSourceId);
    }
  }

  recordRevoked(): void {
    this.totalRevoked++;
  }
}

export function toObjectUrlRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
  return `object-url:${ownerId}:${type}` as RuntimeSourceId;
}

let mediaRuntimeObjectUrlLeaseOwnerInstance = new MediaRuntimeObjectUrlLeaseOwner();

if (import.meta.hot) {
  import.meta.hot.accept();
  const hotData = (import.meta.hot.data ?? {}) as {
    mediaRuntimeObjectUrlLeaseOwner?: MediaRuntimeObjectUrlLeaseOwner;
  };
  if (hotData.mediaRuntimeObjectUrlLeaseOwner) {
    mediaRuntimeObjectUrlLeaseOwnerInstance = hotData.mediaRuntimeObjectUrlLeaseOwner;
  }
  import.meta.hot.dispose((data) => {
    data.mediaRuntimeObjectUrlLeaseOwner = mediaRuntimeObjectUrlLeaseOwnerInstance;
  });
}

export const mediaRuntimeObjectUrlLeaseOwner = mediaRuntimeObjectUrlLeaseOwnerInstance;
