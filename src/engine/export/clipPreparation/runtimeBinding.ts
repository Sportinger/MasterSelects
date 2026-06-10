import type { TimelineClip } from '../../../stores/timeline/types';
import { bindSourceRuntimeForOwner } from '../../../services/mediaRuntime/clipBindings';
import { releaseReservedExportRuntimeBinding } from '../../../services/timeline/exportRuntimeReporting';
import type { WebCodecsPlayer } from '../../WebCodecsPlayer';
import { createRuntimeBindingPlan, reserveExportRuntimeBindingForClip } from './admission';

export function getExportRuntimeOwnerId(clipId: string): string {
  return `export:${clipId}`;
}

export function createExportRuntimeSource(
  clip: TimelineClip,
  runtimeOwnerId: string,
  overridePlayer?: WebCodecsPlayer | null,
  exportRunId?: string
): TimelineClip['source'] {
  const runtimePlan = createRuntimeBindingPlan(clip, runtimeOwnerId);
  const admissionReport = reserveExportRuntimeBindingForClip(exportRunId, clip, runtimePlan);
  const runtimeSource = bindSourceRuntimeForOwner({
    ownerId: runtimeOwnerId,
    source: clip.source,
    file: clip.file,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    filePath: clip.source?.filePath,
    sessionPolicy: 'export',
    sessionOwnerId: runtimeOwnerId,
  });

  if (!runtimeSource) {
    if (admissionReport) {
      releaseReservedExportRuntimeBinding(admissionReport);
    }
    return clip.source;
  }

  if (!runtimeSource.runtimeSourceId || !runtimeSource.runtimeSessionKey) {
    if (admissionReport) {
      releaseReservedExportRuntimeBinding(admissionReport);
    }
    return clip.source;
  }

  return {
    ...runtimeSource,
    webCodecsPlayer: overridePlayer ?? undefined,
  };
}
