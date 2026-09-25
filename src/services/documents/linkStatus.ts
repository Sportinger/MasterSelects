import type { DocumentLinkTarget } from '../../types/documents';
import type { MediaFile, Composition } from '../../stores/mediaStore/types';
import type { TimelineClip } from '../../types/timeline';

export function documentLinkExists(target: DocumentLinkTarget, state: {
  files: MediaFile[];
  compositions: Composition[];
  activeCompositionId: string | null;
  clips: TimelineClip[];
}): boolean {
  switch (target.kind) {
    case 'source': return state.files.some(file => file.id === target.mediaId);
    case 'source-annotation': return state.files.some(file => file.id === target.mediaId
      && file.sourceAnnotations?.some(item => item.id === target.annotationId));
    case 'composition': return state.compositions.some(comp => comp.id === target.compositionId);
    case 'composition-annotation': return state.compositions.some(comp => comp.id === target.compositionId
      && comp.annotations?.some(item => item.id === target.annotationId));
    case 'clip': return state.activeCompositionId === target.compositionId
      ? state.clips.some(clip => clip.id === target.clipId)
      : state.compositions.some(comp => comp.id === target.compositionId
        && comp.timelineData?.clips.some(clip => clip.id === target.clipId));
  }
}
