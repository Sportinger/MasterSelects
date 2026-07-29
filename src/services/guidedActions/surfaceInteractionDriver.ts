import { useGuidedActionStore } from '../../stores/guidedActionStore';
import { FACTORY_START_LAYOUT_ID, useDockStore } from '../../stores/dockStore';
import { useTimelineStore } from '../../stores/timeline';
import { endBatch, startBatch, useHistoryStore } from '../../stores/historyStore';
import type { TimelineToolId } from '../../stores/timeline/types';
import type {
  GuidedAction,
  GuidedMaskPathVertexInput,
  GuidedPoint,
  GuidedTargetRef,
  GuidedTargetResolved,
  SurfaceExecutionPolicy,
  ToolResult,
} from './types';
import type { GuidedActionHandlerContext, GuidedActionHandlerMap } from './runtime';

const TIMELINE_SURFACE_SELECTORS = [
  '[data-guided-target="timeline-tracks"]',
  '[data-ai-id="timeline-tracks"]',
  '.timeline-track-stack.timeline-tracks',
  '.timeline-tracks',
];
const TIMELINE_HEADER_WIDTH_FALLBACK = 210;
const TIMELINE_END_PADDING_FALLBACK = 500;

export interface GuidedSurfaceInteractionResult {
  actionType: GuidedAction['type'];
  executed: boolean;
  message?: string;
  policy: SurfaceExecutionPolicy | 'implicit';
  success: boolean;
}

type GuidedSurfaceDriverResult = GuidedSurfaceInteractionResult | ToolResult;

export function createSurfaceInteractionHandlers(): GuidedActionHandlerMap {
  const driver = new GuidedSurfaceInteractionDriver();
  return {
    chooseDropdownOption: (action, context) => driver.execute(action, context),
    drawMaskPath: (action, context) => driver.execute(action, context),
    drawPreviewPath: (action, context) => driver.execute(action, context),
    focusPanel: (action, context) => driver.execute(action, context),
    openTimelineToolGroupVisual: (action, context) => driver.execute(action, context),
    openDropdown: (action, context) => driver.execute(action, context),
    openPropertiesTab: (action, context) => driver.execute(action, context),
    pressButton: (action, context) => driver.execute(action, context),
    resizePanel: (action, context) => driver.execute(action, context),
    scrollIntoView: (action, context) => driver.execute(action, context),
    selectClip: (action, context) => driver.execute(action, context),
    setPlayheadVisual: (action, context) => driver.execute(action, context),
    setTimelineToolVisual: (action, context) => driver.execute(action, context),
    typeInto: (action, context) => driver.execute(action, context),
  };
}

