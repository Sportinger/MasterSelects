import type { CSSProperties } from 'react';
import type { TextClipProperties } from "../../../types/text";
import {
  measureTextWithLetterSpacing,
  wrapTextToShapeLines,
  wrapTextToLines,
} from '../../../services/textLayout';
import type { EditorGeometry, SelectionPolygon, TextSelectionRange } from './textPreviewTypes';
import type { OverlayPoint } from '../editModeOverlayMath';

export function getFontCss(props: TextClipProperties): string {
  const fontStyle = props.fontStyle === 'italic' ? 'italic' : 'normal';
  return `${fontStyle} ${props.fontWeight} ${props.fontSize}px "${props.fontFamily}"`;
}

function selectionLineLeft(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  lineText: string,
  lineLeft: number,
  lineRight: number,
  lineWidth: number,
  props: TextClipProperties,
): number {
  const textWidth = measureTextWithLetterSpacing(ctx, lineText, props.letterSpacing);
  if (props.textAlign === 'center') {
    return lineLeft + lineWidth / 2 - textWidth / 2;
  }
  if (props.textAlign === 'right') {
    return lineRight - textWidth;
  }
  return lineLeft;
}

function pointString(points: OverlayPoint[]): string {
  return points.map(point => `${point.x},${point.y}`).join(' ');
}

export function buildTextEditorStyle(params: {
  geometry: EditorGeometry;
  textProperties: TextClipProperties;
  draftText: string;
  isEditing: boolean;
}): CSSProperties {
  const { geometry, textProperties, draftText, isEditing } = params;
  const fontSize = Math.max(1, textProperties.fontSize * geometry.scaleY);
  const wrapWidth = Math.max(1, geometry.box.width);
  const lineCount = (() => {
    if (typeof document === 'undefined') {
      return Math.max(1, textProperties.text.split('\n').length);
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return Math.max(1, textProperties.text.split('\n').length);
    }
    ctx.font = getFontCss(textProperties);
    if (textProperties.wrapMode === 'none') {
      return Math.max(1, draftText.replace(/\r\n?/g, '\n').split('\n').length);
    }
    return wrapTextToLines(ctx, draftText, wrapWidth, textProperties.letterSpacing).length;
  })();
  const contentHeight = lineCount * textProperties.fontSize * textProperties.lineHeight;
  const verticalInsetSource = textProperties.verticalAlign === 'bottom'
    ? Math.max(0, geometry.box.height - contentHeight)
    : textProperties.verticalAlign === 'middle'
      ? Math.max(0, (geometry.box.height - contentHeight) / 2)
      : 0;

  return {
    left: geometry.corners.tl.x,
    top: geometry.corners.tl.y,
    width: geometry.width,
    height: geometry.height,
    transform: `rotate(${geometry.rotation}rad)`,
    fontFamily: textProperties.fontFamily,
    fontSize,
    fontStyle: textProperties.fontStyle,
    fontWeight: textProperties.fontWeight,
    lineHeight: textProperties.lineHeight,
    letterSpacing: textProperties.letterSpacing * geometry.scaleX,
    textAlign: textProperties.textAlign,
    color: 'transparent',
    caretColor: isEditing ? textProperties.color : 'transparent',
    paddingTop: verticalInsetSource * geometry.scaleY,
  };
}

export function buildSelectionPolygons(params: {
  geometry: EditorGeometry;
  textProperties: TextClipProperties;
  draftText: string;
  isEditing: boolean;
  textSelection: TextSelectionRange;
}): SelectionPolygon[] {
  const { geometry, textProperties, draftText, isEditing, textSelection } = params;
  if (!isEditing || textSelection.start === textSelection.end) {
    return [];
  }
  if (typeof document === 'undefined') return [];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.font = getFontCss(textProperties);
  const lineHeightPx = textProperties.fontSize * textProperties.lineHeight;
  const topBaseline = geometry.box.y + textProperties.fontSize;
  const firstPassLines = wrapTextToShapeLines(
    ctx,
    draftText,
    geometry.bounds,
    geometry.box,
    geometry.sourceWidth,
    geometry.sourceHeight,
    textProperties.fontSize,
    textProperties.lineHeight,
    textProperties.letterSpacing,
    topBaseline,
    textProperties.wrapMode,
  );
  const totalHeight = firstPassLines.length * lineHeightPx;
  const startY = textProperties.verticalAlign === 'bottom'
    ? geometry.box.y + Math.max(0, geometry.box.height - totalHeight) + textProperties.fontSize
    : textProperties.verticalAlign === 'middle'
      ? geometry.box.y + Math.max(0, (geometry.box.height - totalHeight) / 2) + textProperties.fontSize
      : topBaseline;
  const lines = wrapTextToShapeLines(
    ctx,
    draftText,
    geometry.bounds,
    geometry.box,
    geometry.sourceWidth,
    geometry.sourceHeight,
    textProperties.fontSize,
    textProperties.lineHeight,
    textProperties.letterSpacing,
    startY,
    textProperties.wrapMode,
  );

  const selectionStart = Math.min(textSelection.start, textSelection.end);
  const selectionEnd = Math.max(textSelection.start, textSelection.end);
  const polygons: SelectionPolygon[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const start = Math.max(selectionStart, line.start);
    const end = Math.min(selectionEnd, line.end);
    if (end <= start || line.text.length === 0) continue;

    const visualStart = Math.max(0, Math.min(line.text.length, start - line.start));
    const visualEnd = Math.max(visualStart, Math.min(line.text.length, end - line.start));
    if (visualEnd <= visualStart) continue;

    const leftEdge = selectionLineLeft(ctx, line.text, line.left, line.right, line.width, textProperties);
    const selectedLeft = leftEdge + measureTextWithLetterSpacing(
      ctx,
      line.text.slice(0, visualStart),
      textProperties.letterSpacing,
    );
    const selectedRight = leftEdge + measureTextWithLetterSpacing(
      ctx,
      line.text.slice(0, visualEnd),
      textProperties.letterSpacing,
    );
    if (selectedRight <= selectedLeft) continue;

    const yTop = line.y - textProperties.fontSize;
    const yBottom = yTop + lineHeightPx;
    polygons.push({
      id: `selection-${index}-${start}-${end}`,
      points: pointString([
        geometry.projectSourcePoint(selectedLeft, yTop),
        geometry.projectSourcePoint(selectedRight, yTop),
        geometry.projectSourcePoint(selectedRight, yBottom),
        geometry.projectSourcePoint(selectedLeft, yBottom),
      ]),
    });
  }

  return polygons;
}
