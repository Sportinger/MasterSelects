import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeBudgetPressure,
  TimelineRuntimeBudgetUnit,
  TimelineRuntimePolicyBudget,
  TimelineRuntimePolicyBudgetReport,
  TimelineRuntimePolicyDescriptor,
  TimelineRuntimePolicyUsage,
} from './runtimeCoordinatorTypes';

export function createEmptyPolicyUsage(): TimelineRuntimePolicyUsage {
  return {
    resources: 0,
    sessions: 0,
    frameProviders: 0,
    htmlMediaElements: 0,
    nativeDecoders: 0,
    gpuTextures: 0,
    imageBitmaps: 0,
    audioSources: 0,
    jobs: 0,
    heapBytes: 0,
    gpuBytes: 0,
  };
}

export function addPolicyUsage(
  left: TimelineRuntimePolicyUsage,
  right: TimelineRuntimePolicyUsage
): TimelineRuntimePolicyUsage {
  return {
    resources: left.resources + right.resources,
    sessions: left.sessions + right.sessions,
    frameProviders: left.frameProviders + right.frameProviders,
    htmlMediaElements: left.htmlMediaElements + right.htmlMediaElements,
    nativeDecoders: left.nativeDecoders + right.nativeDecoders,
    gpuTextures: left.gpuTextures + right.gpuTextures,
    imageBitmaps: left.imageBitmaps + right.imageBitmaps,
    audioSources: left.audioSources + right.audioSources,
    jobs: left.jobs + right.jobs,
    heapBytes: left.heapBytes + right.heapBytes,
    gpuBytes: left.gpuBytes + right.gpuBytes,
  };
}

export function createUsageForResources(
  resources: readonly RenderResourceDescriptor[]
): TimelineRuntimePolicyUsage {
  const sessionKeys = new Set<string>();
  const usage = createEmptyPolicyUsage();
  usage.resources = resources.length;

  for (const resource of resources) {
    const sessionKey = resource.runtime?.runtimeSessionKey
      ?? resource.diagnostics?.session?.sessionKey;
    if (sessionKey) {
      sessionKeys.add(sessionKey);
    }

    if (resource.kind === 'video-frame-provider') usage.frameProviders += 1;
    if (resource.kind === 'html-media') {
      usage.htmlMediaElements += 1;
      if (resource.mediaElementKind === 'audio') {
        usage.audioSources += 1;
      }
    }
    if (resource.kind === 'native-decoder') usage.nativeDecoders += 1;
    if (resource.kind === 'image-canvas') usage.imageBitmaps += 1;
    if (resource.kind === 'nested-composition-texture') usage.gpuTextures += 1;
    if (resource.kind === 'gpu-texture') usage.gpuTextures += 1;
    if (resource.kind === 'audio-source-clock') usage.audioSources += 1;
    if (resource.kind === 'job') usage.jobs += 1;

    usage.heapBytes += resource.memoryCost?.heapBytes ?? 0;
    usage.gpuBytes += resource.memoryCost?.gpuBytes ?? 0;
  }

  usage.sessions = sessionKeys.size;
  return usage;
}

export function getBudgetLimit(
  budget: TimelineRuntimePolicyBudget,
  unit: TimelineRuntimeBudgetPressure['unit']
): number | undefined {
  switch (unit) {
    case 'resource':
      return budget.maxResources;
    case 'session':
      return budget.maxSessions;
    case 'frame-provider':
      return budget.maxFrameProviders;
    case 'html-media-element':
      return budget.maxHtmlMediaElements;
    case 'native-decoder':
      return budget.maxNativeDecoders;
    case 'gpu-texture':
      return budget.maxGpuTextures;
    case 'image-bitmap':
      return budget.maxImageBitmaps;
    case 'audio-source':
      return budget.maxAudioSources;
    case 'job':
      return budget.maxJobs;
    case 'heap-bytes':
      return budget.maxHeapBytes;
    case 'gpu-bytes':
      return budget.maxGpuBytes;
    default:
      return undefined;
  }
}

function getUsageValue(
  usage: TimelineRuntimePolicyUsage,
  unit: TimelineRuntimeBudgetPressure['unit']
): number {
  switch (unit) {
    case 'resource':
      return usage.resources;
    case 'session':
      return usage.sessions;
    case 'frame-provider':
      return usage.frameProviders;
    case 'html-media-element':
      return usage.htmlMediaElements;
    case 'native-decoder':
      return usage.nativeDecoders;
    case 'gpu-texture':
      return usage.gpuTextures;
    case 'image-bitmap':
      return usage.imageBitmaps;
    case 'audio-source':
      return usage.audioSources;
    case 'job':
      return usage.jobs;
    case 'heap-bytes':
      return usage.heapBytes;
    case 'gpu-bytes':
      return usage.gpuBytes;
    default:
      return 0;
  }
}

function getPressureStatus(ratio: number | undefined): RuntimeHealthStatus {
  if (ratio === undefined) return 'unknown';
  if (ratio >= 1) return 'critical';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

export function createBudgetPressure(
  budget: TimelineRuntimePolicyBudget,
  usage: TimelineRuntimePolicyUsage
): readonly TimelineRuntimeBudgetPressure[] {
  const units = [
    'resource',
    'session',
    'frame-provider',
    'html-media-element',
    'native-decoder',
    'gpu-texture',
    'image-bitmap',
    'audio-source',
    'job',
    'heap-bytes',
    'gpu-bytes',
  ] as const satisfies readonly TimelineRuntimeBudgetUnit[];

  return units.map((unit) => {
    const limit = getBudgetLimit(budget, unit);
    const used = getUsageValue(usage, unit);
    const ratio = limit && limit > 0 ? used / limit : undefined;
    return {
      unit,
      used,
      ...(limit === undefined ? {} : { limit }),
      ...(ratio === undefined ? {} : { ratio }),
      status: getPressureStatus(ratio),
    };
  });
}

export function getRejectedBudgetUnits(
  pressure: readonly TimelineRuntimeBudgetPressure[]
): readonly TimelineRuntimeBudgetPressure[] {
  return pressure.filter((entry) => entry.limit !== undefined && entry.used > entry.limit);
}

export function createEmptyBudgetReport(
  descriptor: TimelineRuntimePolicyDescriptor
): TimelineRuntimePolicyBudgetReport {
  const usage = createEmptyPolicyUsage();
  return {
    policyId: descriptor.id,
    budget: descriptor.defaultBudget,
    usage,
    pressure: createBudgetPressure(descriptor.defaultBudget, usage),
    diagnostics: [],
  };
}

export function createBudgetReportForResources(
  descriptor: TimelineRuntimePolicyDescriptor,
  resources: readonly RenderResourceDescriptor[]
): TimelineRuntimePolicyBudgetReport {
  const usage = createUsageForResources(resources);
  return {
    policyId: descriptor.id,
    budget: descriptor.defaultBudget,
    usage,
    pressure: createBudgetPressure(descriptor.defaultBudget, usage),
    diagnostics: resources.flatMap((resource) => resource.diagnostics?.messages ?? []),
  };
}
