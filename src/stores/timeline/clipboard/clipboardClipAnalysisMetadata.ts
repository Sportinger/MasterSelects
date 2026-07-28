import type { TimelineClip } from '../../../types/timeline';
import type { ClipboardClipData } from '../types';

type ClipboardClipAnalysisMetadata = Pick<
  ClipboardClipData,
  | 'analysis'
  | 'analysisStatus'
  | 'analysisProgress'
  | 'faceAnalysisStatus'
  | 'faceAnalysisProgress'
  | 'faceAnalysisMessage'
>;

/** Source-time cache metadata can be shared by pasted clip occurrences. */
export function createClipboardClipAnalysisMetadata(
  clip: TimelineClip,
): ClipboardClipAnalysisMetadata {
  return {
    analysis: clip.analysis,
    analysisStatus: clip.analysisStatus,
    analysisProgress: clip.analysisProgress,
    faceAnalysisStatus: clip.faceAnalysisStatus,
    faceAnalysisProgress: clip.faceAnalysisProgress,
    faceAnalysisMessage: clip.faceAnalysisMessage,
  };
}
