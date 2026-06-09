export type MediaRuntimeHandleKind =
  | 'file'
  | 'file-system-handle'
  | 'object-url'
  | 'html-media-element'
  | 'video-frame'
  | 'image-bitmap'
  | 'gpu-resource'
  | 'audio-context'
  | 'worker'
  | 'decoder-player'
  | 'service-singleton';

export type MediaRuntimeLeaseOwner = 'services/mediaRuntime';

export type MediaRuntimeLegacyOwner =
  | 'timeline-runtime-coordinator'
  | 'timeline-helper'
  | 'project-runtime-restore-adapter';

export interface MediaRuntimeLeaseOwnerContract {
  handleKind: MediaRuntimeHandleKind;
  owner: MediaRuntimeLeaseOwner;
  owningPath: string;
  gateId: string;
  note: string;
}

export interface MediaRuntimeMigrationSourceContract {
  id: string;
  currentPath: string;
  legacyOwner: MediaRuntimeLegacyOwner;
  targetOwner: MediaRuntimeLeaseOwner;
  handoffGate: string;
  note: string;
}

export const mediaRuntimeLeaseOwnerContracts = [
  {
    handleKind: 'file',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/types.ts#MediaSourceRuntimeDescriptor',
    gateId: 'P1A_MEDIA_FILE_RUNTIME_SIDETABLE',
    note: 'File handles are runtime descriptors only and must not enter project DTOs.',
  },
  {
    handleKind: 'file-system-handle',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/**#restore-adapter-contract',
    gateId: 'P1A_MEDIA_FILE_RUNTIME_SIDETABLE',
    note: 'Restore adapters may borrow handles, but the lease target remains mediaRuntime.',
  },
  {
    handleKind: 'object-url',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/**',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'Object URLs move behind mediaRuntime or explicit restore adapters that borrow leases.',
  },
  {
    handleKind: 'html-media-element',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/runtimePlayback.ts',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'HTML media elements are runtime playback state, not durable clip state.',
  },
  {
    handleKind: 'video-frame',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/registry.ts',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'VideoFrame borrow/clone/close accounting is part of runtime frame handles.',
  },
  {
    handleKind: 'image-bitmap',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/registry.ts',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'ImageBitmap references are runtime frames and must not be persisted.',
  },
  {
    handleKind: 'gpu-resource',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/**#render-runtime-lease-contract',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'GPU resources remain runtime-only and later render packets must borrow by lease id.',
  },
  {
    handleKind: 'audio-context',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/**#audio-runtime-lease-contract',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'AudioContext ownership remains runtime-only and later maps into P6 audio gates.',
  },
  {
    handleKind: 'worker',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/**#worker-runtime-lease-contract',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'Workers are runtime resources and cannot be durable state.',
  },
  {
    handleKind: 'decoder-player',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/runtimePlayback.ts',
    gateId: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'Decoder/player instances are frame providers owned by mediaRuntime sessions.',
  },
  {
    handleKind: 'service-singleton',
    owner: 'services/mediaRuntime',
    owningPath: 'src/services/mediaRuntime/registry.ts',
    gateId: 'P1A_HMR_SAFE_RUNTIME_OWNER',
    note: 'mediaRuntimeRegistry must survive HMR and stay out of persisted stores.',
  },
] as const satisfies readonly MediaRuntimeLeaseOwnerContract[];

export const mediaRuntimeMigrationSourceContracts = [
  {
    id: 'timeline-source-runtime-sanitizer',
    currentPath: 'src/stores/timeline/sourceRuntimeSanitizer.ts',
    legacyOwner: 'timeline-helper',
    targetOwner: 'services/mediaRuntime',
    handoffGate: 'P1A_CLIP_SOURCE_DURABLE_RUNTIME_SPLIT',
    note: 'Current sanitizer documents the runtime fields that must move behind durable refs and leases.',
  },
  {
    id: 'timeline-blob-url-manager',
    currentPath: 'src/stores/timeline/helpers/blobUrlManager.ts',
    legacyOwner: 'timeline-helper',
    targetOwner: 'services/mediaRuntime',
    handoffGate: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'Blob URL ownership should move out of Timeline helpers or behind a mediaRuntime adapter.',
  },
  {
    id: 'timeline-webcodecs-helper',
    currentPath: 'src/stores/timeline/helpers/webCodecsHelpers.ts',
    legacyOwner: 'timeline-helper',
    targetOwner: 'services/mediaRuntime',
    handoffGate: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'WebCodecs provider creation should be canonicalized behind mediaRuntime sessions.',
  },
  {
    id: 'project-media-object-url-manager',
    currentPath: 'src/services/project/mediaObjectUrlManager.ts',
    legacyOwner: 'project-runtime-restore-adapter',
    targetOwner: 'services/mediaRuntime',
    handoffGate: 'P1A_MEDIA_FILE_RUNTIME_SIDETABLE',
    note: 'Project restore object URLs remain adapter-owned only until project schema stops carrying runtime URLs.',
  },
  {
    id: 'timeline-runtime-coordinator',
    currentPath: 'src/services/timeline/timelineRuntimeCoordinator.ts',
    legacyOwner: 'timeline-runtime-coordinator',
    targetOwner: 'services/mediaRuntime',
    handoffGate: 'P1A_SINGLE_RUNTIME_LEASE_DOMAIN',
    note: 'Timeline runtime coordination may borrow leases, but it must not become a second lease manager.',
  },
] as const satisfies readonly MediaRuntimeMigrationSourceContract[];
