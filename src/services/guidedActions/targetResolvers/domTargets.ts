import type {
  GuidedAction,
  GuidedPoint,
  GuidedRect,
  GuidedTargetMissingReason,
  GuidedTargetRef,
  GuidedTargetResolution,
  GuidedTargetResolver,
} from '../types';
import { type GuidedTargetRegistry } from '../targetRegistry';
import { useTimelineStore } from '../../../stores/timeline';
import { escapeAttr, findElementForTarget, findFirstElement } from './domTargetSelectors';

type ElementTargetKind =
  | 'dom'
  | 'button'
  | 'dropdown'
  | 'dropdownOption'
  | 'maskEdge'
  | 'maskHandle'
  | 'menuItem'
  | 'maskToolbarButton'
  | 'maskVertex'
  | 'mediaItem'
  | 'panel'
  | 'panelEdge'
  | 'propertiesTab'
  | 'propertyControl'
  | 'timelineClip'
  | 'timelineFadeHandle'
  | 'timelineKeyframe'
  | 'timelineMarker'
  | 'timelineTrimHandle';

const ELEMENT_TARGET_KINDS = new Set<string>([
  'dom',
  'button',
  'dropdown',
  'dropdownOption',
  'maskEdge',
  'maskHandle',
  'menuItem',
  'maskToolbarButton',
  'maskVertex',
  'mediaItem',
  'panel',
  'panelEdge',
  'propertiesTab',
  'propertyControl',
  'timelineClip',
  'timelineFadeHandle',
  'timelineKeyframe',
  'timelineMarker',
  'timelineTrimHandle',
]);

const PREVIEW_CONTAINER_SELECTORS = [
  '[data-guided-target="preview"]',
  '[data-guided-panel="preview"]',
  '.preview-canvas-wrapper',
  '.preview-container',
  '.preview-panel',
];

const TIMELINE_SURFACE_SELECTORS = [
  '[data-guided-target="timeline-tracks"]',
  '[data-ai-id="timeline-tracks"]',
  '.timeline-track-stack.timeline-tracks',
  '.timeline-tracks',
];

const TIMELINE_LANE_REFERENCE_SELECTORS = [
  '[data-guided-target="timeline-lane-reference"]',
  '.timeline-lane-reference',
];

const TIMELINE_HEADER_WIDTH_FALLBACK = 210;
const TIMELINE_TIME_TARGET_WIDTH = 8;
const TIMELINE_TIME_TARGET_HEIGHT = 28;

export function registerDomGuidedTargetResolvers(registry: GuidedTargetRegistry): () => void {
  const unregisterElementTargets = [...ELEMENT_TARGET_KINDS].map((kind) => (
    registry.registerResolver(kind as ElementTargetKind, resolveElementBackedTarget, `dom-${kind}`)
  ));
  const unregisterPreviewPoint = registry.registerResolver('previewPoint', resolvePreviewPointTarget, 'dom-preview-point');
  const unregisterPreviewVertex = registry.registerResolver('previewPathVertex', resolvePreviewPointTarget, 'dom-preview-path-vertex');
  const unregisterTimelineTime = registry.registerResolver('timelineTime', resolveTimelineTimeTarget, 'dom-timeline-time');

  return () => {
    unregisterElementTargets.forEach((unregister) => unregister());
    unregisterPreviewPoint();
    unregisterPreviewVertex();
    unregisterTimelineTime();
  };
}

export const resolveElementBackedTarget: GuidedTargetResolver = (
  target,
  _context,
) => {
  if (!ELEMENT_TARGET_KINDS.has(target.kind)) {
    return null;
  }

  const element = findElementForTarget(target);
  if (!element) {
    return missingElementTarget(target);
  }

  return resolutionFromElement(target, element);
};

