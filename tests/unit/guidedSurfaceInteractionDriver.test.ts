import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GuidedActionRuntime,
  GuidedTargetRegistry,
  registerDomGuidedTargetResolvers,
  type GuidedAction,
  type GuidedTargetRef,
  type GuidedTargetResolver,
} from '../../src/services/guidedActions';
import { useDockStore } from '../../src/stores/dockStore';
import { useGuidedActionStore } from '../../src/stores/guidedActionStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip } from '../helpers/mockData';

describe('guided surface interaction driver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGuidedActionStore();
    useDockStore.getState().resetLayout();
    useTimelineStore.setState({
      clips: [createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10 })],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
    });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    resetGuidedActionStore();
  });

  it('executes high-level panel, selection, playhead, and split resize UI actions', async () => {
    const activatePanel = vi.spyOn(useDockStore.getState(), 'activatePanelType');
    const runtime = new GuidedActionRuntime();

    const resultPromise = startSurfaceSession(runtime, [
      { type: 'focusPanel', panel: 'media' },
      { type: 'selectClip', clipId: 'clip-1' },
      { type: 'setPlayheadVisual', time: 12.5 },
      { type: 'resizePanel', groupId: 'root-split', ratio: 0.4, policy: 'persistUi' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    expect(activatePanel).toHaveBeenCalledWith('media');
    expect(useTimelineStore.getState().selectedClipIds.has('clip-1')).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(12.5);
    expect(useDockStore.getState().layout.root.kind).toBe('split');
    expect(useDockStore.getState().layout.root.kind === 'split' ? useDockStore.getState().layout.root.ratio : null).toBe(0.4);
  });

  it('scrolls virtual timeline time targets into the visible timeline range', async () => {
    const registry = new GuidedTargetRegistry();
    registerDomGuidedTargetResolvers(registry);
    const surface = document.createElement('div');
    surface.setAttribute('data-guided-target', 'timeline-tracks');
    surface.setAttribute('data-guided-timeline-origin-x', '210');
    surface.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: 120,
      width: 500,
      height: 120,
      toJSON: () => ({}),
    });
    document.body.append(surface);
    useGuidedActionStore.setState({
      cursor: {
        visible: true,
        position: { x: 32, y: 48 },
        clicking: false,
        inputGesture: null,
        toolId: null,
      },
    });

    const runtime = new GuidedActionRuntime({ targetRegistry: registry });
    const resultPromise = startSurfaceSession(runtime, [
      { type: 'scrollIntoView', target: { kind: 'timelineTime', time: 20 }, block: 'center' },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    expect(useTimelineStore.getState().scrollX).toBe(855);
    expect(useGuidedActionStore.getState().cursor.position).toEqual({ x: 32, y: 48 });
  });

  it('keeps button presses visual-only unless a UI execution policy is explicit', async () => {
    const button = document.createElement('button');
    const click = vi.fn();
    button.addEventListener('click', click);
    document.body.append(button);

    const runtime = new GuidedActionRuntime({
      targetRegistry: createSingleElementRegistry({ kind: 'button', id: 'apply' }, button),
    });

    const visualOnly = startSurfaceSession(runtime, [
      { type: 'pressButton', target: { kind: 'button', id: 'apply' }, policy: 'visualOnly' },
    ]);
    await vi.runAllTimersAsync();
    await visualOnly;
    expect(click).not.toHaveBeenCalled();

    const persisted = startSurfaceSession(runtime, [
      { type: 'pressButton', target: { kind: 'button', id: 'apply' }, policy: 'persistUi' },
    ]);
    await vi.runAllTimersAsync();
    await persisted;
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('opens timeline tool groups without teleporting or clicking the cursor', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    const target: GuidedTargetRef = { kind: 'button', id: 'timeline-tool-group:cut' };
    const runtime = new GuidedActionRuntime({
      targetRegistry: createSingleElementRegistry(target, button),
    });
    const openListener = vi.fn();
    window.addEventListener('guidedOpenTimelineToolGroup', openListener);
    useGuidedActionStore.setState({
      cursor: {
        visible: true,
        position: { x: 20, y: 25 },
        clicking: false,
        inputGesture: null,
        toolId: null,
      },
    });

    try {
      const resultPromise = startSurfaceSession(runtime, [
        {
          type: 'openTimelineToolGroupVisual',
          groupId: 'cut',
          targetToolId: 'blade',
          target,
        },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(openListener).toHaveBeenCalledOnce();
      expect((openListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(expect.objectContaining({
        groupId: 'cut',
        targetToolId: 'blade',
        anchorElement: button,
      }));
      expect(useGuidedActionStore.getState().cursor).toEqual(expect.objectContaining({
        position: { x: 20, y: 25 },
        clicking: false,
        inputGesture: null,
      }));
    } finally {
      window.removeEventListener('guidedOpenTimelineToolGroup', openListener);
    }
  });

  it('does not open a timeline tool menu when the optional category button is missing', async () => {
    const runtime = new GuidedActionRuntime({
      targetRegistry: new GuidedTargetRegistry(),
    });
    const openListener = vi.fn();
    window.addEventListener('guidedOpenTimelineToolGroup', openListener);

    try {
      const resultPromise = startSurfaceSession(runtime, [
        {
          type: 'openTimelineToolGroupVisual',
          groupId: 'selection',
          targetToolId: 'select',
          target: { kind: 'button', id: 'timeline-tool-group:selection' },
          optional: true,
        },
      ]);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(openListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('guidedOpenTimelineToolGroup', openListener);
    }
  });

  it('draws preview paths through resolved preview points without mutating semantic state', async () => {
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('previewPathVertex', previewVertexResolver, 'test-preview-vertex');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });
    const addPreviewPath = vi.spyOn(useGuidedActionStore.getState(), 'addPreviewPath');

    const resultPromise = startSurfaceSession(runtime, [
      {
        type: 'drawPreviewPath',
        points: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }],
        close: true,
        policy: 'visualOnly',
      },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    expect(addPreviewPath).toHaveBeenCalledWith(expect.objectContaining({
      closed: true,
      points: [{ x: 25, y: 50 }, { x: 75, y: 50 }],
    }));
    expect(useGuidedActionStore.getState().previewPaths).toEqual([]);
    expect(useGuidedActionStore.getState().cursor.position).toEqual({ x: 75, y: 50 });
    expect(useGuidedActionStore.getState().cursor.clicking).toBe(false);
  });

  it('draws mask paths by committing vertices during the cursor clicks', async () => {
    const registry = new GuidedTargetRegistry();
    registry.registerResolver('previewPathVertex', previewVertexResolver, 'test-preview-vertex');
    const runtime = new GuidedActionRuntime({ targetRegistry: registry });

    const resultPromise = startSurfaceSession(runtime, [
      {
        type: 'drawMaskPath',
        clipId: 'clip-1',
        vertices: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 0.75 }],
        close: true,
        mask: { name: 'Incremental mask' },
        policy: 'semanticTool',
      },
    ]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    const mask = useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-1')?.masks?.[0];
    expect(result.status).toBe('completed');
    expect(result.toolResults[0]).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        clipId: 'clip-1',
        incremental: true,
        vertexCount: 3,
      }),
    }));
    expect(mask).toEqual(expect.objectContaining({
      closed: true,
      name: 'Incremental mask',
    }));
    expect(mask?.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }))).toEqual([
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.5, y: 0.75 },
    ]);
  });
});

