import type { MaskPathKeyframeValue, TextBoundsPath, TextClipProperties } from '../types';

export interface TextBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextShapeLine {
  text: string;
  start: number;
  end: number;
  y: number;
  left: number;
  right: number;
  width: number;
}

export interface TextLayoutLine extends TextShapeLine {
  index: number;
}

export interface TextLayoutCharacter {
  index: number;
  lineIndex: number;
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rect: [number, number, number, number];
  left: number;
  top: number;
  right: number;
  bottom: number;
  baselineY: number;
}

export interface TextLayoutSnapshot {
  canvasWidth: number;
  canvasHeight: number;
  lineHeightPx: number;
  box?: TextBoxRect;
  contentBounds: TextBoxRect;
  lines: TextLayoutLine[];
  characters: TextLayoutCharacter[];
}

const DEFAULT_BOX_WIDTH_RATIO = 0.62;
const DEFAULT_BOX_HEIGHT_RATIO = 0.28;
const MIN_BOX_WIDTH = 24;
const MIN_BOX_HEIGHT = 24;
const TEXT_BOUNDS_ID = 'text-bounds';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isAreaTextEnabled(props: Pick<TextClipProperties, 'boxEnabled'>): boolean {
  return props.boxEnabled === true;
}

function resolveLegacyTextBoxRect(
  props: Pick<TextClipProperties, 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  const safeWidth = Math.max(MIN_BOX_WIDTH, canvasWidth || 1920);
  const safeHeight = Math.max(MIN_BOX_HEIGHT, canvasHeight || 1080);
  const defaultWidth = safeWidth * DEFAULT_BOX_WIDTH_RATIO;
  const defaultHeight = safeHeight * DEFAULT_BOX_HEIGHT_RATIO;
  const defaultX = (safeWidth - defaultWidth) / 2;
  const defaultY = (safeHeight - defaultHeight) / 2;

  const x = clamp(finiteNumber(props.boxX, defaultX), 0, Math.max(0, safeWidth - MIN_BOX_WIDTH));
  const y = clamp(finiteNumber(props.boxY, defaultY), 0, Math.max(0, safeHeight - MIN_BOX_HEIGHT));
  const width = clamp(
    finiteNumber(props.boxWidth, defaultWidth),
    MIN_BOX_WIDTH,
    Math.max(MIN_BOX_WIDTH, safeWidth - x),
  );
  const height = clamp(
    finiteNumber(props.boxHeight, defaultHeight),
    MIN_BOX_HEIGHT,
    Math.max(MIN_BOX_HEIGHT, safeHeight - y),
  );

  return { x, y, width, height };
}