export const resolvePreviewPointTarget: GuidedTargetResolver = (
  target,
  _context,
) => {
  if (target.kind !== 'previewPoint' && target.kind !== 'previewPathVertex') {
    return null;
  }

  const preview = findFirstElement(PREVIEW_CONTAINER_SELECTORS);
  if (!preview) {
    return {
      status: 'missing',
      target,
      reason: 'not-mounted',
      message: 'Preview surface is not mounted',
      suggestedAction: { type: 'focusPanel', panel: 'preview' },
    };
  }

  const base = resolutionFromElement({ kind: 'panel', panel: 'preview' }, preview);
  if (base.status === 'missing' || !base.rect) {
    return {
      ...base,
      target,
      suggestedAction: { type: 'focusPanel', panel: 'preview' },
    };
  }

  const x = clamp01(target.x);
  const y = clamp01(target.y);
  const point = {
    x: base.rect.x + base.rect.width * x,
    y: base.rect.y + base.rect.height * y,
  };

  return {
    status: 'resolved',
    target,
    rect: {
      x: point.x - 4,
      y: point.y - 4,
      width: 8,
      height: 8,
    },
    point,
    center: point,
    element: preview,
  };
};

export const resolveTimelineTimeTarget: GuidedTargetResolver = (
  target,
  _context,
) => {
  if (target.kind !== 'timelineTime') {
    return null;
  }

  const timelineSurface = findFirstElement(TIMELINE_SURFACE_SELECTORS);
  if (!timelineSurface) {
    return {
      status: 'missing',
      target,
      reason: 'panel-hidden',
      message: 'Timeline surface is not mounted',
      suggestedAction: { type: 'focusPanel', panel: 'timeline' },
    };
  }

  const surfaceRect = rectFromElement(timelineSurface);
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
    return {
      status: 'missing',
      target,
      reason: 'not-mounted',
      message: 'Timeline surface has no visible layout box',
      suggestedAction: { type: 'focusPanel', panel: 'timeline' },
    };
  }

  if (!Number.isFinite(target.time)) {
    return {
      status: 'missing',
      target,
      reason: 'entity-not-found',
      message: 'Timeline time target is not finite',
    };
  }

  const trackElement = target.trackId
    ? findTimelineTrackElement(timelineSurface, target.trackId)
    : null;
  if (target.trackId && !trackElement) {
    return {
      status: 'missing',
      target,
      reason: 'entity-not-found',
      message: `Timeline track "${target.trackId}" is not mounted`,
      suggestedAction: { type: 'focusPanel', panel: 'timeline' },
    };
  }

  const { zoom, scrollX } = useTimelineStore.getState();
  const effectiveZoom = Number.isFinite(zoom) && zoom > 0
    ? zoom
    : readNumberAttribute(timelineSurface, 'data-guided-timeline-zoom') ?? 50;
  const effectiveScrollX = Number.isFinite(scrollX)
    ? scrollX
    : readNumberAttribute(timelineSurface, 'data-guided-timeline-scroll-x') ?? 0;
  const originX = resolveTimelineContentOriginX(timelineSurface, surfaceRect);
  const x = originX + target.time * effectiveZoom - effectiveScrollX;
  const y = resolveTimelineTimeY(timelineSurface, surfaceRect, trackElement);
  const point = { x, y };
  const rect = {
    x: point.x - TIMELINE_TIME_TARGET_WIDTH / 2,
    y: point.y - TIMELINE_TIME_TARGET_HEIGHT / 2,
    width: TIMELINE_TIME_TARGET_WIDTH,
    height: TIMELINE_TIME_TARGET_HEIGHT,
  };

  const viewportRight = surfaceRect.x + surfaceRect.width;
  const viewportBottom = surfaceRect.y + surfaceRect.height;
  const isOutsideTimelineViewport = point.x < originX
    || point.x > viewportRight
    || point.y < surfaceRect.y
    || point.y > viewportBottom;

  if (isOutsideTimelineViewport || isOffscreen(rect)) {
    return {
      status: 'missing',
      target,
      reason: 'offscreen',
      message: 'Timeline time target is outside the visible timeline viewport',
      suggestedAction: {
        type: 'scrollIntoView',
        target,
        block: 'center',
      },
    };
  }

  return {
    status: 'resolved',
    target,
    rect,
    point,
    center: point,
    element: trackElement ?? timelineSurface,
  };
};

