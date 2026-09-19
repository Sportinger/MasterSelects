import type { TextClipProperties } from '../../types/text';
import { isAreaTextEnabled, resolveTextBoundsPath, resolveTextBoxRect } from './textBounds';
import { clamp } from './textLayoutMath';
import type {
  TextBoxRect,
  TextLayoutCharacter,
  TextLayoutLine,
  TextLayoutSnapshot,
} from './textLayoutTypes';
import { measureTextWithLetterSpacing } from './textMeasurement';
import { wrapTextToShapeLines } from './textShapeWrapping';

function getTextLineContentBounds(
  lines: TextLayoutLine[],
  characters: TextLayoutCharacter[],
  fontSize: number,
  lineHeightPx: number,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  if (lines.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const hasCharacters = characters.length > 0;
  const left = hasCharacters
    ? Math.min(...characters.map((character) => character.left))
    : Math.min(...lines.map((line) => line.left));
  const right = hasCharacters
    ? Math.max(...characters.map((character) => character.right))
    : Math.max(...lines.map((line) => line.right));
  const top = hasCharacters
    ? Math.min(...characters.map((character) => character.top))
    : Math.min(...lines.map((line) => line.y - fontSize));
  const bottom = hasCharacters
    ? Math.max(...characters.map((character) => character.bottom))
    : Math.max(...lines.map((line) => line.y - fontSize + lineHeightPx));
  const x = clamp(left, 0, canvasWidth);
  const y = clamp(top, 0, canvasHeight);
  const maxRight = clamp(right, 0, canvasWidth);
  const maxBottom = clamp(bottom, 0, canvasHeight);

  return {
    x,
    y,
    width: Math.max(0, maxRight - x),
    height: Math.max(0, maxBottom - y),
  };
}

function getLineBaseX(line: TextLayoutLine, textAlign: TextClipProperties['textAlign']): number {
  if (textAlign === 'center') {
    return line.left + line.width / 2;
  }
  if (textAlign === 'right') {
    return line.right;
  }
  return line.left;
}

function getLineTextStartX(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  line: TextLayoutLine,
  textAlign: TextClipProperties['textAlign'],
  letterSpacing: number,
): number {
  const textWidth = measureTextWithLetterSpacing(ctx, line.text, letterSpacing);
  const baseX = getLineBaseX(line, textAlign);
  if (textAlign === 'center') {
    return baseX - textWidth / 2;
  }
  if (textAlign === 'right') {
    return baseX - textWidth;
  }
  return baseX;
}

function createTextLayoutCharacters(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  lines: TextLayoutLine[],
  textAlign: TextClipProperties['textAlign'],
  fontSize: number,
  lineHeightPx: number,
  letterSpacing: number,
): TextLayoutCharacter[] {
  return lines.flatMap((line) => {
    const characters = Array.from(line.text);
    const startX = getLineTextStartX(ctx, line, textAlign, letterSpacing);
    const top = line.y - fontSize;
    let codeUnitOffset = 0;

    return characters.map<TextLayoutCharacter>((char) => {
      const charStart = codeUnitOffset;
      const charEnd = charStart + char.length;
      const left = startX + measureTextWithLetterSpacing(ctx, line.text.slice(0, charStart), letterSpacing);
      const right = startX + measureTextWithLetterSpacing(ctx, line.text.slice(0, charEnd), letterSpacing);
      codeUnitOffset = charEnd;

      return {
        index: line.start + charStart,
        lineIndex: line.index,
        char,
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: lineHeightPx,
        rect: [left, top, Math.max(0, right - left), lineHeightPx],
        left,
        top,
        right,
        bottom: top + lineHeightPx,
        baselineY: line.y,
      };
    });
  });
}

export function createTextLayoutSnapshot(
  ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  props: TextClipProperties,
  canvasWidth: number,
  canvasHeight: number,
): TextLayoutSnapshot {
  const width = Math.max(1, canvasWidth || 1920);
  const height = Math.max(1, canvasHeight || 1080);
  const lineHeightPx = Math.max(1, props.fontSize * props.lineHeight);
  const fontStyle = props.fontStyle === 'italic' ? 'italic' : 'normal';
  ctx.font = `${fontStyle} ${props.fontWeight} ${props.fontSize}px "${props.fontFamily}"`;

  if (isAreaTextEnabled(props)) {
    const box = resolveTextBoxRect(props, width, height);
    const bounds = resolveTextBoundsPath(props, width, height);
    const topBaseline = box.y + props.fontSize;
    const firstPassLines = wrapTextToShapeLines(
      ctx,
      props.text,
      bounds,
      box,
      width,
      height,
      props.fontSize,
      props.lineHeight,
      props.letterSpacing,
      topBaseline,
      props.wrapMode,
    );
    const totalHeight = firstPassLines.length * lineHeightPx;
    let startY: number;
    switch (props.verticalAlign) {
      case 'middle':
        startY = box.y + Math.max(0, (box.height - totalHeight) / 2) + props.fontSize;
        break;
      case 'bottom':
        startY = box.y + Math.max(0, box.height - totalHeight) + props.fontSize;
        break;
      case 'top':
      default:
        startY = box.y + props.fontSize;
        break;
    }

    const lines = wrapTextToShapeLines(
      ctx,
      props.text,
      bounds,
      box,
      width,
      height,
      props.fontSize,
      props.lineHeight,
      props.letterSpacing,
      startY,
      props.wrapMode,
    ).map((line, index) => ({ ...line, index }));
    const characters = createTextLayoutCharacters(
      ctx,
      lines,
      props.textAlign,
      props.fontSize,
      lineHeightPx,
      props.letterSpacing,
    );

    return {
      canvasWidth: width,
      canvasHeight: height,
      lineHeightPx,
      box,
      contentBounds: getTextLineContentBounds(lines, characters, props.fontSize, lineHeightPx, width, height),
      lines,
      characters,
    };
  }

  const hardLines = props.text.split('\n');
  const totalHeight = hardLines.length * lineHeightPx;
  let startY: number;
  switch (props.verticalAlign) {
    case 'top':
      startY = props.fontSize;
      break;
    case 'bottom':
      startY = height - totalHeight + props.fontSize / 2;
      break;
    default:
      startY = (height - totalHeight) / 2 + props.fontSize / 2;
  }

  let x: number;
  switch (props.textAlign) {
    case 'left':
      x = 50;
      break;
    case 'right':
      x = width - 50;
      break;
    default:
      x = width / 2;
  }

  let cursor = 0;
  const lines = hardLines.map<TextLayoutLine>((line, index) => {
    const lineWidth = measureTextWithLetterSpacing(ctx, line, props.letterSpacing);
    const left = props.textAlign === 'center'
      ? x - lineWidth / 2
      : props.textAlign === 'right'
        ? x - lineWidth
        : x;
    const start = cursor;
    const end = cursor + line.length;
    cursor = end + 1;
    return {
      index,
      text: line,
      start,
      end,
      y: startY + index * lineHeightPx,
      left,
      right: left + lineWidth,
      width: lineWidth,
    };
  });
  const characters = createTextLayoutCharacters(
    ctx,
    lines,
    props.textAlign,
    props.fontSize,
    lineHeightPx,
    props.letterSpacing,
  );

  return {
    canvasWidth: width,
    canvasHeight: height,
    lineHeightPx,
    contentBounds: getTextLineContentBounds(lines, characters, props.fontSize, lineHeightPx, width, height),
    lines,
    characters,
  };
}
