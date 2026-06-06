import type { SerializableClip } from '../../types';
import type { VectorAnimationProvider } from '../../types/vectorAnimation';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import type { TimelineClip } from './types';

export type RestoredRuntimePatch = Partial<TimelineClip>;

let restoredVectorRuntimeGeneration = 0;
const pendingRestoredVectorRuntimeGenerations = new Map<string, number>();

function getVectorRuntimeRestoreKey(clipId: string, sourceType: VectorAnimationProvider): string {
  return `${sourceType}:${clipId}`;
}

function createVectorRuntimeRestoreGeneration(clipId: string, sourceType: VectorAnimationProvider): {
  key: string;
  generation: number;
} {
  const key = getVectorRuntimeRestoreKey(clipId, sourceType);
  restoredVectorRuntimeGeneration += 1;
  const generation = restoredVectorRuntimeGeneration;
  pendingRestoredVectorRuntimeGenerations.set(key, generation);
  return { key, generation };
}

function isLatestVectorRuntimeRestore(key: string, generation: number): boolean {
  return pendingRestoredVectorRuntimeGenerations.get(key) === generation;
}

function clearVectorRuntimeRestoreGeneration(key: string, generation: number): void {
  if (isLatestVectorRuntimeRestore(key, generation)) {
    pendingRestoredVectorRuntimeGenerations.delete(key);
  }
}

function isRuntimeRestoreCurrent(isCurrentSession?: () => boolean): boolean {
  return isCurrentSession ? isCurrentSession() : true;
}

function applyRestoredRuntimePatch(
  clip: TimelineClip,
  patch: RestoredRuntimePatch,
  applyPatch?: (patch: RestoredRuntimePatch) => void,
): void {
  Object.assign(clip, patch);
  applyPatch?.(patch);
}

function createPendingVectorAnimationSource(
  serializedClip: SerializableClip,
  sourceType: VectorAnimationProvider,
): TimelineClip['source'] {
  return {
    type: sourceType,
    mediaFileId: serializedClip.mediaFileId,
    naturalDuration: serializedClip.naturalDuration,
    vectorAnimationSettings: serializedClip.vectorAnimationSettings,
  };
}

async function prepareRestoredVectorRuntimeSource(options: {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
  file: File;
  metadataDuration?: number;
}): Promise<NonNullable<TimelineClip['source']>> {
  const runtimeClip: TimelineClip = {
    ...options.clip,
    file: options.file,
    source: createPendingVectorAnimationSource(options.serializedClip, options.sourceType),
  };

  const runtime = await vectorAnimationRuntimeManager.prepareClipSource(runtimeClip, options.file);
  const naturalDuration =
    runtime.metadata.duration ??
    options.metadataDuration ??
    options.serializedClip.naturalDuration ??
    options.serializedClip.duration;

  return {
    type: options.sourceType,
    textCanvas: runtime.canvas,
    mediaFileId: options.serializedClip.mediaFileId,
    naturalDuration,
    vectorAnimationSettings: options.serializedClip.vectorAnimationSettings,
  };
}

export function startRestoredVectorRuntimeRestore(options: {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
  file: File;
  renderTime?: number;
  isCurrentSession?: () => boolean;
  applyPatch?: (patch: RestoredRuntimePatch) => void;
  createReadyPatch?: (source: NonNullable<TimelineClip['source']>) => RestoredRuntimePatch;
  createErrorPatch?: (error: unknown) => RestoredRuntimePatch;
  onReady?: (source: NonNullable<TimelineClip['source']>) => void;
  onStale?: () => void;
  onError?: (error: unknown) => void;
}): void {
  const { key, generation } = createVectorRuntimeRestoreGeneration(
    options.clip.id,
    options.sourceType,
  );

  void prepareRestoredVectorRuntimeSource({
    clip: options.clip,
    serializedClip: options.serializedClip,
    sourceType: options.sourceType,
    file: options.file,
  }).then((source) => {
    if (!isRuntimeRestoreCurrent(options.isCurrentSession)) {
      if (isLatestVectorRuntimeRestore(key, generation)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(options.clip.id, options.sourceType);
        clearVectorRuntimeRestoreGeneration(key, generation);
      }
      options.onStale?.();
      return;
    }

    clearVectorRuntimeRestoreGeneration(key, generation);

    applyRestoredRuntimePatch(
      options.clip,
      options.createReadyPatch?.(source) ?? {
        file: options.file,
        source,
        isLoading: false,
      },
      options.applyPatch,
    );
    vectorAnimationRuntimeManager.renderClipAtTime(options.clip, options.renderTime ?? options.clip.startTime);
    options.onReady?.(source);
  }).catch((error) => {
    if (!isRuntimeRestoreCurrent(options.isCurrentSession)) {
      if (isLatestVectorRuntimeRestore(key, generation)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(options.clip.id, options.sourceType);
        clearVectorRuntimeRestoreGeneration(key, generation);
      }
      options.onStale?.();
      return;
    }

    clearVectorRuntimeRestoreGeneration(key, generation);

    applyRestoredRuntimePatch(
      options.clip,
      options.createErrorPatch?.(error) ?? { isLoading: false },
      options.applyPatch,
    );
    options.onError?.(error);
  });
}
