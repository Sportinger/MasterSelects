export const TIMELINE_RUNTIME_POLICY_IDS = [
  'interactive',
  'background',
  'slot-deck',
  'composition-render',
  'thumbnail',
  'render-target',
  'ram-preview',
  'export',
] as const;

export type TimelineRuntimePolicyId = (typeof TIMELINE_RUNTIME_POLICY_IDS)[number];

export type TimelineRuntimePolicyMode = 'interactive' | 'background' | 'offline';

export type TimelineRuntimeBudgetUnit =
  | 'resource'
  | 'session'
  | 'frame-provider'
  | 'html-media-element'
  | 'native-decoder'
  | 'gpu-texture'
  | 'image-bitmap'
  | 'audio-source'
  | 'job'
  | 'heap-bytes'
  | 'gpu-bytes';

export interface TimelineRuntimePolicyBudget {
  maxResources?: number;
  maxSessions?: number;
  maxFrameProviders?: number;
  maxHtmlMediaElements?: number;
  maxNativeDecoders?: number;
  maxGpuTextures?: number;
  maxImageBitmaps?: number;
  maxAudioSources?: number;
  maxJobs?: number;
  maxHeapBytes?: number;
  maxGpuBytes?: number;
  warmWindowSeconds?: number;
}

export type RuntimeHealthStatus =
  | 'ok'
  | 'warning'
  | 'critical'
  | 'unknown'
  | 'lost'
  | 'disposed';

export type RuntimeSeverity = 'info' | 'warning' | 'error';

export interface RuntimeDiagnosticMessage {
  severity: RuntimeSeverity;
  code: string;
  message: string;
  atMs?: number;
  ownerId?: string;
  resourceId?: string;
  policyId?: TimelineRuntimePolicyId;
}

export interface RuntimeResourceMemoryCost {
  heapBytes?: number;
  gpuBytes?: number;
  decodedFrameBytes?: number;
  encodedBytes?: number;
}

export interface RuntimeResourceOwnerDescriptor {
  ownerId: string;
  ownerType:
    | 'clip'
    | 'track'
    | 'composition'
    | 'timeline'
    | 'slot'
    | 'thumbnail'
    | 'render-target'
    | 'export'
    | 'ram-preview'
    | 'tool'
    | 'unknown';
  clipId?: string;
  trackId?: string;
  compositionId?: string;
  mediaFileId?: string;
}

export interface RenderRuntimeBindingDescriptor {
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  runtimeId?: string;
  sessionKey?: string;
}

export interface RenderResourceSourceDescriptor {
  sourceId?: string;
  mediaFileId?: string;
  clipId?: string;
  trackId?: string;
  compositionId?: string;
  fileHash?: string;
  projectPath?: string;
  previewPath?: string;
}

export interface RenderResourceDimensions {
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channelCount?: number;
}

export type RuntimeProviderKind =
  | 'webcodecs'
  | 'html-video'
  | 'html-audio'
  | 'native-decoder'
  | 'image'
  | 'canvas'
  | 'gpu-texture'
  | 'audio-context'
  | 'composition-renderer'
  | 'ram-preview'
  | 'export'
  | 'unknown';