export class GuidedSurfaceInteractionDriver {
  async execute(
    action: GuidedAction,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceDriverResult> {
    switch (action.type) {
      case 'focusPanel':
        return this.focusPanel(action.panel);
      case 'openTimelineToolGroupVisual':
        return this.openTimelineToolGroup(action, context);
      case 'openPropertiesTab':
        return this.openPropertiesTab(action.tab);
      case 'selectClip':
        return this.selectClip(action.clipId);
      case 'setPlayheadVisual':
        return this.setPlayhead(action.time);
      case 'setTimelineToolVisual':
        return this.setTimelineTool(action.toolId);
      case 'scrollIntoView':
        return this.scrollIntoView(action.target, action.block, context);
      case 'resizePanel':
        return this.resizePanel(action, context);
      case 'pressButton':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'openDropdown':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'chooseDropdownOption':
        return this.clickTarget(action.type, action.target, action.policy, context);
      case 'typeInto':
        return this.typeInto(action.target, action.text, action.policy, context);
      case 'drawPreviewPath':
        return this.drawPreviewPath(action, context);
      case 'drawMaskPath':
        return this.drawMaskPath(action, context);
      default:
        return {
          actionType: action.type,
          executed: false,
          message: `Unsupported surface action ${action.type}`,
          policy: 'implicit',
          success: false,
        };
    }
  }

  private focusPanel(panel: Extract<GuidedAction, { type: 'focusPanel' }>['panel']): GuidedSurfaceInteractionResult {
    if (startFacadeIsActive()) return success('focusPanel', false, 'implicit');
    useDockStore.getState().activatePanelType(panel);
    return success('focusPanel', true, 'implicit');
  }

  private async openTimelineToolGroup(
    action: Extract<GuidedAction, { type: 'openTimelineToolGroupVisual' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    if (startFacadeIsActive()) {
      return success('openTimelineToolGroupVisual', false, 'implicit');
    }
    const target = action.target ?? {
      kind: 'button' as const,
      id: `timeline-tool-group:${action.groupId}`,
    };
    let anchorElement: HTMLButtonElement | null = null;

    const resolution = await context.resolveTarget(target);
    if (resolution.status === 'missing') {
      if (!action.optional) {
        return fail(
          'openTimelineToolGroupVisual',
          resolution.message ?? `Missing timeline tool group target: ${resolution.reason}`,
          'implicit',
          context,
        );
      }
      return success('openTimelineToolGroupVisual', false, 'implicit');
    } else {
      if (resolution.element instanceof HTMLButtonElement) {
        anchorElement = resolution.element;
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('guidedOpenTimelineToolGroup', {
        detail: {
          groupId: action.groupId,
          targetToolId: action.targetToolId,
          anchorElement,
        },
      }));
    }
    return success('openTimelineToolGroupVisual', true, 'implicit');
  }

  private openPropertiesTab(tab: string): GuidedSurfaceInteractionResult {
    if (startFacadeIsActive()) return success('openPropertiesTab', false, 'implicit');
    useDockStore.getState().activatePanelType('clip-properties');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
    }
    return success('openPropertiesTab', true, 'implicit');
  }

  private selectClip(clipId: string): GuidedSurfaceInteractionResult {
    useTimelineStore.getState().selectClip(clipId);
    return success('selectClip', true, 'implicit');
  }

  private setPlayhead(time: number): GuidedSurfaceInteractionResult {
    useTimelineStore.getState().setPlayheadPosition(time);
    return success('setPlayheadVisual', true, 'implicit');
  }

  private setTimelineTool(toolId: Extract<GuidedAction, { type: 'setTimelineToolVisual' }>['toolId']): GuidedSurfaceInteractionResult {
    const timeline = useTimelineStore.getState();
    timeline.setActiveTimelineTool(toolId);
    timeline.setOpenTimelineToolGroup(null);
    timeline.setTimelineToolPreview(null);
    useGuidedActionStore.getState().setCursor({ toolId: getGuidedCursorToolId(toolId) });
    return success('setTimelineToolVisual', true, 'implicit');
  }

  private async scrollIntoView(
    target: GuidedTargetRef,
    block: Extract<GuidedAction, { type: 'scrollIntoView' }>['block'],
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    if (target.kind === 'timelineTime') {
      return this.scrollTimelineTimeIntoView(target);
    }

    const resolution = await requireResolvedTarget(target, context);
    if (!resolution.element) {
      return fail('scrollIntoView', 'Resolved target has no DOM element', 'implicit', context);
    }

    resolution.element.scrollIntoView({ block: block ?? 'center', inline: 'nearest' });
    useTimelineStore.getState().setTimelineToolPreview(null);
    return success('scrollIntoView', true, 'implicit');
  }

  private async scrollTimelineTimeIntoView(
    target: Extract<GuidedTargetRef, { kind: 'timelineTime' }>,
  ): Promise<GuidedSurfaceInteractionResult> {
    const timeline = useTimelineStore.getState();
    const zoom = Number.isFinite(timeline.zoom) && timeline.zoom > 0 ? timeline.zoom : 50;
    const surface = findFirstElement(TIMELINE_SURFACE_SELECTORS);
    const surfaceRect = surface?.getBoundingClientRect();
    const originOffset = surface
      ? readNumberAttribute(surface, 'data-guided-timeline-origin-x') ?? TIMELINE_HEADER_WIDTH_FALLBACK
      : TIMELINE_HEADER_WIDTH_FALLBACK;
    const visibleWidth = Math.max(
      1,
      surfaceRect ? surfaceRect.width - originOffset : 600,
    );
    const desiredScrollX = Math.max(0, target.time * zoom - visibleWidth / 2);
    const maxScrollX = Math.max(
      0,
      timeline.duration * zoom - visibleWidth + TIMELINE_END_PADDING_FALLBACK,
    );

    timeline.setScrollX(Math.min(desiredScrollX, maxScrollX));
    timeline.setTimelineToolPreview(null);

    return success('scrollIntoView', true, 'implicit');
  }

  private async resizePanel(
    action: Extract<GuidedAction, { type: 'resizePanel' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const policy = action.policy ?? 'visualOnly';
    if (startFacadeIsActive()) return success('resizePanel', false, policy);
    if (action.visualTarget) {
      const resolution = await requireResolvedTarget(action.visualTarget, context);
      useGuidedActionStore.getState().setCursor({ visible: true, position: resolution.center, toolId: getGuidedCursorToolId() });
    }

    if (!shouldExecuteUiPolicy(policy)) {
      return success('resizePanel', false, policy);
    }

    const dock = useDockStore.getState();
    const previousRatio = findSplitRatio(dock.layout.root, action.groupId);
    dock.setSplitRatio(action.groupId, action.ratio);

    if (policy === 'transientUi' && previousRatio !== null) {
      scheduleTransientRestore(context, () => {
        useDockStore.getState().setSplitRatio(action.groupId, previousRatio);
      });
    }

    return success('resizePanel', true, policy);
  }

  private async clickTarget(
    actionType: GuidedAction['type'],
    target: GuidedTargetRef,
    policy: SurfaceExecutionPolicy | undefined,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const normalizedPolicy = policy ?? 'visualOnly';
    const resolution = await requireResolvedTarget(target, context);
    const store = useGuidedActionStore.getState();
    store.setCursor({
      visible: true,
      position: resolution.center,
      clicking: true,
      inputGesture: { kind: 'mouse-left', label: 'LMB', detail: actionType },
      toolId: getGuidedCursorToolId(),
    });

    if (!shouldExecuteUiPolicy(normalizedPolicy)) {
      return success(actionType, false, normalizedPolicy);
    }

    const clickable = resolution.element;
    if (!(clickable instanceof HTMLElement)) {
      return fail(actionType, 'Resolved target cannot be clicked safely', normalizedPolicy, context);
    }

    clickable.click();
    return success(actionType, true, normalizedPolicy);
  }

  private async typeInto(
    target: GuidedTargetRef,
    text: string,
    policy: SurfaceExecutionPolicy | undefined,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const normalizedPolicy = policy ?? 'visualOnly';
    const resolution = await requireResolvedTarget(target, context);
    useGuidedActionStore.getState().setCursor({
      visible: true,
      position: resolution.center,
      clicking: true,
      inputGesture: { kind: 'keyboard', label: 'Type', detail: text.length > 12 ? `${text.slice(0, 12)}...` : text },
      toolId: getGuidedCursorToolId(),
    });

    if (!shouldExecuteUiPolicy(normalizedPolicy)) {
      return success('typeInto', false, normalizedPolicy);
    }

    const input = resolution.element;
    if (!isTextInputElement(input)) {
      return fail('typeInto', 'Resolved target is not a text input', normalizedPolicy, context);
    }

    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    return success('typeInto', true, normalizedPolicy);
  }

  private async drawPreviewPath(
    action: Extract<GuidedAction, { type: 'drawPreviewPath' }>,
    context: GuidedActionHandlerContext,
  ): Promise<GuidedSurfaceInteractionResult> {
    const resolvedPoints: GuidedPoint[] = [];
    for (const [index, point] of action.points.entries()) {
      const resolution = await requireResolvedTarget({
        kind: 'previewPathVertex',
        x: point.x,
        y: point.y,
        index,
      }, context);
      resolvedPoints.push(resolution.center);
    }

    useGuidedActionStore.getState().addPreviewPath({
      points: resolvedPoints,
      closed: action.close ?? false,
      durationMs: context.scheduledAction.plannedDurationMs,
    });

    scheduleCursorPathAnimation(
      resolvedPoints,
      context.scheduledAction.plannedDurationMs,
      context.signal,
    );

    return success('drawPreviewPath', action.policy !== 'visualOnly', action.policy ?? 'visualOnly');
  }

  private async drawMaskPath(
    action: Extract<GuidedAction, { type: 'drawMaskPath' }>,
    context: GuidedActionHandlerContext,
  ): Promise<ToolResult> {
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === action.clipId);
    if (!clip) {
      return { success: false, error: `Clip not found: ${action.clipId}` };
    }

    const resolvedPoints: GuidedPoint[] = [];
    for (const [index, vertex] of action.vertices.entries()) {
      const target: GuidedTargetRef = {
        kind: 'previewPathVertex',
        x: vertex.x,
        y: vertex.y,
        index,
      };
      const resolution = await context.resolveTarget(target);
      resolvedPoints.push(resolution.status === 'resolved'
        ? resolution.center
        : getFallbackPreviewPoint(vertex, index));
    }

    useGuidedActionStore.getState().addPreviewPath({
      points: resolvedPoints,
      closed: action.close ?? false,
      durationMs: context.scheduledAction.plannedDurationMs,
    });

    const alreadyBatching = useHistoryStore.getState().batchId !== null;
    if (!alreadyBatching) {
      startBatch('AI: addMask');
    }

    const timeline = useTimelineStore.getState();
    const maskId = timeline.addMask(action.clipId, {
      ...(action.mask ?? {}),
      closed: false,
      vertices: [],
    } as never);

    const committedVertexIndices = new Set<number>();
    const commitVertex = (index: number) => {
      if (committedVertexIndices.has(index)) {
        return;
      }
      const vertex = action.vertices[index];
      if (!vertex) {
        return;
      }
      committedVertexIndices.add(index);
      useTimelineStore.getState().addVertex(action.clipId, maskId, toTimelineMaskVertex(vertex), index);
    };
    const finishMask = () => {
      try {
        if (action.close !== false) {
          useTimelineStore.getState().closeMask(action.clipId, maskId);
        }
      } finally {
        if (!alreadyBatching) {
          endBatch();
        }
      }
    };

    scheduleCursorPathAnimation(
      resolvedPoints,
      context.scheduledAction.plannedDurationMs,
      context.signal,
      commitVertex,
      finishMask,
      () => {
        if (!alreadyBatching) {
          endBatch();
        }
      },
    );

    return {
      success: true,
      data: {
        clipId: action.clipId,
        incremental: true,
        maskId,
        vertexCount: action.vertices.length,
      },
    };
  }
}

function scheduleCursorPathAnimation(
  points: GuidedPoint[],
  durationMs: number,
  signal: AbortSignal,
  onVertex?: (index: number, point: GuidedPoint) => void,
  onComplete?: () => void,
  onCancel?: () => void,
): void {
  if (points.length === 0 || signal.aborted) {
    onComplete?.();
    return;
  }

  if (durationMs <= 0) {
    for (const [index, point] of points.entries()) {
      useGuidedActionStore.getState().setCursor({
        visible: true,
        position: point,
        clicking: true,
        transitionMs: 0,
      });
      onVertex?.(index, point);
    }
    useGuidedActionStore.getState().setCursor({ clicking: false, transitionMs: 0 });
    onComplete?.();
    return;
  }

  const timers = new Set<ReturnType<typeof globalThis.setTimeout>>();
  const clearTimers = () => {
    for (const timer of timers) {
      globalThis.clearTimeout(timer);
    }
    timers.clear();
    signal.removeEventListener('abort', clearTimers);
    onCancel?.();
  };
  const schedule = (delayMs: number, callback: () => void) => {
    const timer: ReturnType<typeof globalThis.setTimeout> = globalThis.setTimeout(() => {
      timers.delete(timer);
      if (!signal.aborted) {
        callback();
      }
      if (timers.size === 0) {
        signal.removeEventListener('abort', clearTimers);
      }
    }, Math.max(0, delayMs));
    timers.add(timer);
  };
  const pulseClick = (point: GuidedPoint) => {
    const store = useGuidedActionStore.getState();
    store.setCursor({ visible: true, position: point, clicking: true, transitionMs: 0 });
    schedule(120, () => {
      useGuidedActionStore.getState().setCursor({ clicking: false, transitionMs: 0 });
    });
  };
  const commitPulse = (index: number, point: GuidedPoint) => {
    pulseClick(point);
    onVertex?.(index, point);
  };

  signal.addEventListener('abort', clearTimers, { once: true });

  const firstPoint = points[0]!;
  useGuidedActionStore.getState().setCursor({
    visible: true,
    position: firstPoint,
    clicking: false,
    transitionMs: 0,
  });
  commitPulse(0, firstPoint);

  if (points.length === 1) {
    schedule(120, () => onComplete?.());
    return;
  }

  const totalMs = Math.max(0, durationMs);
  const initialHoldMs = Math.min(160, Math.round(totalMs * 0.14));
  const segmentCount = points.length - 1;
  const segmentMs = segmentCount > 0
    ? Math.max(0, (totalMs - initialHoldMs) / segmentCount)
    : 0;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const moveDelayMs = initialHoldMs + (index - 1) * segmentMs;
    const arrivalDelayMs = initialHoldMs + index * segmentMs;

    schedule(moveDelayMs, () => {
      useGuidedActionStore.getState().setCursor({
        visible: true,
        position: point,
        clicking: false,
        transitionMs: segmentMs,
      });
    });
    schedule(arrivalDelayMs, () => commitPulse(index, point));
  }
  schedule(totalMs, () => onComplete?.());
}