export function resolveTargetFromElement(
  target: GuidedTargetRef,
  element: Element,
): GuidedTargetResolution {
  return resolutionFromElement(target, element);
}

function resolutionFromElement(target: GuidedTargetRef, element: Element): GuidedTargetResolution {
  const rect = rectFromElement(element);
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      status: 'missing',
      target,
      reason: 'not-mounted',
      message: 'Guided target has no visible layout box',
    };
  }

  if (target.kind === 'timelineClip') {
    const timelineClipResolution = resolutionFromTimelineClipElement(target, element, rect);
    if (timelineClipResolution) {
      return timelineClipResolution;
    }
  }

  if (isOffscreen(rect)) {
    return {
      status: 'missing',
      target,
      reason: 'offscreen',
      message: 'Guided target is outside the viewport',
      suggestedAction: {
        type: 'scrollIntoView',
        target,
        block: 'center',
      },
    };
  }

  return {
    status: 'resolved',
    target,
    rect,
    center: centerOfRect(rect),
    element,
  };
}

function resolutionFromTimelineClipElement(
  target: Extract<GuidedTargetRef, { kind: 'timelineClip' }>,
  element: Element,
  rect: GuidedRect,
): GuidedTargetResolution | null {
  const timelineSurface = findFirstElement(TIMELINE_SURFACE_SELECTORS);
  if (!timelineSurface) {
    return null;
  }

  const surfaceRect = rectFromElement(timelineSurface);
  if (surfaceRect.width <= 0 || surfaceRect.height <= 0) {
    return null;
  }

  const contentLeft = Math.min(
    Math.max(resolveTimelineContentOriginX(timelineSurface, surfaceRect), surfaceRect.x),
    surfaceRect.x + surfaceRect.width,
  );
  const viewportRect = {
    x: contentLeft,
    y: surfaceRect.y,
    width: Math.max(0, surfaceRect.x + surfaceRect.width - contentLeft),
    height: surfaceRect.height,
  };
  const visibleRect = intersectRects(rect, viewportRect);
  if (!visibleRect || visibleRect.width <= 0 || visibleRect.height <= 0 || isOffscreen(visibleRect)) {
    return {
      status: 'missing',
      target,
      reason: 'offscreen',
      message: 'Timeline clip target is outside the visible timeline viewport',
      suggestedAction: {
        type: 'scrollIntoView',
        target,
        block: 'center',
      },
    };
  }

  return {
    status: 'resolved',
    target,
    rect: visibleRect,
    center: centerOfRect(visibleRect),
    element,
  };
}

function missingElementTarget(target: GuidedTargetRef): GuidedTargetResolution {
  const suggestedAction = getSuggestedActionForMissingTarget(target);
  return {
    status: 'missing',
    target,
    reason: getMissingReason(target),
    message: `Guided target "${target.kind}" is not mounted`,
    suggestedAction,
  };
}

function getSuggestedActionForMissingTarget(target: GuidedTargetRef): GuidedAction | undefined {
  switch (target.kind) {
    case 'panel':
      return { type: 'focusPanel', panel: target.panel };
    case 'propertiesTab':
    case 'propertyControl':
    case 'maskToolbarButton':
    case 'maskEdge':
    case 'maskHandle':
    case 'maskVertex':
      return { type: 'focusPanel', panel: 'clip-properties' };
    case 'timelineClip':
    case 'timelineFadeHandle':
    case 'timelineKeyframe':
    case 'timelineMarker':
    case 'timelineTime':
    case 'timelineTrimHandle':
      return { type: 'focusPanel', panel: 'timeline' };
    case 'mediaItem':
      return { type: 'focusPanel', panel: 'media' };
    case 'button':
    case 'dom':
    case 'dropdown':
    case 'dropdownOption':
    case 'menuItem':
    case 'panelEdge':
    case 'previewPoint':
    case 'previewPathVertex':
      return undefined;
  }
}

