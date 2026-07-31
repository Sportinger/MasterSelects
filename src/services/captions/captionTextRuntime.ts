import type {
  CaptionClipProperties,
} from '../../types/caption';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { markDynamicCanvasUpdated } from '../canvasVersion';
import { createTextLayoutSnapshot, type TextBoxRect } from '../textLayout';
import { textRenderer } from '../textRenderer';
import {
  type CaptionFrameModel,
  type CaptionFrameToken,
  createCaptionFrameModel,
  type CaptionSourceTimeResolver,
} from './captionRuntime';

interface CaptionTextDocument {
  text: string;
  ranges: Array<{ token: CaptionFrameToken; start: number; end: number }>;
}

export interface CaptionTextFrameRuntime {
  frame: CaptionFrameModel | null;
  canvas: HTMLCanvasElement | null;
}

const highlightCanvasByTarget = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const scaleCanvasByTarget = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const renderSignatureByCanvas = new WeakMap<HTMLCanvasElement, string>();

function punctuationAttachesToPrevious(text: string): boolean {
  return /^[,.;:!?%)\]}]/.test(text);
}

function buildTextDocument(tokens: readonly CaptionFrameToken[]): CaptionTextDocument {
  let text = '';
  const ranges: CaptionTextDocument['ranges'] = [];
  for (const token of tokens) {
    const prefix = text.length > 0 && !punctuationAttachesToPrevious(token.text) ? ' ' : '';
    text += prefix;
    const start = text.length;
    text += token.text;
    ranges.push({ token, start, end: text.length });
  }
  return { text, ranges };
}

function getHighlightCanvas(target: HTMLCanvasElement): HTMLCanvasElement {
  let canvas = highlightCanvasByTarget.get(target);
  if (!canvas) {
    canvas = document.createElement('canvas');
    highlightCanvasByTarget.set(target, canvas);
  }
  if (canvas.width !== target.width || canvas.height !== target.height) {
    canvas.width = target.width;
    canvas.height = target.height;
  }
  return canvas;
}

function getScaleCanvas(target: HTMLCanvasElement): HTMLCanvasElement {
  let canvas = scaleCanvasByTarget.get(target);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scaleCanvasByTarget.set(target, canvas);
  }
  if (canvas.width !== target.width || canvas.height !== target.height) {
    canvas.width = target.width;
    canvas.height = target.height;
  }
  return canvas;
}

function collectRangeRects(
  layout: ReturnType<typeof createTextLayoutSnapshot>,
  start: number,
  end: number,
): TextBoxRect[] {
  const chars = layout.characters.filter(character =>
    character.index >= start && character.index < end
  );
  const byLine = new Map<number, typeof chars>();
  for (const character of chars) {
    const current = byLine.get(character.lineIndex) ?? [];
    current.push(character);
    byLine.set(character.lineIndex, current);
  }
  return [...byLine.values()].map(lineChars => {
    const left = Math.min(...lineChars.map(character => character.left));
    const right = Math.max(...lineChars.map(character => character.right));
    const top = Math.min(...lineChars.map(character => character.top));
    const bottom = Math.max(...lineChars.map(character => character.bottom));
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, rect: TextBoxRect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2)),
  );
}

function renderHighlight(
  canvas: HTMLCanvasElement,
  props: TextClipProperties,
  document: CaptionTextDocument,
  captionProperties: CaptionClipProperties,
): void {
  if (!captionProperties.highlight.enabled) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const layout = createTextLayoutSnapshot(context, props, canvas.width, canvas.height);
  const highlightedRanges = document.ranges.filter(range => range.token.highlighted);
  if (highlightedRanges.length === 0) return;

  if (captionProperties.highlight.style === 'background') {
    context.save();
    context.globalCompositeOperation = 'destination-over';
    context.globalAlpha = captionProperties.highlight.backgroundOpacity;
    context.fillStyle = captionProperties.highlight.backgroundColor;
    for (const range of highlightedRanges) {
      for (const rect of collectRangeRects(layout, range.start, range.end)) {
        const paddingX = props.fontSize * 0.12;
        const paddingY = layout.lines.length > 1 ? 0 : props.fontSize * 0.08;
        const padded = {
          x: rect.x - paddingX,
          y: rect.y - paddingY,
          width: rect.width + paddingX * 2,
          height: Math.max(1, rect.height + paddingY * 2),
        };
        roundedRect(context, padded, props.fontSize * 0.12);
        context.fill();
      }
    }
    context.restore();
  } else if (captionProperties.highlight.style === 'underline') {
    context.save();
    context.strokeStyle = captionProperties.highlight.underlineColor;
    context.lineWidth = captionProperties.highlight.underlineWidth;
    context.lineCap = 'round';
    for (const range of highlightedRanges) {
      for (const rect of collectRangeRects(layout, range.start, range.end)) {
        const y = rect.y + rect.height - Math.max(2, props.fontSize * 0.05);
        context.beginPath();
        context.moveTo(rect.x, y);
        context.lineTo(rect.x + rect.width, y);
        context.stroke();
      }
    }
    context.restore();
  } else {
    const highlightCanvas = getHighlightCanvas(canvas);
    textRenderer.render({
      ...props,
      text: document.text,
      color: captionProperties.highlight.textColor,
    }, highlightCanvas);
    const padding = Math.max(
      4,
      props.strokeEnabled ? props.strokeWidth * 3 : 0,
      props.shadowEnabled
        ? props.shadowBlur + Math.abs(props.shadowOffsetX) + Math.abs(props.shadowOffsetY)
        : 0,
    );
    for (const range of highlightedRanges) {
      for (const rect of collectRangeRects(layout, range.start, range.end)) {
        const x = Math.max(0, Math.floor(rect.x - padding));
        const y = Math.max(0, Math.floor(rect.y - padding));
        const right = Math.min(canvas.width, Math.ceil(rect.x + rect.width + padding));
        const bottom = Math.min(canvas.height, Math.ceil(rect.y + rect.height + padding));
        if (right > x && bottom > y) {
          context.drawImage(highlightCanvas, x, y, right - x, bottom - y, x, y, right - x, bottom - y);
        }
      }
    }
  }
  markDynamicCanvasUpdated(canvas, 'caption-text-binding');
}