function toTimelineMaskVertex(vertex: GuidedMaskPathVertexInput) {
  return {
    x: vertex.x,
    y: vertex.y,
    handleIn: vertex.handleIn ?? { x: 0, y: 0 },
    handleOut: vertex.handleOut ?? { x: 0, y: 0 },
    handleMode: vertex.handleMode,
  };
}

function getFallbackPreviewPoint(vertex: GuidedMaskPathVertexInput, index: number): GuidedPoint {
  const cursorPosition = useGuidedActionStore.getState().cursor.position;
  if (cursorPosition) {
    return {
      x: cursorPosition.x + index * 8,
      y: cursorPosition.y + index * 8,
    };
  }

  if (typeof window !== 'undefined') {
    return {
      x: window.innerWidth * Math.max(0, Math.min(1, vertex.x)),
      y: window.innerHeight * Math.max(0, Math.min(1, vertex.y)),
    };
  }

  return { x: vertex.x * 100, y: vertex.y * 100 };
}

async function requireResolvedTarget(
  target: GuidedTargetRef,
  context: GuidedActionHandlerContext,
): Promise<GuidedTargetResolved> {
  const resolution = await context.resolveTarget(target);
  if (resolution.status === 'missing') {
    throw new Error(resolution.message ?? `Missing guided surface target: ${resolution.reason}`);
  }
  return resolution;
}

