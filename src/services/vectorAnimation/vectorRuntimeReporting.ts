import type { TimelineClip } from '../../types';
import type { VectorAnimationProvider } from '../../types/vectorAnimation';
import type {
  RenderResourceDescriptor,
  RuntimeResourceOwnerDescriptor,
  TimelineRuntimeAdmissionDecision,
  TimelineRuntimePolicyId,
} from '../timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';

export interface VectorRuntimePrepareOptions {
  policyId?: TimelineRuntimePolicyId;
  ownerId?: string;
  ownerType?: RuntimeResourceOwnerDescriptor['ownerType'];
  compositionId?: string;
  resourceId?: string;
  imageId?: string;
  label?: string;
  tags?: readonly string[];
}

export type VectorRuntimeCanvasReservation =
  | {
      admitted: true;
      resourceId: string;
      release: () => void;
    }
  | {
      admitted: false;
      resourceId: string;
      decision: TimelineRuntimeAdmissionDecision;
      release: () => void;
    };

function normalizeDimension(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.round(value!) : 512;
}

function getOwner(
  clip: TimelineClip,
  options: VectorRuntimePrepareOptions,
): RuntimeResourceOwnerDescriptor {
  return {
    ownerId: options.ownerId ?? `vector-runtime:${clip.id}`,
    ownerType: options.ownerType ?? 'clip',
    clipId: clip.id,
    trackId: clip.trackId,
    compositionId: options.compositionId ?? clip.compositionId,
    mediaFileId: clip.source?.mediaFileId ?? clip.mediaFileId,
  };
}

export function createVectorRuntimeCanvasResource(params: {
  clip: TimelineClip;
  provider: VectorAnimationProvider;
  width?: number;
  height?: number;
  options?: VectorRuntimePrepareOptions;
}): RenderResourceDescriptor {
  const options = params.options ?? {};
  const policyId = options.policyId ?? 'interactive';
  const owner = getOwner(params.clip, options);
  const width = normalizeDimension(params.width);
  const height = normalizeDimension(params.height);
  const resourceId = options.resourceId
    ?? `timeline-runtime:${policyId}:${owner.ownerId}:image-canvas:text-canvas`;

  return {
    id: resourceId,
    kind: 'image-canvas',
    policyId,
    owner,
    source: {
      sourceId: params.clip.source?.runtimeSourceId ?? params.clip.source?.mediaFileId ?? params.clip.mediaFileId,
      mediaFileId: params.clip.source?.mediaFileId ?? params.clip.mediaFileId,
      clipId: params.clip.id,
      trackId: params.clip.trackId,
      compositionId: owner.compositionId,
      projectPath: params.clip.source?.filePath,
    },
    runtime: params.clip.source?.runtimeSourceId && params.clip.source.runtimeSessionKey
      ? {
          runtimeSourceId: params.clip.source.runtimeSourceId,
          runtimeSessionKey: params.clip.source.runtimeSessionKey,
        }
      : undefined,
    imageKind: 'html-canvas',
    imageId: options.imageId ?? `${owner.ownerId}:text-canvas`,
    dimensions: {
      width,
      height,
      durationSeconds: params.clip.source?.naturalDuration ?? params.clip.duration,
    },
    memoryCost: {
      heapBytes: width * height * 4,
    },
    diagnostics: {
      status: 'unknown',
      provider: {
        providerId: options.imageId ?? `${owner.ownerId}:text-canvas`,
        providerKind: 'canvas',
        status: 'unknown',
      },
    },
    label: options.label ?? `${params.provider === 'lottie' ? 'Lottie' : 'Rive'} runtime canvas`,
    tags: options.tags ?? ['vector-runtime', params.provider],
  };
}

export function reserveVectorRuntimeCanvasResource(params: {
  clip: TimelineClip;
  provider: VectorAnimationProvider;
  width?: number;
  height?: number;
  options?: VectorRuntimePrepareOptions;
}): VectorRuntimeCanvasReservation {
  const resource = createVectorRuntimeCanvasResource(params);
  const release = () => timelineRuntimeCoordinator.releaseResource(resource.id);
  const decision = timelineRuntimeCoordinator.canRetainResource(resource);
  if (!decision.admitted) {
    return {
      admitted: false,
      resourceId: resource.id,
      decision,
      release: () => undefined,
    };
  }

  timelineRuntimeCoordinator.retainResource(resource);
  return {
    admitted: true,
    resourceId: resource.id,
    release,
  };
}

export function createVectorRuntimeAdmissionError(params: {
  clip: Pick<TimelineClip, 'id' | 'name'>;
  provider: VectorAnimationProvider;
  decision: TimelineRuntimeAdmissionDecision;
}): Error {
  const rejected = params.decision.rejectedUnits
    .map((unit) => `${unit.unit} ${unit.used}/${unit.limit ?? 'unlimited'}`)
    .join(', ');
  const suffix = rejected ? ` (${rejected})` : '';
  const error = new Error(
    `Vector runtime refused ${params.provider} canvas for "${params.clip.name}" (${params.clip.id}): ${params.decision.reason ?? 'not admitted'}${suffix}`
  );
  error.name = 'VectorRuntimeAdmissionError';
  return error;
}
