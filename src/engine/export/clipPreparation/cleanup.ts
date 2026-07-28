import { Logger } from '../../../services/logger';
import { mediaRuntimeRegistry } from '../../../services/mediaRuntime/registry';
import { ParallelDecodeManager } from '../../ParallelDecodeManager';
import type { ExportClipState } from '../ClipPreparation';

const log = Logger.create('ClipPreparation');

export function cleanupExportMode(
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null
): void {
  if (parallelDecoder) {
    parallelDecoder.cleanup();
  }

  const releasedRuntimeSessions = new Set<string>();
  const releasedRuntimeOwners = new Set<string>();
  const cleanedPlayers = new Set<NonNullable<ExportClipState['webCodecsPlayer']>>();
  const cleanedPreciseVideos = new Set<HTMLVideoElement>();
  const revokedObjectUrls = new Set<string>();

  for (const state of clipStates.values()) {
    const runtimeSessionId =
      state.runtimeSource?.runtimeSourceId && state.runtimeSource.runtimeSessionKey
        ? `${state.runtimeSource.runtimeSourceId}:${state.runtimeSource.runtimeSessionKey}`
        : null;
    if (runtimeSessionId && !releasedRuntimeSessions.has(runtimeSessionId)) {
      releasedRuntimeSessions.add(runtimeSessionId);
      mediaRuntimeRegistry.releaseSession(
        state.runtimeSource!.runtimeSourceId!,
        state.runtimeSource!.runtimeSessionKey!
      );
    }
    const runtimeOwnerId =
      state.runtimeSource?.runtimeSourceId && state.runtimeOwnerId
        ? `${state.runtimeSource.runtimeSourceId}:${state.runtimeOwnerId}`
        : null;
    if (runtimeOwnerId && !releasedRuntimeOwners.has(runtimeOwnerId)) {
      releasedRuntimeOwners.add(runtimeOwnerId);
      mediaRuntimeRegistry.releaseRuntime(
        state.runtimeSource!.runtimeSourceId!,
        state.runtimeOwnerId!
      );
    }
    if (
      state.webCodecsPlayer &&
      state.isSequential &&
      !cleanedPlayers.has(state.webCodecsPlayer)
    ) {
      cleanedPlayers.add(state.webCodecsPlayer);
      try {
        state.webCodecsPlayer.endSequentialExport();
        state.webCodecsPlayer.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (
      state.hasDedicatedPreciseVideoElement &&
      state.preciseVideoElement &&
      !cleanedPreciseVideos.has(state.preciseVideoElement)
    ) {
      cleanedPreciseVideos.add(state.preciseVideoElement);
      try {
        state.preciseVideoElement.pause();
        state.preciseVideoElement.removeAttribute('src');
        state.preciseVideoElement.load();
      } catch {
        // Ignore cleanup failures for detached export video elements.
      }
    }
    if (state.preciseVideoObjectUrl && !revokedObjectUrls.has(state.preciseVideoObjectUrl)) {
      revokedObjectUrls.add(state.preciseVideoObjectUrl);
      try {
        URL.revokeObjectURL(state.preciseVideoObjectUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
    if (state.hasDedicatedExportImageElement && state.exportImageElement) {
      try {
        state.exportImageElement.onload = null;
        state.exportImageElement.onerror = null;
        state.exportImageElement.removeAttribute('src');
      } catch {
        // Ignore cleanup failures for detached export image elements.
      }
    }
    if (state.exportImageObjectUrl && !revokedObjectUrls.has(state.exportImageObjectUrl)) {
      revokedObjectUrls.add(state.exportImageObjectUrl);
      try {
        URL.revokeObjectURL(state.exportImageObjectUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
  }

  clipStates.clear();
  log.info('Export cleanup complete');
}
