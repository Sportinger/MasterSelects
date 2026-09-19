import type { TextBoundsPath } from '../../types/masks';
import { clamp } from './textLayoutMath';
import type { TextBoxRect, TextShapeLine } from './textLayoutTypes';
import { measureTextWithLetterSpacing, splitLongToken } from './textMeasurement';

type MaskVertexLike = TextBoundsPath['vertices'][number];

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
  wrapMode: 'word' | 'none' = 'word',
): TextShapeLine[] {
  const polyline = boundsToPolyline(bounds, canvasWidth, canvasHeight);
  const lineHeightPx = Math.max(1, fontSize * lineHeight);
  const normalizedText = text.replace(/\r\n?/g, '\n');
  if (wrapMode === 'none') {
    let cursor = 0;
    return normalizedText.split('\n').map((lineText, lineIndex) => {
      const y = startBaselineY + lineIndex * lineHeightPx;
      const interval = getLineInterval(polyline, y - fontSize * 0.45, box);
      const start = cursor;
      const end = start + lineText.length;
      cursor = end + 1;
      return { text: lineText, start, end, y, ...interval };
    });
  }
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