export function createTextBoundsFromRect(
  rect: TextBoxRect,
  canvasWidth: number,
  canvasHeight: number,
  id: string = TEXT_BOUNDS_ID,
  options: { clampToCanvas?: boolean } = {},
): TextBoundsPath {
  const safeWidth = Math.max(1, canvasWidth || 1920);
  const safeHeight = Math.max(1, canvasHeight || 1080);
  const shouldClamp = options.clampToCanvas !== false;
  const left = shouldClamp ? clamp(rect.x, 0, safeWidth) : rect.x;
  const top = shouldClamp ? clamp(rect.y, 0, safeHeight) : rect.y;
  const right = shouldClamp
    ? clamp(rect.x + Math.max(MIN_BOX_WIDTH, rect.width), 0, safeWidth)
    : rect.x + Math.max(MIN_BOX_WIDTH, rect.width);
  const bottom = shouldClamp
    ? clamp(rect.y + Math.max(MIN_BOX_HEIGHT, rect.height), 0, safeHeight)
    : rect.y + Math.max(MIN_BOX_HEIGHT, rect.height);

  return {
    id,
    closed: true,
    position: { x: 0, y: 0 },
    visible: true,
    outlineColor: '#ff3b30',
    vertices: [
      { id: 'tbv_tl', x: left / safeWidth, y: top / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_tr', x: right / safeWidth, y: top / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_br', x: right / safeWidth, y: bottom / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_bl', x: left / safeWidth, y: bottom / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
    ],
  };
}

export function createDefaultTextBoundsPath(canvasWidth: number, canvasHeight: number): TextBoundsPath {
  return createTextBoundsFromRect(resolveLegacyTextBoxRect({}, canvasWidth, canvasHeight), canvasWidth, canvasHeight);
}

export function cloneTextBoundsPath(bounds: TextBoundsPath): TextBoundsPath {
  return {
    ...bounds,
    position: { ...bounds.position },
    vertices: bounds.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getTextBoundsPathValue(bounds: TextBoundsPath): MaskPathKeyframeValue {
  return {
    closed: bounds.closed,
    vertices: cloneTextBoundsPath(bounds).vertices,
  };
}

export function applyTextBoundsPathValue(
  bounds: TextBoundsPath,
  value: MaskPathKeyframeValue,
): TextBoundsPath {
  return {
    ...bounds,
    closed: value.closed,
    vertices: value.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getTextBoundsBoundingBox(
  bounds: TextBoundsPath,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  const safeWidth = Math.max(1, canvasWidth || 1920);
  const safeHeight = Math.max(1, canvasHeight || 1080);
  if (bounds.vertices.length === 0) {
    return resolveLegacyTextBoxRect({}, safeWidth, safeHeight);
  }

  const xs = bounds.vertices.map(vertex => (vertex.x + bounds.position.x) * safeWidth);
  const ys = bounds.vertices.map(vertex => (vertex.y + bounds.position.y) * safeHeight);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(MIN_BOX_WIDTH, Math.max(...xs) - x);
  const height = Math.max(MIN_BOX_HEIGHT, Math.max(...ys) - y);
  return { x, y, width, height };
}

export function resolveTextBoundsPath(
  props: Pick<TextClipProperties, 'textBounds' | 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoundsPath {
  if (props.textBounds?.vertices?.length) {
    return cloneTextBoundsPath(props.textBounds);
  }
  return createTextBoundsFromRect(resolveLegacyTextBoxRect(props, canvasWidth, canvasHeight), canvasWidth, canvasHeight);
}

export function resolveTextBoxRect(
  props: Pick<TextClipProperties, 'textBounds' | 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  if (props.textBounds?.vertices?.length) {
    return getTextBoundsBoundingBox(props.textBounds, canvasWidth, canvasHeight);
  }
  return resolveLegacyTextBoxRect(props, canvasWidth, canvasHeight);
}

export function traceTextBoundsPath(
  ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'bezierCurveTo' | 'closePath'>,
  bounds: TextBoundsPath,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const vertices = bounds.vertices;
  ctx.beginPath();
  if (vertices.length === 0) return;

  const toCanvas = (vertex: { x: number; y: number }) => ({
    x: (vertex.x + bounds.position.x) * canvasWidth,
    y: (vertex.y + bounds.position.y) * canvasHeight,
  });

  const first = toCanvas(vertices[0]);
  ctx.moveTo(first.x, first.y);

  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const start = toCanvas(previous);
    const end = toCanvas(current);
    const cp1 = {
      x: start.x + previous.handleOut.x * canvasWidth,
      y: start.y + previous.handleOut.y * canvasHeight,
    };
    const cp2 = {
      x: end.x + current.handleIn.x * canvasWidth,
      y: end.y + current.handleIn.y * canvasHeight,
    };
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      ctx.lineTo(end.x, end.y);
    } else {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    }
  }

  if (bounds.closed && vertices.length > 1) {
    const previous = vertices[vertices.length - 1];
    const current = vertices[0];
    const start = toCanvas(previous);
    const end = toCanvas(current);
    const cp1 = {
      x: start.x + previous.handleOut.x * canvasWidth,
      y: start.y + previous.handleOut.y * canvasHeight,
    };
    const cp2 = {
      x: end.x + current.handleIn.x * canvasWidth,
      y: end.y + current.handleIn.y * canvasHeight,
    };
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      ctx.closePath();
    } else {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
      ctx.closePath();
    }
  }
}

export function measureTextWithLetterSpacing(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  letterSpacing: number,
): number {
  if (text.length === 0) return 0;
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
}

function splitLongToken(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  token: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const char of token) {
    const candidate = current + char;
    if (current && measureTextWithLetterSpacing(ctx, candidate, letterSpacing) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [token];
}

function boundsToPolyline(
  bounds: TextBoundsPath,
  canvasWidth: number,
  canvasHeight: number,
): Array<{ x: number; y: number }> {
  const vertices = bounds.vertices;
  if (vertices.length === 0) return [];

  const toCanvas = (vertex: MaskVertexLike, handle?: { x: number; y: number }) => ({
    x: (vertex.x + bounds.position.x + (handle?.x ?? 0)) * canvasWidth,
    y: (vertex.y + bounds.position.y + (handle?.y ?? 0)) * canvasHeight,
  });
  const points: Array<{ x: number; y: number }> = [toCanvas(vertices[0])];
  const addSegment = (from: MaskVertexLike, to: MaskVertexLike) => {
    const start = toCanvas(from);
    const end = toCanvas(to);
    const cp1 = toCanvas(from, from.handleOut);
    const cp2 = toCanvas(to, to.handleIn);
    const isLine =
      from.handleOut.x === 0 &&
      from.handleOut.y === 0 &&
      to.handleIn.x === 0 &&
      to.handleIn.y === 0;

    if (isLine) {
      points.push(end);
      return;
    }

    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const mt = 1 - t;
      points.push({
        x:
          mt * mt * mt * start.x +
          3 * mt * mt * t * cp1.x +
          3 * mt * t * t * cp2.x +
          t * t * t * end.x,
        y:
          mt * mt * mt * start.y +
          3 * mt * mt * t * cp1.y +
          3 * mt * t * t * cp2.y +
          t * t * t * end.y,
      });
    }
  };

  for (let index = 1; index < vertices.length; index += 1) {
    addSegment(vertices[index - 1], vertices[index]);
  }
  if (bounds.closed && vertices.length > 1) {
    addSegment(vertices[vertices.length - 1], vertices[0]);
  }
  return points;
}

type MaskVertexLike = TextBoundsPath['vertices'][number];

function getShapeIntervalAtY(
  polyline: Array<{ x: number; y: number }>,
  y: number,
  fallback: TextBoxRect,
): { left: number; right: number; width: number } {
  if (polyline.length < 3) {
    return { left: fallback.x, right: fallback.x + fallback.width, width: fallback.width };
  }

  const intersections: number[] = [];
  for (let index = 0; index < polyline.length; index += 1) {
    const a = polyline[index];
    const b = polyline[(index + 1) % polyline.length];
    if (!a || !b || a.y === b.y) continue;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (y < minY || y >= maxY) continue;
    const t = (y - a.y) / (b.y - a.y);
    intersections.push(a.x + t * (b.x - a.x));
  }

  intersections.sort((a, b) => a - b);
  let best: { left: number; right: number; width: number } | null = null;
  for (let index = 0; index < intersections.length - 1; index += 2) {
    const left = intersections[index];
    const right = intersections[index + 1];
    const width = Math.max(0, right - left);
    if (!best || width > best.width) {
      best = { left, right, width };
    }
  }

  if (!best || best.width < 1) {
    return { left: fallback.x, right: fallback.x + fallback.width, width: fallback.width };
  }

  return best;
}

function getLineInterval(
  polyline: Array<{ x: number; y: number }>,
  lineCenterY: number,
  fallback: TextBoxRect,
): { left: number; right: number; width: number } {
  const interval = getShapeIntervalAtY(polyline, lineCenterY, fallback);
  const clampedLeft = clamp(interval.left, fallback.x, fallback.x + fallback.width);
  const clampedRight = clamp(interval.right, fallback.x, fallback.x + fallback.width);
  const width = Math.max(1, clampedRight - clampedLeft);
  return { left: clampedLeft, right: clampedRight, width };
}

export function wrapTextToShapeLines(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  bounds: TextBoundsPath,
  box: TextBoxRect,
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
  startBaselineY: number,
): TextShapeLine[] {
  const polyline = boundsToPolyline(bounds, canvasWidth, canvasHeight);
  const lineHeightPx = Math.max(1, fontSize * lineHeight);
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const lines: TextShapeLine[] = [];
  let lineIndex = 0;
  let paragraphStart = 0;

  const pushLine = (lineText: string, start: number, end: number) => {
    const y = startBaselineY + lineIndex * lineHeightPx;
    const interval = getLineInterval(polyline, y - fontSize * 0.45, box);
    lines.push({ text: lineText, start, end, y, ...interval });
    lineIndex += 1;
  };

  const currentMaxWidth = () => {
    const y = startBaselineY + lineIndex * lineHeightPx;
    return getLineInterval(polyline, y - fontSize * 0.45, box).width;
  };

  for (const paragraph of normalizedText.split('\n')) {
    const paragraphEnd = paragraphStart + paragraph.length;
    if (paragraph.length === 0) {
      pushLine('', paragraphStart, paragraphStart);
      paragraphStart = paragraphEnd + 1;
      continue;
    }

    const words = Array.from(paragraph.matchAll(/\S+/g)).map(match => ({
      text: match[0],
      start: paragraphStart + (match.index ?? 0),
      end: paragraphStart + (match.index ?? 0) + match[0].length,
    }));
    let current: { text: string; start: number; end: number } | null = null;

    for (const word of words) {
      const maxWidth = currentMaxWidth();
      const candidate: string = current ? `${current.text} ${word.text}` : word.text;
      const candidateStart: number = current?.start ?? word.start;
      const candidateEnd: number = word.end;

      if (measureTextWithLetterSpacing(ctx, candidate, letterSpacing) <= maxWidth) {
        current = { text: candidate, start: candidateStart, end: candidateEnd };
        continue;
      }

      if (current) {
        pushLine(current.text, current.start, current.end);
        current = null;
      }

      if (measureTextWithLetterSpacing(ctx, word.text, letterSpacing) <= currentMaxWidth()) {
        current = word;
        continue;
      }

      const chunks = splitLongToken(ctx, word.text, currentMaxWidth(), letterSpacing);
      let chunkStart = word.start;
      for (const chunk of chunks.slice(0, -1)) {
        const chunkEnd = chunkStart + chunk.length;
        pushLine(chunk, chunkStart, chunkEnd);
        chunkStart = chunkEnd;
      }
      const lastChunk = chunks[chunks.length - 1] ?? '';
      current = { text: lastChunk, start: chunkStart, end: chunkStart + lastChunk.length };
    }

    if (current) {
      pushLine(current.text, current.start, current.end);
    } else if (words.length === 0) {
      pushLine('', paragraphStart, paragraphStart);
    }
    paragraphStart = paragraphEnd + 1;
  }

  return lines.length > 0 ? lines : [{
    text: '',
    start: 0,
    end: 0,
    y: startBaselineY,
    left: box.x,
    right: box.x + box.width,
    width: box.width,
  }];
}

export function wrapTextToLines(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  const safeMaxWidth = Math.max(1, maxWidth);
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.trim().split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;

      if (measureTextWithLetterSpacing(ctx, candidate, letterSpacing) <= safeMaxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      if (measureTextWithLetterSpacing(ctx, word, letterSpacing) <= safeMaxWidth) {
        current = word;
        continue;
      }

      const chunks = splitLongToken(ctx, word, safeMaxWidth, letterSpacing);
      lines.push(...chunks.slice(0, -1));
      current = chunks[chunks.length - 1] ?? '';
    }

    if (current || words.length === 0) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}

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
