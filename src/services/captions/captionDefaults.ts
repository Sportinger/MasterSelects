import type { CaptionClipProperties } from '../../types/caption';
import type { TextClipProperties } from '../../types/text';
import { createTextBoundsFromRect } from '../textLayout';

export const DEFAULT_CAPTION_PROPERTIES: CaptionClipProperties = {
  schemaVersion: 1,
  sourceClipId: null,

  wordsPerCaption: 5,
  gapThreshold: 0.8,
  holdAfter: 0.2,
  maxLines: 2,

  positionX: 50,
  positionY: 84,
  maxWidth: 82,
  textAlign: 'center',

  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 700,
  fontStyle: 'normal',
  textTransform: 'none',
  lineHeight: 1.12,
  letterSpacing: 0,
  color: '#ffffff',

  outlineEnabled: true,
  outlineColor: '#000000',
  outlineWidth: 4,

  background: {
    enabled: false,
    color: '#000000',
    opacity: 0.7,
    paddingX: 26,
    paddingY: 14,
    borderRadius: 16,
  },

  highlight: {
    enabled: true,
    mode: 'active-word',
    style: 'text',
    scaleEnabled: false,
    scale: 1.18,
    textColor: '#ffe45c',
    backgroundColor: '#ffe45c',
    backgroundOpacity: 0.95,
    underlineColor: '#ffe45c',
    underlineWidth: 6,
  },
};

export function cloneDefaultCaptionProperties(): CaptionClipProperties {
  return structuredClone(DEFAULT_CAPTION_PROPERTIES);
}

export function createCaptionTextProperties(input: {
  caption: CaptionClipProperties;
  base: TextClipProperties;
  width: number;
  height: number;
}): TextClipProperties {
  const { caption, base, width, height } = input;
  const boxWidth = width * Math.max(0.1, Math.min(1, caption.maxWidth / 100));
  const lineHeightPx = caption.fontSize * caption.lineHeight;
  const boxHeight = Math.max(
    lineHeightPx * Math.max(1, caption.maxLines) + caption.fontSize * 0.7,
    height * 0.14,
  );
  const box = {
    x: width * (caption.positionX / 100) - boxWidth / 2,
    y: height * (caption.positionY / 100) - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
  };
  return {
    ...base,
    text: 'Caption preview',
    fontFamily: caption.fontFamily,
    fontSize: caption.fontSize,
    fontWeight: caption.fontWeight,
    fontStyle: caption.fontStyle,
    color: caption.color,
    textAlign: caption.textAlign,
    verticalAlign: 'middle',
    lineHeight: caption.lineHeight,
    letterSpacing: caption.letterSpacing,
    boxEnabled: true,
    boxX: box.x,
    boxY: box.y,
    boxWidth: box.width,
    boxHeight: box.height,
    textBounds: createTextBoundsFromRect(box, width, height, undefined, {
      clampToCanvas: false,
    }),
    strokeEnabled: caption.outlineEnabled,
    strokeColor: caption.outlineColor,
    strokeWidth: caption.outlineWidth,
  };
}