function getMissingReason(target: GuidedTargetRef): GuidedTargetMissingReason {
  switch (target.kind) {
    case 'panel':
    case 'propertiesTab':
    case 'propertyControl':
    case 'maskToolbarButton':
    case 'mediaItem':
      return 'panel-hidden';
    case 'maskEdge':
    case 'maskHandle':
    case 'maskVertex':
      return 'entity-not-found';
    case 'timelineClip':
    case 'timelineFadeHandle':
    case 'timelineKeyframe':
    case 'timelineMarker':
    case 'timelineTrimHandle':
      return 'entity-not-found';
    case 'timelineTime':
      return 'panel-hidden';
    case 'button':
    case 'dom':
    case 'dropdown':
    case 'dropdownOption':
    case 'menuItem':
    case 'panelEdge':
    case 'previewPoint':
    case 'previewPathVertex':
      return 'not-mounted';
  }
}

function findTimelineTrackElement(timelineSurface: Element, trackId: string): Element | null {
  const selectors = [
    `[data-guided-track-id="${escapeAttr(trackId)}"]`,
    `[data-track-id="${escapeAttr(trackId)}"]`,
  ];
  for (const selector of selectors) {
    const element = timelineSurface.querySelector(selector) ?? document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function resolveTimelineContentOriginX(timelineSurface: Element, surfaceRect: GuidedRect): number {
  const originElement = findFirstDescendant(timelineSurface, TIMELINE_LANE_REFERENCE_SELECTORS);
  if (originElement) {
    const originRect = rectFromElement(originElement);
    if (Number.isFinite(originRect.x) && originRect.x > 0) {
      return originRect.x;
    }
  }

  const originOffset = readNumberAttribute(timelineSurface, 'data-guided-timeline-origin-x')
    ?? TIMELINE_HEADER_WIDTH_FALLBACK;
  return surfaceRect.x + originOffset;
}

function resolveTimelineTimeY(
  timelineSurface: Element,
  surfaceRect: GuidedRect,
  trackElement: Element | null,
): number {
  const rowElement = trackElement?.querySelector('.track-clip-row') ?? trackElement;
  if (rowElement) {
    const rowRect = rectFromElement(rowElement);
    if (rowRect.height > 0) {
      return rowRect.y + rowRect.height / 2;
    }
  }

  const firstTrack = findFirstDescendant(timelineSurface, [
    '[data-guided-track-id] .track-clip-row',
    '[data-track-id] .track-clip-row',
    '[data-guided-track-id]',
    '[data-track-id]',
  ]);
  if (firstTrack) {
    const firstTrackRect = rectFromElement(firstTrack);
    if (firstTrackRect.height > 0) {
      return firstTrackRect.y + firstTrackRect.height / 2;
    }
  }

  return surfaceRect.y + Math.min(32, surfaceRect.height / 2);
}

function findFirstDescendant(root: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    if (!selector) {
      continue;
    }
    const element = root.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function readNumberAttribute(element: Element, attribute: string): number | null {
  const raw = element.getAttribute(attribute);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function rectFromElement(element: Element): GuidedRect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function centerOfRect(rect: GuidedRect): GuidedPoint {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function intersectRects(a: GuidedRect, b: GuidedRect): GuidedRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function isOffscreen(rect: GuidedRect): boolean {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  return rect.x + rect.width < 0
    || rect.y + rect.height < 0
    || rect.x > viewportWidth
    || rect.y > viewportHeight;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, value));
}
