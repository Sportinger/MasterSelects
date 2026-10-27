// Caption style presets of the phone and the reading of a caption clip's current style. A preset is
// a complete, absolute set of caption values in the shape of the editor's updateCaptionProperties
// tool (textStyle, background, highlight, textTransform), so applying it twice gives the same
// result and the desktop Captions tab shows exactly these values.

import type { TimelineClip } from '../../../types/timeline';
import type { CaptionHighlightMode, CaptionHighlightStyle } from '../../../types/caption';

export type PhoneCaptionUpdate = Record<string, unknown>;

export interface PhoneCaptionPreset {
  id: string;
  label: string;
  update: PhoneCaptionUpdate;
}

const HIGHLIGHT_BASE = { scale: 1.18, backgroundOpacity: 0.95, underlineWidth: 6 };

export const PHONE_CAPTION_PRESETS: readonly PhoneCaptionPreset[] = [
  {
    id: 'clean',
    label: 'Clean',
    update: {
      textTransform: 'none',
      textStyle: { fontWeight: 700, color: '#ffffff', strokeEnabled: true, strokeColor: '#000000', strokeWidth: 4, shadowEnabled: false },
      background: { enabled: false },
      highlight: { ...HIGHLIGHT_BASE, enabled: true, mode: 'active-word', style: 'text', scaleEnabled: false, textColor: '#ffe45c' },
    },
  },
  {
    id: 'box',
    label: 'Box',
    update: {
      textTransform: 'none',
      textStyle: { fontWeight: 600, color: '#ffffff', strokeEnabled: false, shadowEnabled: false },
      background: { enabled: true, color: '#000000', opacity: 0.7, paddingX: 26, paddingY: 14, borderRadius: 16 },
      highlight: { ...HIGHLIGHT_BASE, enabled: false, mode: 'active-word', style: 'text', scaleEnabled: false },
    },
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    update: {
      textTransform: 'none',
      textStyle: { fontWeight: 800, color: '#ffffff', strokeEnabled: true, strokeColor: '#000000', strokeWidth: 5, shadowEnabled: false },
      background: { enabled: false },
      highlight: { ...HIGHLIGHT_BASE, enabled: true, mode: 'spoken-words', style: 'text', scaleEnabled: false, textColor: '#5ce1ff' },
    },
  },
  {
    id: 'pop',
    label: 'Pop',
    update: {
      textTransform: 'uppercase',
      textStyle: { fontWeight: 900, color: '#ffffff', strokeEnabled: true, strokeColor: '#000000', strokeWidth: 6, shadowEnabled: false },
      background: { enabled: false },
      highlight: { ...HIGHLIGHT_BASE, enabled: true, mode: 'active-word', style: 'background', scaleEnabled: true, textColor: '#000000', backgroundColor: '#ffe45c' },
    },
  },
  {
    id: 'underline',
    label: 'Underline',
    update: {
      textTransform: 'none',
      textStyle: { fontWeight: 700, color: '#ffffff', strokeEnabled: false, shadowEnabled: true, shadowColor: '#000000', shadowOffsetX: 0, shadowOffsetY: 3, shadowBlur: 8 },
      background: { enabled: false },
      highlight: { ...HIGHLIGHT_BASE, enabled: true, mode: 'active-word', style: 'underline', scaleEnabled: false, underlineColor: '#ff5c8a' },
    },
  },
];

export const PHONE_CAPTION_COLORS: readonly string[] = ['#ffffff', '#ffe45c', '#5ce1ff', '#ff5c8a', '#7dff8a', '#000000'];

export const PHONE_HIGHLIGHT_MODES: readonly { value: CaptionHighlightMode; label: string }[] = [
  { value: 'active-word', label: 'Current word' },
  { value: 'spoken-words', label: 'Spoken words' },
  { value: 'caption-group', label: 'Whole caption' },
];

export const PHONE_HIGHLIGHT_STYLES: readonly { value: CaptionHighlightStyle; label: string }[] = [
  { value: 'text', label: 'Colour' },
  { value: 'background', label: 'Box' },
  { value: 'underline', label: 'Underline' },
];

export interface PhoneCaptionStyleReading {
  fontSize: number;
  color: string;
  uppercase: boolean;
  outline: boolean;
  background: boolean;
  backgroundColor: string;
  highlight: boolean;
  highlightMode: CaptionHighlightMode;
  highlightStyle: CaptionHighlightStyle;
  highlightColor: string;
  positionY: number;
  wordsPerCaption: number;
  gapThreshold: number;
  holdAfter: number;
  maxLines: number;
  sourceClipId: string | null;
}

/** The highlight colour that the current highlight style draws with. */
export function highlightColorKey(style: CaptionHighlightStyle): 'textColor' | 'backgroundColor' | 'underlineColor' {
  return style === 'background' ? 'backgroundColor' : style === 'underline' ? 'underlineColor' : 'textColor';
}

export function readPhoneCaptionStyle(clip: TimelineClip): PhoneCaptionStyleReading | null {
  const caption = clip.captionProperties;
  if (!caption) return null;
  const text = clip.textProperties;
  return {
    fontSize: text?.fontSize ?? caption.fontSize,
    color: text?.color ?? caption.color,
    uppercase: caption.textTransform === 'uppercase',
    outline: text?.strokeEnabled ?? caption.outlineEnabled,
    background: caption.background.enabled,
    backgroundColor: caption.background.color,
    highlight: caption.highlight.enabled,
    highlightMode: caption.highlight.mode,
    highlightStyle: caption.highlight.style,
    highlightColor: caption.highlight[highlightColorKey(caption.highlight.style)],
    positionY: caption.positionY,
    wordsPerCaption: caption.wordsPerCaption,
    gapThreshold: caption.gapThreshold,
    holdAfter: caption.holdAfter,
    maxLines: caption.maxLines,
    sourceClipId: caption.sourceClipId,
  };
}

/** The preset the clip currently matches (every value of the preset equal), or null. */
export function matchPhoneCaptionPreset(clip: TimelineClip): string | null {
  const caption = clip.captionProperties;
  if (!caption) return null;
  const text = (clip.textProperties ?? {}) as unknown as Record<string, unknown>;
  const matches = (preset: PhoneCaptionPreset) => {
    const update = preset.update as { textTransform: string; textStyle: Record<string, unknown>; background: Record<string, unknown>; highlight: Record<string, unknown> };
    if (caption.textTransform !== update.textTransform) return false;
    const background = caption.background as unknown as Record<string, unknown>;
    const highlight = caption.highlight as unknown as Record<string, unknown>;
    return Object.entries(update.textStyle).every(([key, value]) => text[key] === value)
      && Object.entries(update.background).every(([key, value]) => background[key] === value)
      && Object.entries(update.highlight).every(([key, value]) => highlight[key] === value);
  };
  return PHONE_CAPTION_PRESETS.find(matches)?.id ?? null;
}
