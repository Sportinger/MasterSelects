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

  for (const state of clipStates.values()) {
    if (state.runtimeSource?.runtimeSourceId && state.runtimeSource.runtimeSessionKey) {
      mediaRuntimeRegistry.releaseSession(
        state.runtimeSource.runtimeSourceId,
        state.runtimeSource.runtimeSessionKey
      );
    }
    if (state.runtimeSource?.runtimeSourceId && state.runtimeOwnerId) {
      mediaRuntimeRegistry.releaseRuntime(
        state.runtimeSource.runtimeSourceId,
        state.runtimeOwnerId
      );
    }
    if (state.webCodecsPlayer && state.isSequential) {
      try {
        state.webCodecsPlayer.endSequentialExport();
        state.webCodecsPlayer.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (state.hasDedicatedPreciseVideoElement && state.preciseVideoElement) {
      try {
        state.preciseVideoElement.pause();
        state.preciseVideoElement.removeAttribute('src');
        state.preciseVideoElement.load();
      } catch {
        // Ignore cleanup failures for detached export video elements.
      }
    }
    if (state.preciseVideoObjectUrl) {
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
    if (state.exportImageObjectUrl) {
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
