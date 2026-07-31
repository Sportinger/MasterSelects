import type {
  CaptionBackgroundProperties,
  CaptionClipProperties,
  CaptionHighlightProperties,
} from '../../../types/caption';

export type CaptionPropertiesPatch =
  Omit<Partial<CaptionClipProperties>, 'background' | 'highlight'> & {
    background?: Partial<CaptionBackgroundProperties>;
    highlight?: Partial<CaptionHighlightProperties>;
  };

export interface CaptionClipActions {
  addCaptionClip: (
    trackId: string,
    startTime: number,
    duration?: number,
    sourceClipId?: string | null,
  ) => Promise<string | null>;
  updateCaptionProperties: (clipId: string, patch: CaptionPropertiesPatch) => void;
  ensureCaptionTextClip: (clipId: string) => Promise<boolean>;
}
