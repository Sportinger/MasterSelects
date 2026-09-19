import type {
  CaptionClipProperties,
} from '../../types/caption';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { markDynamicCanvasUpdated } from '../canvasVersion';
import { googleFontsService } from '../googleFontsService';
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

export interface CaptionWordEditSnapshot {
  sourceClipId: string;
  sourceTime: number;
  textProperties: TextClipProperties;
  words: Array<{
    id: string;
    displayText: string;
    active: boolean;
    rects: TextBoxRect[];
  }>;
}

interface CaptionWordEditRuntimeState {
  document: CaptionTextDocument;
  frame: CaptionFrameModel;
  props: TextClipProperties;
}

const highlightCanvasByTarget = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const renderSignatureByCanvas = new WeakMap<HTMLCanvasElement, string>();
const wordEditStateByCanvas = new WeakMap<HTMLCanvasElement, CaptionWordEditRuntimeState>();

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

function selectCaptionDocumentPage(
  canvas: HTMLCanvasElement,
  props: TextClipProperties,
  frame: CaptionFrameModel | null,
  document: CaptionTextDocument,
  maxLines: number,
): CaptionTextDocument {
  if (!frame || document.ranges.length === 0 || !props.boxEnabled) return document;
  const context = canvas.getContext('2d');
  if (!context) return document;
  const lineLimit = Math.max(1, Math.round(maxLines));
  const layout = createTextLayoutSnapshot(
    context,
    { ...props, text: document.text },
    canvas.width,
    canvas.height,
  );
  if (layout.lines.length <= lineLimit) return document;

  const pageByToken = new Map<CaptionFrameToken, number>();
  for (const range of document.ranges) {
    const firstCharacter = layout.characters.find(character =>
      character.index >= range.start && character.index < range.end
    );
    const lineIndex = firstCharacter?.lineIndex
      ?? layout.lines.find(line => range.start >= line.start && range.start < line.end)?.index
      ?? 0;
    pageByToken.set(range.token, Math.floor(lineIndex / lineLimit));
  }

  const referenceRange = document.ranges.find(range => range.token.active)
    ?? document.ranges.findLast(range => range.token.start <= frame.sourceTime)
    ?? document.ranges[0];
  const activePage = pageByToken.get(referenceRange.token) ?? 0;
  return buildTextDocument(
    document.ranges
      .filter(range => pageByToken.get(range.token) === activePage)
      .map(range => range.token),
  );
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

type CaptionLayout = ReturnType<typeof createTextLayoutSnapshot>;
type CaptionLayoutCharacter = CaptionLayout['characters'][number];

interface CaptionWordFragment {
  token: CaptionFrameToken;
  lineIndex: number;
  characters: CaptionLayoutCharacter[];
  rect: TextBoxRect;
}

interface CaptionWordFragmentPlacement {
  fragment: CaptionWordFragment;
  translateX: number;
  translateY: number;
  scale: number;
  scaleCenterX: number;
  scaleCenterY: number;
}

function createCaptionWordFragments(
  layout: CaptionLayout,
  document: CaptionTextDocument,
): CaptionWordFragment[] {
  return document.ranges.flatMap(range => {
    const charactersByLine = new Map<number, CaptionLayoutCharacter[]>();
    for (const character of layout.characters) {
      if (character.index < range.start || character.index >= range.end) continue;
      const current = charactersByLine.get(character.lineIndex) ?? [];
      current.push(character);
      charactersByLine.set(character.lineIndex, current);
    }

    return [...charactersByLine.entries()].map(([lineIndex, characters]) => {
      const left = Math.min(...characters.map(character => character.left));
      const right = Math.max(...characters.map(character => character.right));
      const top = Math.min(...characters.map(character => character.top));
      const bottom = Math.max(...characters.map(character => character.bottom));
      return {
        token: range.token,
        lineIndex,
        characters,
        rect: { x: left, y: top, width: right - left, height: bottom - top },
      };
    });
  });
}

export function getCaptionWordEditSnapshot(
  canvas: HTMLCanvasElement,
): CaptionWordEditSnapshot | null {
  const state = wordEditStateByCanvas.get(canvas);
  const context = canvas.getContext('2d');
  if (!state || !context) return null;

  const layout = createTextLayoutSnapshot(
    context,
    state.props,
    canvas.width,
    canvas.height,
  );
  const rectsByWordId = new Map<string, TextBoxRect[]>();
  for (const fragment of createCaptionWordFragments(layout, state.document)) {
    const rects = rectsByWordId.get(fragment.token.id) ?? [];
    rects.push(fragment.rect);
    rectsByWordId.set(fragment.token.id, rects);
  }

  return {
    sourceClipId: state.frame.sourceClipId,
    sourceTime: state.frame.sourceTime,
    textProperties: state.props,
    words: state.document.ranges.flatMap(({ token }) => {
      const rects = rectsByWordId.get(token.id);
      return rects?.length
        ? [{
            id: token.id,
            displayText: token.text,
            active: token.active,
            rects,
          }]
        : [];
    }),
  };
}

function withCaptionFragmentTransform(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  paint: () => void,
): void {
  context.save();
  context.translate(placement.translateX, placement.translateY);
  if (placement.scale !== 1) {
    context.translate(placement.scaleCenterX, placement.scaleCenterY);
    context.scale(placement.scale, placement.scale);
    context.translate(-placement.scaleCenterX, -placement.scaleCenterY);
  }
  paint();
  context.restore();
}

function paintCaptionFragmentRun(
  context: CanvasRenderingContext2D,
  fragment: CaptionWordFragment,
  props: TextClipProperties,
  method: 'fillText' | 'strokeText',
): void {
  if (fragment.characters.length === 0) return;
  if (props.letterSpacing !== 0) {
    for (const character of fragment.characters) {
      context[method](character.char, character.left, character.baselineY);
    }
    return;
  }
  context[method](
    fragment.characters.map(character => character.char).join(''),
    fragment.characters[0].left,
    fragment.characters[0].baselineY,
  );
}

function paintCaptionHighlightBackground(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  props: TextClipProperties,
  captionProperties: CaptionClipProperties,
  lineCount: number,
): void {
  const { fragment } = placement;
  if (!fragment.token.highlighted || captionProperties.highlight.style !== 'background') return;
  const paddingX = props.fontSize * 0.12;
  const paddingY = lineCount > 1 ? 0 : props.fontSize * 0.08;
  withCaptionFragmentTransform(context, placement, () => {
    context.save();
    context.globalAlpha = captionProperties.highlight.backgroundOpacity;
    context.fillStyle = captionProperties.highlight.backgroundColor;
    roundedRect(context, {
      x: fragment.rect.x - paddingX,
      y: fragment.rect.y - paddingY,
      width: fragment.rect.width + paddingX * 2,
      height: Math.max(1, fragment.rect.height + paddingY * 2),
    }, props.fontSize * 0.12);
    context.fill();
    context.restore();
  });
}

function paintCaptionFragmentShadow(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  props: TextClipProperties,
): void {
  if (!props.shadowEnabled) return;
  withCaptionFragmentTransform(context, placement, () => {
    context.save();
    context.shadowColor = props.shadowColor;
    context.shadowBlur = props.shadowBlur;
    context.shadowOffsetX = props.shadowOffsetX;
    context.shadowOffsetY = props.shadowOffsetY;
    context.fillStyle = props.shadowColor;
    paintCaptionFragmentRun(context, placement.fragment, props, 'fillText');
    context.restore();
  });
}

function paintCaptionFragmentStroke(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  props: TextClipProperties,
): void {
  if (!props.strokeEnabled || props.strokeWidth <= 0) return;
  withCaptionFragmentTransform(context, placement, () => {
    context.strokeStyle = props.strokeColor;
    context.lineWidth = props.strokeWidth * 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    paintCaptionFragmentRun(context, placement.fragment, props, 'strokeText');
  });
}

function paintCaptionFragmentFill(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  props: TextClipProperties,
  captionProperties: CaptionClipProperties,
): void {
  const highlightedText = placement.fragment.token.highlighted
    && captionProperties.highlight.style === 'text';
  withCaptionFragmentTransform(context, placement, () => {
    context.fillStyle = highlightedText
      ? captionProperties.highlight.textColor
      : props.color;
    paintCaptionFragmentRun(context, placement.fragment, props, 'fillText');
  });
}

function paintCaptionFragmentUnderline(
  context: CanvasRenderingContext2D,
  placement: CaptionWordFragmentPlacement,
  props: TextClipProperties,
  captionProperties: CaptionClipProperties,
): void {
  const { fragment } = placement;
  if (!fragment.token.highlighted || captionProperties.highlight.style !== 'underline') return;
  withCaptionFragmentTransform(context, placement, () => {
    const y = fragment.rect.y + fragment.rect.height - Math.max(2, props.fontSize * 0.05);
    context.save();
    context.strokeStyle = captionProperties.highlight.underlineColor;
    context.lineWidth = captionProperties.highlight.underlineWidth;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(fragment.rect.x, y);
    context.lineTo(fragment.rect.x + fragment.rect.width, y);
    context.stroke();
    context.restore();
  });
}

function getCaptionPulseEffectPadding(
  props: TextClipProperties,
  captionProperties: CaptionClipProperties,
): number {
  return Math.max(
    props.fontSize * (captionProperties.highlight.style === 'background' ? 0.18 : 0.08),
    props.strokeEnabled ? props.strokeWidth * 2 : 0,
    props.shadowEnabled
      ? props.shadowBlur + Math.abs(props.shadowOffsetX) + Math.abs(props.shadowOffsetY)
      : 0,
  );
}

function renderWordScalePulse(
  canvas: HTMLCanvasElement,
  props: TextClipProperties,
  document: CaptionTextDocument,
  captionProperties: CaptionClipProperties,
): boolean {
  const scaleEnabled = captionProperties.highlight.scaleEnabled ?? false;
  if (!captionProperties.highlight.enabled || !scaleEnabled || props.pathEnabled) return false;
  const activeRange = document.ranges.find(range => range.token.active);
  if (!activeRange) return false;
  const scale = getCaptionWordPulseScale(
    activeRange.token.progress,
    captionProperties.highlight.scale ?? 1.18,
  );
  if (scale <= 1.001) return false;

  const context = canvas.getContext('2d');
  if (!context) return false;
  const layout = createTextLayoutSnapshot(context, props, canvas.width, canvas.height);
  const fragments = createCaptionWordFragments(layout, document)
    .filter(fragment => fragment.lineIndex < Math.max(1, captionProperties.maxLines));
  const activeFragments = fragments.filter(fragment => fragment.token === activeRange.token);
  const activeLineIndexes = new Set(activeFragments.map(fragment => fragment.lineIndex));
  if (activeFragments.length !== 1 || activeLineIndexes.size !== 1) return false;
  const activeFragment = activeFragments[0];
  const activeRect = activeFragment.rect;
  const activeLineIndex = activeFragment.lineIndex;
  const effectPadding = getCaptionPulseEffectPadding(props, captionProperties);
  const horizontalSpacing = getCaptionWordPulseSpacing(
    activeRect.width + effectPadding * 2,
    scale,
  );
  const verticalSpacing = getCaptionWordPulseSpacing(
    activeRect.height + effectPadding * 2,
    scale,
  );
  const activeCenterX = activeRect.x + activeRect.width / 2;
  const activeCenterY = activeRect.y + activeRect.height / 2;
  const placements = fragments.map<CaptionWordFragmentPlacement>(fragment => {
    const isActive = fragment === activeFragment;
    let translateX = 0;
    let translateY = 0;
    if (fragment.lineIndex < activeLineIndex) {
      translateY = verticalSpacing.previousWordsShift;
    } else if (fragment.lineIndex > activeLineIndex) {
      translateY = verticalSpacing.followingWordsShift;
    } else if (!isActive && fragment.rect.x < activeRect.x) {
      translateX = horizontalSpacing.previousWordsShift;
    } else if (!isActive) {
      translateX = horizontalSpacing.followingWordsShift;
    }
    return {
      fragment,
      translateX,
      translateY,
      scale: isActive ? scale : 1,
      scaleCenterX: activeCenterX,
      scaleCenterY: activeCenterY,
    };
  });

  void googleFontsService.loadFont(props.fontFamily, props.fontWeight);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const fontStyle = props.fontStyle === 'italic' ? 'italic' : 'normal';
  context.font = `${fontStyle} ${props.fontWeight} ${props.fontSize}px "${props.fontFamily}"`;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.globalAlpha = 1;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  for (const placement of placements) {
    paintCaptionHighlightBackground(context, placement, props, captionProperties, layout.lines.length);
  }
  for (const placement of placements) paintCaptionFragmentShadow(context, placement, props);
  for (const placement of placements) paintCaptionFragmentStroke(context, placement, props);
  for (const placement of placements) {
    paintCaptionFragmentFill(context, placement, props, captionProperties);
  }
  for (const placement of placements) {
    paintCaptionFragmentUnderline(context, placement, props, captionProperties);
  }
  markDynamicCanvasUpdated(canvas, 'caption-word-scale');
  return true;
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
  const effectPadding = getCaptionPulseEffectPadding(props, captionProperties);
  const horizontalExpansion = activeRect
    ? (activeRect.width + effectPadding * 2) * (scale - 1) / 2
    : 0;
  const verticalExpansion = activeRect
    ? (activeRect.height + effectPadding * 2) * (scale - 1) / 2
    : 0;
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
  const fullDocument = buildTextDocument(frame?.tokens ?? []);
  const document = selectCaptionDocumentPage(
    canvas,
    baseProperties,
    frame,
    fullDocument,
    captionProperties.maxLines,
  );
  const props: TextClipProperties = { ...baseProperties, text: document.text };
  if (frame) {
    wordEditStateByCanvas.set(canvas, { document, frame, props });
  } else {
    wordEditStateByCanvas.delete(canvas);
  }
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
  const pulseRendered = renderWordScalePulse(canvas, props, document, captionProperties);
  if (!pulseRendered) {
    textRenderer.render(props, canvas);
    renderHighlight(canvas, props, document, captionProperties);
  }
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