export interface RuntimeProviderHealthDiagnostics {
  providerId: string;
  providerKind: RuntimeProviderKind;
  status: RuntimeHealthStatus;
  isReady?: boolean;
  isPlaying?: boolean;
  isSeeking?: boolean;
  isDecodePending?: boolean;
  isDisposed?: boolean;
  currentTimeSeconds?: number;
  targetTimeSeconds?: number;
  pendingSeekTimeSeconds?: number | null;
  lastFrameTimeSeconds?: number;
  lastFrameAtMs?: number;
  decodeQueueDepth?: number;
  bufferedFrameCount?: number;
  droppedFrameCount?: number;
  averageDecodeLatencyMs?: number;
  maxDecodeLatencyMs?: number;
  driftMs?: number;
  readyState?: number;
  networkState?: number;
  gpuDeviceLost?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface RuntimeAudioClockDiagnostics {
  clockId: string;
  status: RuntimeHealthStatus;
  currentTimeSeconds?: number;
  targetTimeSeconds?: number;
  driftMs?: number;
  isMuted?: boolean;
  isSuspended?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface RuntimeSessionHealthDiagnostics {
  sourceId?: string;
  sessionKey?: string;
  policyId: TimelineRuntimePolicyId;
  status: RuntimeHealthStatus;
  ownerCount?: number;
  currentTimeSeconds?: number;
  targetTimeSeconds?: number;
  createdAtMs?: number;
  lastAccessedAtMs?: number;
  retainedBy?: readonly RuntimeResourceOwnerDescriptor[];
  provider?: RuntimeProviderHealthDiagnostics;
  audioClock?: RuntimeAudioClockDiagnostics;
  messages?: readonly RuntimeDiagnosticMessage[];
}

export interface RuntimeResourceDiagnostics {
  status: RuntimeHealthStatus;
  provider?: RuntimeProviderHealthDiagnostics;
  session?: RuntimeSessionHealthDiagnostics;
  audioClock?: RuntimeAudioClockDiagnostics;
  messages?: readonly RuntimeDiagnosticMessage[];
}

export type RenderResourceKind =
  | 'video-frame-provider'
  | 'html-media'
  | 'image-canvas'
  | 'native-decoder'
  | 'nested-composition-texture'
  | 'gpu-texture'
  | 'model'
  | 'gaussian-splat'
  | 'motion-data'
  | 'audio-source-clock'
  | 'runtime-binding'
  | 'job';

interface RenderResourceDescriptorBase {
  id: string;
  kind: RenderResourceKind;
  policyId: TimelineRuntimePolicyId;
  owner: RuntimeResourceOwnerDescriptor;
  source?: RenderResourceSourceDescriptor;
  runtime?: RenderRuntimeBindingDescriptor;
  dimensions?: RenderResourceDimensions;
  memoryCost?: RuntimeResourceMemoryCost;
  diagnostics?: RuntimeResourceDiagnostics;
  label?: string;
  tags?: readonly string[];
}

export interface VideoFrameProviderResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'video-frame-provider';
  providerId: string;
  providerKind: 'webcodecs' | 'runtime-frame-provider';
  canSeek?: boolean;
  canProvideStaleFrame?: boolean;
  frameFormat?: 'video-frame' | 'image-bitmap' | 'canvas-image-source' | 'unknown';
}

export interface HtmlMediaResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'html-media';
  mediaElementKind: 'video' | 'audio';
  elementId: string;
  srcKind?: 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown';
}

export interface ImageCanvasResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'image-canvas';
  imageKind: 'html-image' | 'image-bitmap' | 'html-canvas' | 'offscreen-canvas' | 'text-canvas';
  imageId: string;
}

export interface NativeDecoderResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'native-decoder';
  decoderId: string;
  codec?: string;
  container?: string;
}

export interface NestedCompositionTextureResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'nested-composition-texture';
  compositionId: string;
  textureId: string;
  depth: number;
  layerCount?: number;
}

export interface GpuTextureResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'gpu-texture';
  textureId: string;
  textureKind:
    | 'render-target'
    | 'ram-preview-frame'
    | 'export-frame'
    | 'intermediate'
    | 'readback'
    | 'unknown';
  format?: string;
  sampleCount?: number;
  mipLevelCount?: number;
}

export interface ModelResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'model';
  modelId: string;
  modelKind: 'obj' | 'fbx' | 'gltf' | 'glb' | 'primitive' | 'unknown';
  sequenceFrameCount?: number;
}

export interface GaussianSplatResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'gaussian-splat';
  splatId: string;
  splatCount?: number;
  sequenceFrameCount?: number;
}

export interface MotionDataResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'motion-data';
  payloadId: string;
  payloadKind:
    | 'motion-layer'
    | 'math-scene'
    | 'vector-animation'
    | 'midi'
    | 'node-graph'
    | 'data-signal'
    | 'unknown';
}

export interface AudioSourceClockResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'audio-source-clock';
  audioSourceId: string;
  clockId?: string;
  hasAudioWorklet?: boolean;
}

export interface RuntimeBindingResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'runtime-binding';
  runtime: Required<Pick<RenderRuntimeBindingDescriptor, 'runtimeSourceId' | 'runtimeSessionKey'>>;
}

