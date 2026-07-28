import type { TimelineClip } from '../../../types/timeline';
import { Logger } from '../../../services/logger';
import { restoreCachedClipAnalysis } from '../../../services/faceAnalysis/faceAnalysisPersistence';
import { applySharedClipAnalysisState } from '../../../services/clipAnalysis/sourceAnalysisSharing';

const log = Logger.create('VideoCachedAnalysisLoader');

export function loadCachedProjectAnalysisForVideo(
  clipId: string,
  fileName: string,
  mediaFileId: string | undefined,
  setClips: (updater: (clips: TimelineClip[]) => TimelineClip[]) => void,
): void {
  if (!mediaFileId) return;

  import('../../../services/project/ProjectFileService').then(async ({ projectFileService }) => {
    if (!projectFileService.isProjectOpen()) return;
    try {
      const merged = await projectFileService.getAllAnalysisMerged(mediaFileId);
      if (merged && merged.frames.length > 0) {
        const { analysis, hasFaces } = restoreCachedClipAnalysis(merged);
        setClips(clips => applySharedClipAnalysisState(clips, clipId, (clip) => ({
          ...clip,
          analysis,
          analysisStatus: 'ready' as const,
          faceAnalysisStatus: hasFaces ? 'ready' as const : 'none' as const,
          faceAnalysisMessage: undefined,
        })));
        log.debug('Loaded cached analysis for new clip', { file: fileName, frames: merged.frames.length });
      }
    } catch {
      // No cached project analysis.
    }
  });
}