function success(
  actionType: GuidedAction['type'],
  executed: boolean,
  policy: SurfaceExecutionPolicy | 'implicit',
): GuidedSurfaceInteractionResult {
  return {
    actionType,
    executed,
    policy,
    success: true,
  };
}

function fail(
  actionType: GuidedAction['type'],
  message: string,
  policy: SurfaceExecutionPolicy | 'implicit',
  context: GuidedActionHandlerContext,
): GuidedSurfaceInteractionResult {
  useGuidedActionStore.getState().appendDiagnostic(context.session.id, message, {
    actionType,
    policy,
  });
  context.emitEvent({
    type: 'diagnostic',
    sessionId: context.session.id,
    message,
    data: { actionType, policy },
  });
  return {
    actionType,
    executed: false,
    message,
    policy,
    success: false,
  };
}

function shouldExecuteUiPolicy(policy: SurfaceExecutionPolicy): boolean {
  return policy === 'persistUi' || policy === 'transientUi';
}

function startFacadeIsActive(): boolean {
  return useDockStore.getState().activeSavedLayoutId === FACTORY_START_LAYOUT_ID;
}

function getGuidedCursorToolId(
  toolId: TimelineToolId = useTimelineStore.getState().activeTimelineToolId,
): TimelineToolId | null {
  return toolId === 'select' ? null : toolId;
}

function isTextInputElement(element: Element | undefined): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function findFirstElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
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

function scheduleTransientRestore(context: GuidedActionHandlerContext, restore: () => void): void {
  const timeoutMs = Math.max(0, context.scheduledAction.plannedDurationMs);
  const timer = globalThis.setTimeout(() => {
    context.signal.removeEventListener('abort', onAbort);
    restore();
  }, timeoutMs);

  const onAbort = () => {
    globalThis.clearTimeout(timer);
    restore();
  };

  context.signal.addEventListener('abort', onAbort, { once: true });
}

type DockLayoutNode = ReturnType<typeof useDockStore.getState>['layout']['root'];

function findSplitRatio(node: DockLayoutNode, splitId: string): number | null {
  if (node.kind === 'split' && node.id === splitId) {
    return node.ratio;
  }

  if (node.kind === 'split') {
    return findSplitRatio(node.children[0], splitId) ?? findSplitRatio(node.children[1], splitId);
  }

  return null;
}
