export type CaptionTextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export type CaptionHighlightMode = 'active-word' | 'spoken-words' | 'caption-group';

export type CaptionHighlightStyle = 'text' | 'background' | 'underline';

export interface CaptionHighlightProperties {
  enabled: boolean;
  mode: CaptionHighlightMode;
  style: CaptionHighlightStyle;
  scaleEnabled: boolean;
  scale: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  underlineColor: string;
  underlineWidth: number;
}

export interface CaptionBackgroundProperties {
  enabled: boolean;
  color: string;
  opacity: number;
  paddingX: number;
  paddingY: number;
  borderRadius: number;
}

export type CaptionLayerBindingRole = 'input' | 'text' | 'background';

/**
 * Durable binding carried by ordinary clips inside a caption design
 * composition. The clips remain regular Text/Motion clips; the binding only
 * supplies their live caption data while the parent caption clip is rendered.
 */
export interface CaptionLayerBinding {
  schemaVersion: 1;
  role: CaptionLayerBindingRole;
  inputClipId: string;
  textClipId?: string;
  paddingX?: number;
  paddingY?: number;
}

/** Legacy ownership metadata retained only to migrate older caption design comps. */
export interface CaptionCompositionLink {
  kind: 'caption-comp';
  schemaVersion: 1;
  templateVersion: 1;
  parentCompositionId: string;
  parentCaptionClipId: string;
  inputClipId: string;
  textClipId: string;
  backgroundClipId: string;
  previewText: string;
}

/**
 * Durable settings for a transcript-driven caption clip.
 *
 * A caption is an ordinary Text clip. These properties only bind transcript
 * timing, grouping, background, and word highlighting onto that Text clip;
 * typography and bounds continue to use TextClipProperties.
 */
export interface CaptionClipProperties {
  schemaVersion: 1;

  /** null means: use the top-most transcript-bearing clip active at this frame. */
  sourceClipId: string | null;

  wordsPerCaption: number;
  gapThreshold: number;
  holdAfter: number;
  maxLines: number;

  positionX: number;
  positionY: number;
  maxWidth: number;
  textAlign: 'left' | 'center' | 'right';

  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textTransform: CaptionTextTransform;
  lineHeight: number;
  letterSpacing: number;
  color: string;

  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;

  background: CaptionBackgroundProperties;
  highlight: CaptionHighlightProperties;
}