export function getCaptionWordPulseScale(progress: number, peakScale: number): number {
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const normalizedPeak = Math.max(1, peakScale);
  return 1 + (normalizedPeak - 1) * Math.sin(Math.PI * normalizedProgress);
}

export function getCaptionWordPulseSpacing(wordWidth: number, scale: number): {
  activeWidth: number;
  previousWordsShift: number;
  followingWordsShift: number;
} {
  const width = Math.max(0, wordWidth);
  const activeWidth = width * Math.max(1, scale);
  const halfExpansion = (activeWidth - width) / 2;
  return {
    activeWidth,
    previousWordsShift: -halfExpansion,
    followingWordsShift: halfExpansion,
  };
}

function renderWordScalePulse(
  canvas: HTMLCanvasElement,
  props: TextClipProperties,
  document: CaptionTextDocument,
  captionProperties: CaptionClipProperties,
): void {
  const scaleEnabled = captionProperties.highlight.scaleEnabled ?? false;
  if (!captionProperties.highlight.enabled || !scaleEnabled) return;
  const activeRange = document.ranges.find(range => range.token.active);
  if (!activeRange) return;
  const scale = getCaptionWordPulseScale(
    activeRange.token.progress,
    captionProperties.highlight.scale ?? 1.18,
  );
  if (scale <= 1.001) return;

  const context = canvas.getContext('2d');
  if (!context) return;
  const layout = createTextLayoutSnapshot(context, props, canvas.width, canvas.height);
  const scratch = getScaleCanvas(canvas);
  const scratchContext = scratch.getContext('2d');
  if (!scratchContext) return;
  scratchContext.clearRect(0, 0, scratch.width, scratch.height);
  scratchContext.drawImage(canvas, 0, 0);

  const effectPadding = Math.max(
    props.fontSize * (captionProperties.highlight.style === 'background' ? 0.18 : 0.08),
    props.strokeEnabled ? props.strokeWidth * 2 : 0,
    props.shadowEnabled
      ? props.shadowBlur + Math.abs(props.shadowOffsetX) + Math.abs(props.shadowOffsetY)
      : 0,
  );
  const activeCharacters = layout.characters.filter(character =>
    character.index >= activeRange.start && character.index < activeRange.end
  );
  const activeLineIndex = activeCharacters[0]?.lineIndex;
  const activeRect = collectRangeRects(layout, activeRange.start, activeRange.end)[0];
  if (activeLineIndex === undefined || !activeRect) return;

  const lineFrames = layout.lines.flatMap(line => {
    const characters = layout.characters.filter(character => character.lineIndex === line.index);
    if (characters.length === 0) return [];
    const y = Math.max(0, Math.floor(Math.min(...characters.map(character => character.top))));
    const bottom = Math.min(canvas.height, Math.ceil(Math.max(...characters.map(character => character.bottom))));
    const x = Math.max(0, Math.floor(line.left - effectPadding));
    const right = Math.min(canvas.width, Math.ceil(line.right + effectPadding));
    return [{ index: line.index, x, y, width: right - x, height: bottom - y }];
  });
  const activeLine = lineFrames.find(line => line.index === activeLineIndex);
  if (!activeLine || activeLine.width <= 0 || activeLine.height <= 0) return;

  const activeX = Math.max(activeLine.x, Math.floor(activeRect.x - effectPadding));
  const activeRight = Math.min(
    activeLine.x + activeLine.width,
    Math.ceil(activeRect.x + activeRect.width + effectPadding),
  );
  const activeWidth = activeRight - activeX;
  if (activeWidth <= 0) return;
  const horizontalSpacing = getCaptionWordPulseSpacing(activeWidth, scale);
  const verticalSpacing = getCaptionWordPulseSpacing(activeLine.height, scale);
  const activeCenterX = activeX + activeWidth / 2;
  const activeCenterY = activeLine.y + activeLine.height / 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const line of lineFrames) {
    if (line.index !== activeLineIndex) {
      const shiftY = line.index < activeLineIndex
        ? verticalSpacing.previousWordsShift
        : verticalSpacing.followingWordsShift;
      context.drawImage(
        scratch,
        line.x,
        line.y,
        line.width,
        line.height,
        line.x,
        line.y + shiftY,
        line.width,
        line.height,
      );
      continue;
    }

    const previousWordsWidth = Math.max(0, activeX - line.x);
    if (previousWordsWidth > 0) {
      context.drawImage(
        scratch,
        line.x,
        line.y,
        previousWordsWidth,
        line.height,
        line.x + horizontalSpacing.previousWordsShift,
        line.y,
        previousWordsWidth,
        line.height,
      );
    }
    context.drawImage(
      scratch,
      activeX,
      line.y,
      activeWidth,
      line.height,
      activeCenterX - horizontalSpacing.activeWidth / 2,
      activeCenterY - line.height * scale / 2,
      horizontalSpacing.activeWidth,
      line.height * scale,
    );
    const followingWordsX = activeRight;
    const followingWordsWidth = Math.max(0, line.x + line.width - followingWordsX);
    if (followingWordsWidth > 0) {
      context.drawImage(
        scratch,
        followingWordsX,
        line.y,
        followingWordsWidth,
        line.height,
        followingWordsX + horizontalSpacing.followingWordsShift,
        line.y,
        followingWordsWidth,
        line.height,
      );
    }
  }
  markDynamicCanvasUpdated(canvas, 'caption-word-scale');
}