function startSurfaceSession(runtime: GuidedActionRuntime, actions: GuidedAction[]) {
  return runtime.startSession({
    sessionId: `surface-${Math.random().toString(36).slice(2)}`,
    callerContext: 'internal',
    animationBudget: { totalMs: 1, compression: 'none' },
    actions,
  });
}

function createSingleElementRegistry(target: GuidedTargetRef, element: Element): GuidedTargetRegistry {
  const registry = new GuidedTargetRegistry();
  registry.registerResolver(target.kind, (requestedTarget) => {
    if (JSON.stringify(requestedTarget) !== JSON.stringify(target)) {
      return null;
    }

    return {
      status: 'resolved',
      target: requestedTarget,
      rect: { x: 10, y: 20, width: 100, height: 30 },
      center: { x: 60, y: 35 },
      element,
    };
  }, 'test-element');
  return registry;
}

const previewVertexResolver: GuidedTargetResolver = (target) => {
  if (target.kind !== 'previewPathVertex') {
    return null;
  }

  return {
    status: 'resolved',
    target,
    rect: { x: target.x * 100 - 4, y: target.y * 100 - 4, width: 8, height: 8 },
    center: { x: target.x * 100, y: target.y * 100 },
  };
};

function resetGuidedActionStore(): void {
  useGuidedActionStore.setState({
    activeSession: null,
    currentStep: null,
    cursor: { visible: false, position: null, clicking: false, inputGesture: null },
    dragGhost: null,
    lastUserPointerPosition: null,
    spotlight: null,
    callout: null,
    highlights: [],
    previewPaths: [],
    targetResolutions: {},
    diagnostics: [],
    eventLog: [],
  });
}
