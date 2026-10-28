import { useMediaStore } from '../../../../stores/mediaStore';
import type { MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineClip } from '../../../../types/timeline';

export interface TransformMediaSizes {
  /** Pixel size of the active composition (1920 x 1080 when there is none). */
  compWidth: number;
  compHeight: number;
  mediaFileId: string | undefined;
  /** Metadata size of the clip's media file, once known. */
  mediaWidth: number | undefined;
  mediaHeight: number | undefined;
  /** Size of the composition a nested-composition clip shows. */
  nestedWidth: number | undefined;
  nestedHeight: number | undefined;
}

// The same lookup as the store's getActiveComposition, on the state the selector receives.
const activeComposition = (state: MediaState) => state.compositions?.find(comp => comp.id === state.activeCompositionId);

/**
 * The composition and source sizes the Transform tab derives pixel positions, fit-to-frame scale and
 * crop ranges from. Every selector returns one number, so the memoised tab re-renders exactly when one
 * of them changes (resolution change, composition switch, media metadata or a proxy arriving, source
 * swap) and not for mirror writes of the composition list or edits of other files.
 */
export function useTransformMediaSizes(clip: TimelineClip | undefined): TransformMediaSizes {
  const mediaFileId = clip?.source?.mediaFileId ?? clip?.mediaFileId;
  const nestedId = clip?.compositionId;
  const compWidth = useMediaStore(state => activeComposition(state)?.width) || 1920;
  const compHeight = useMediaStore(state => activeComposition(state)?.height) || 1080;
  const mediaWidth = useMediaStore(state => (mediaFileId ? state.files?.find(file => file.id === mediaFileId)?.width : undefined));
  const mediaHeight = useMediaStore(state => (mediaFileId ? state.files?.find(file => file.id === mediaFileId)?.height : undefined));
  const nestedWidth = useMediaStore(state => (nestedId ? state.compositions?.find(comp => comp.id === nestedId)?.width : undefined));
  const nestedHeight = useMediaStore(state => (nestedId ? state.compositions?.find(comp => comp.id === nestedId)?.height : undefined));
  return { compWidth, compHeight, mediaFileId, mediaWidth, mediaHeight, nestedWidth, nestedHeight };
}