function renderCaptionBackground(
  canvas: HTMLCanvasElement,
  props: TextClipProperties,
  document: CaptionTextDocument,
  captionProperties: CaptionClipProperties,
): void {
  if (!captionProperties.background.enabled || !props.text) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const layout = createTextLayoutSnapshot(context, props, canvas.width, canvas.height);
  const bounds = layout.contentBounds;
  const activeRange = captionProperties.highlight.scaleEnabled
    ? document.ranges.find(range => range.token.active)
    : undefined;
  const scale = activeRange
    ? getCaptionWordPulseScale(
        activeRange.token.progress,
        captionProperties.highlight.scale ?? 1.18,
      )
    : 1;
  const activeRect = activeRange
    ? collectRangeRects(layout, activeRange.start, activeRange.end)[0]
    : undefined;
  const horizontalExpansion = activeRect ? activeRect.width * (scale - 1) / 2 : 0;
  const verticalExpansion = activeRect ? activeRect.height * (scale - 1) / 2 : 0;
  const rect = {
    x: bounds.x - captionProperties.background.paddingX - horizontalExpansion,
    y: bounds.y - captionProperties.background.paddingY - verticalExpansion,
    width: bounds.width + captionProperties.background.paddingX * 2 + horizontalExpansion * 2,
    height: bounds.height + captionProperties.background.paddingY * 2 + verticalExpansion * 2,
  };
  context.save();
  context.globalCompositeOperation = 'destination-over';
  context.globalAlpha = captionProperties.background.opacity;
  context.fillStyle = captionProperties.background.color;
  roundedRect(context, rect, captionProperties.background.borderRadius);
  context.fill();
  context.restore();
  markDynamicCanvasUpdated(canvas, 'caption-text-background');
}

function renderFrame(
  clip: TimelineClip,
  frame: CaptionFrameModel | null,
  textPropertiesOverride?: TextClipProperties,
): HTMLCanvasElement | null {
  const canvas = clip.source?.textCanvas;
  const baseProperties = textPropertiesOverride ?? clip.textProperties;
  const captionProperties = clip.captionProperties;
  if (!canvas || !baseProperties || !captionProperties) return null;
  const document = buildTextDocument(frame?.tokens ?? []);
  const props: TextClipProperties = { ...baseProperties, text: document.text };
  const signature = JSON.stringify({
    text: document.text,
    highlighted: document.ranges.filter(range => range.token.highlighted).map(range => range.token.id),
    activeProgress: captionProperties.highlight.scaleEnabled
      ? document.ranges.find(range => range.token.active)?.token.progress
      : undefined,
    props,
    background: captionProperties.background,
    highlight: captionProperties.highlight,
  });
  if (renderSignatureByCanvas.get(canvas) === signature) return canvas;
  textRenderer.render(props, canvas);
  renderHighlight(canvas, props, document, captionProperties);
  renderWordScalePulse(canvas, props, document, captionProperties);
  renderCaptionBackground(canvas, props, document, captionProperties);
  renderSignatureByCanvas.set(canvas, signature);
  return canvas;
}

export function renderCaptionTextClipFrame(input: {
  captionClip: TimelineClip;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  timelineTime: number;
  resolveSourceTime?: CaptionSourceTimeResolver;
  textPropertiesOverride?: TextClipProperties;
}): CaptionTextFrameRuntime {
  const frame = createCaptionFrameModel(input);
  return {
    frame,
    canvas: renderFrame(input.captionClip, frame, input.textPropertiesOverride),
  };
}
