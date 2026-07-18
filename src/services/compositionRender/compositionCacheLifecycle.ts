import type { Composition } from '../../stores/mediaStore/types';
import { Logger } from '../logger';
import { disposeCompositionSources } from './sourceLifecycle';
import type { CompositionSources } from './sourceTypes';

const log = Logger.create('CompositionRenderer');

export function disposeCompositionCache(
  compositionSources: Map<string, CompositionSources>,
  compositionId: string,
): void {
  const sources = compositionSources.get(compositionId);
  if (!sources) return;

  disposeCompositionSources(sources, {
    deleteFromCache: true,
    cache: compositionSources,
  });
  log.debug(`Disposed composition: ${compositionId}`);
}

export function getPreparedCompositionIds(
  compositionSources: Map<string, CompositionSources>,
): string[] {
  return Array.from(compositionSources.keys()).filter(id =>
    compositionSources.get(id)?.isReady
  );
}

export function cleanupExpiredCompositionCaches(
  compositionSources: Map<string, CompositionSources>,
  maxAgeMs: number,
): void {
  const now = Date.now();
  for (const [id, sources] of compositionSources.entries()) {
    if (now - sources.lastAccessTime > maxAgeMs) {
      disposeCompositionCache(compositionSources, id);
    }
  }
}

export function invalidateCompositionCache(
  compositionSources: Map<string, CompositionSources>,
  compositionId: string,
): void {
  const sources = compositionSources.get(compositionId);
  if (!sources) return;

  log.debug(`Invalidating composition: ${compositionId}`);
  disposeCompositionSources(sources);
}

export function invalidateAllCompositionCachesExceptActive(
  compositionSources: Map<string, CompositionSources>,
  activeCompositionId: string | null,
): void {
  for (const [id, sources] of compositionSources.entries()) {
    if (id !== activeCompositionId) {
      disposeCompositionSources(sources);
    }
  }
  log.debug('Invalidated all non-active compositions');
}

export function invalidateCompositionCacheAndParents(
  compositionSources: Map<string, CompositionSources>,
  compositionId: string,
  compositions: readonly Composition[],
): void {
  invalidateCompositionCache(compositionSources, compositionId);

  for (const composition of compositions) {
    if (composition.id === compositionId) continue;

    const clips = composition.timelineData?.clips || [];
    const hasNested = clips.some(clip =>
      (clip.isComposition && clip.compositionId === compositionId) ||
      clip.transitionOut?.compositionId === compositionId ||
      clip.transitionIn?.compositionId === compositionId
    );

    if (hasNested) {
      log.debug(`Invalidating parent composition: ${composition.name} (contains ${compositionId})`);
      invalidateCompositionCache(compositionSources, composition.id);
      invalidateCompositionCacheAndParents(compositionSources, composition.id, compositions);
    }
  }
}

export function invalidateAllCompositionCaches(
  compositionSources: Map<string, CompositionSources>,
): void {
  for (const sources of compositionSources.values()) {
    disposeCompositionSources(sources);
  }
  log.debug('Invalidated ALL compositions');
}