export interface RuntimeJobResourceDescriptor extends RenderResourceDescriptorBase {
  kind: 'job';
  jobId: string;
  jobKind:
    | 'thumbnail-db-load'
    | 'thumbnail-generation'
    | 'thumbnail-bitmap-decode'
    | 'cache-warmup'
    | 'render-target-refresh'
    | 'ram-preview-render'
    | 'export-render'
    | 'unknown';
  queuedAtMs?: number;
  startedAtMs?: number;
}

export type RenderResourceDescriptor =
  | VideoFrameProviderResourceDescriptor
  | HtmlMediaResourceDescriptor
  | ImageCanvasResourceDescriptor
  | NativeDecoderResourceDescriptor
  | NestedCompositionTextureResourceDescriptor
  | GpuTextureResourceDescriptor
  | ModelResourceDescriptor
  | GaussianSplatResourceDescriptor
  | MotionDataResourceDescriptor
  | AudioSourceClockResourceDescriptor
  | RuntimeBindingResourceDescriptor
  | RuntimeJobResourceDescriptor;

export interface TimelineRuntimePolicyDescriptor {
  id: TimelineRuntimePolicyId;
  label: string;
  mode: TimelineRuntimePolicyMode;
  description: string;
  priority: number;
  interactive: boolean;
  ownsPlaybackClock: boolean;
  allowedResourceKinds: readonly RenderResourceKind[];
  defaultBudget: TimelineRuntimePolicyBudget;
}

export interface TimelineRuntimePolicyUsage {
  resources: number;
  sessions: number;
  frameProviders: number;
  htmlMediaElements: number;
  nativeDecoders: number;
  gpuTextures: number;
  imageBitmaps: number;
  audioSources: number;
  jobs: number;
  heapBytes: number;
  gpuBytes: number;
}

export interface TimelineRuntimeBudgetPressure {
  unit: TimelineRuntimeBudgetUnit;
  used: number;
  limit?: number;
  ratio?: number;
  status: RuntimeHealthStatus;
}

export interface TimelineRuntimePolicyBudgetReport {
  policyId: TimelineRuntimePolicyId;
  budget: TimelineRuntimePolicyBudget;
  usage: TimelineRuntimePolicyUsage;
  pressure: readonly TimelineRuntimeBudgetPressure[];
  diagnostics: readonly RuntimeDiagnosticMessage[];
}

export interface TimelineRuntimePolicyBridgeStats {
  descriptor: TimelineRuntimePolicyDescriptor;
  budgetReport: TimelineRuntimePolicyBudgetReport;
  resources: readonly RenderResourceDescriptor[];
  sessions: readonly RuntimeSessionHealthDiagnostics[];
}

export interface TimelineRuntimeAdmissionDecision {
  admitted: boolean;
  resourceId: string;
  policyId?: TimelineRuntimePolicyId;
  reason?: string;
  projectedUsage: TimelineRuntimePolicyUsage;
  pressure: readonly TimelineRuntimeBudgetPressure[];
  rejectedUnits: readonly TimelineRuntimeBudgetPressure[];
}

export interface TimelineRuntimeCoordinatorBridgeStats {
  schemaVersion: 1;
  generatedAtMs: number;
  policyOrder: readonly TimelineRuntimePolicyId[];
  policies: Record<TimelineRuntimePolicyId, TimelineRuntimePolicyBridgeStats>;
  totals: TimelineRuntimePolicyUsage;
  diagnostics: {
    providers: readonly RuntimeProviderHealthDiagnostics[];
    sessions: readonly RuntimeSessionHealthDiagnostics[];
    resources: readonly RenderResourceDescriptor[];
    messages: readonly RuntimeDiagnosticMessage[];
  };
}

export interface TimelineRuntimeCoordinator {
  listPolicies(): readonly TimelineRuntimePolicyDescriptor[];
  getPolicy(policyId: TimelineRuntimePolicyId): TimelineRuntimePolicyDescriptor | null;
  canRetainResource(resource: RenderResourceDescriptor): TimelineRuntimeAdmissionDecision;
  retainResource(resource: RenderResourceDescriptor): void;
  releaseResource(resourceId: string): void;
  clearResources(scope?: {
    ownerId?: string;
    policyId?: TimelineRuntimePolicyId;
  }): void;
  getBudgetReport(policyId?: TimelineRuntimePolicyId): readonly TimelineRuntimePolicyBudgetReport[];
  getBridgeStats(): TimelineRuntimeCoordinatorBridgeStats;
}
