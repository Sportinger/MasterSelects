import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  getGuidedActionRuntime,
  getGuidedTargetKey,
  guidedTargetRegistry,
  type GuidedAction,
  type GuidedInputGesture,
  type GuidedPoint,
  type GuidedTargetRef,
  type GuidedTargetResolution,
  type GuidedSessionRequest,
  type GuidedSessionResult,
} from '../../../services/guidedActions';
import { useDockStore } from '../../../stores/dockStore';
import { cloneDockLayout } from '../../../stores/dockStore/layoutPersistence';
import {
  findPanelAndGroup,
  findTabGroupById,
} from '../../../stores/dockStore/layoutTree';
import { useGuidedActionStore } from '../../../stores/guidedActionStore';
import { startBatch, useHistoryStore } from '../../../stores/historyStore';
import type { DockLayout, DropTarget } from '../../../types/dock';
import { findNodeById } from '../../../utils/dockLayout';
import {
  TIMELINE_BASICS_TUTORIAL_ID,
  type InteractiveCampaign,
  type InteractiveCursorDemo,
} from './interactiveCampaigns';
import { registerTutorialNavigationController } from './tutorialNavigationController';
import {
  createTimelineTutorialSandbox,
  type TimelineTutorialSandbox,
} from './timelineTutorialSandbox';

interface InteractiveTutorialOverlayProps {
  campaign: InteractiveCampaign;
  onCancel: () => void;
  onClose: () => void;
  onSkip: () => void;
}

const WAIT_FOR_NAVIGATION_ACTION: GuidedAction = {
  type: 'waitForTutorialNavigation',
  family: 'validation',
  label: 'Wait for tutorial navigation',
};

export function InteractiveTutorialOverlay({
  campaign,
  onCancel,
  onClose,
  onSkip,
}: InteractiveTutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const tutorialInstanceId = useId();
  const sessionIdRef = useRef(`guided-tutorial-${campaign.id}-${tutorialInstanceId}`);
  const chapterFinishingRef = useRef(false);
  const sessionResultPromiseRef = useRef<Promise<GuidedSessionResult> | null>(null);
  const timelineSandboxRef = useRef<TimelineTutorialSandbox | null>(null);
  const stepCount = campaign.steps.length;

  useEffect(() => {
    if (campaign.id !== TIMELINE_BASICS_TUTORIAL_ID) return;
    const sandbox = createTimelineTutorialSandbox();
    timelineSandboxRef.current = sandbox;
    return () => {
      sandbox.cleanup();
      if (timelineSandboxRef.current === sandbox) {
        timelineSandboxRef.current = null;
      }
    };
  }, [campaign.id]);

  const finishChapter = useCallback(() => {
    if (chapterFinishingRef.current) return;
    chapterFinishingRef.current = true;

    const runtime = getGuidedActionRuntime();
    const sessionResult = sessionResultPromiseRef.current;
    runtime.cancelSession(sessionIdRef.current, 'Tutorial chapter completed');
    timelineSandboxRef.current?.cleanup();

    // The runtime owns one global guided session. Wait until this chapter has
    // fully released it before App mounts the next chapter, otherwise the new
    // session is rejected as "already running" and the walkthrough stops.
    if (sessionResult) {
      void sessionResult.then(onClose, onClose);
    } else {
      window.setTimeout(onClose, 0);
    }
  }, [onClose]);

  const goForward = useCallback(() => {
    if (stepIndex >= stepCount - 1) {
      finishChapter();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, stepCount - 1));
  }, [finishChapter, stepCount, stepIndex]);

  const goBack = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => registerTutorialNavigationController({
    next: goForward,
    previous: goBack,
  }), [goBack, goForward]);

  useEffect(() => {
    const sessionId = sessionIdRef.current;
    const runtime = getGuidedActionRuntime();
    const firstStep = campaign.steps[0];
    const request: GuidedSessionRequest = {
      actions: [WAIT_FOR_NAVIGATION_ACTION],
      animationBudget: campaign.animationBudgetMs ?? 900,
      callerContext: 'internal',
      inputLock: { mode: 'locked', allowCancel: true },
      label: `Tutorial: ${campaign.title}`,
      metadata: {
        ...campaign.metadata,
        scenarioId: campaign.id,
        tutorialProgress: {
          current: 1,
          stepTitle: firstStep?.title ?? campaign.title,
          total: stepCount,
        },
      },
      playbackMode: 'tutorialDemo',
      sessionId,
      visualizationMode: campaign.visualizationMode ?? 'concise',
    };
    let disposed = false;

    const sessionResult = runtime.startSession(request);
    sessionResultPromiseRef.current = sessionResult;
    void sessionResult.then((result) => {
      if (disposed || chapterFinishingRef.current) return;
      switch (result.status) {
        case 'completed':
          onClose();
          return;
        case 'skipped':
          onSkip();
          return;
        case 'cancelled':
        case 'failed':
          onCancel();
          return;
      }
    }).finally(() => {
      if (sessionResultPromiseRef.current === sessionResult) {
        sessionResultPromiseRef.current = null;
      }
    });

    return () => {
      disposed = true;
      runtime.cancelSession(sessionId, 'Interactive tutorial closed');
    };
  }, [campaign, onCancel, onClose, onSkip, stepCount]);

  useEffect(() => {
    const step = campaign.steps[stepIndex];
    if (!step) return;

    const sessionId = sessionIdRef.current;
    const store = useGuidedActionStore.getState();
    const timelineSandbox = timelineSandboxRef.current;
    const stepHistoryBatch = startBatch(`Tutorial: ${campaign.id}/${step.id}`);
    const ownedStepHistoryBatchId = stepHistoryBatch.opened
      ? stepHistoryBatch.batchId
      : null;
    const restoreStepDockLayout = createDockLayoutRestore(
      cloneDockLayout(useDockStore.getState().layout),
    );
    const runtimeTarget = resolveTutorialTarget(step.target, timelineSandbox);
    const runtimeCursorDemo = resolveTutorialCursorDemo(step.cursorDemo, timelineSandbox);
    const gestureAction = step.actions?.find((action) => action.type === 'showInputGesture');
    const cursorMoveAction = step.actions?.find((action) => action.type === 'moveCursorTo');
    const cursorTarget = cursorMoveAction?.type === 'moveCursorTo'
      ? resolveTutorialTarget(cursorMoveAction.target, timelineSandbox)
      : gestureAction?.type === 'showInputGesture'
        ? runtimeTarget
        : undefined;

    store.setCursor({
      clicking: false,
      dragging: false,
      inputGesture: null,
      visible: false,
    });
    store.setDragGhost(null);
    store.clearHighlights();
    store.updateSessionMetadata(sessionId, {
      tutorialProgress: {
        current: stepIndex + 1,
        stepTitle: step.title,
        total: stepCount,
      },
    });

    const panelToFocus = step.focusPanel
      ?? (step.target?.kind === 'panel' ? step.target.panel : null);
    if (panelToFocus) {
      useDockStore.getState().activatePanelType(panelToFocus);
    }
    timelineSandbox?.prepareStep(step.id);

    let disposed = false;
    const restoreSlot: { current: (() => void) | null } = { current: null };
    const updatePresentation = async () => {
      await nextAnimationFrame();
      if (timelineSandbox) await nextAnimationFrame();
      if (disposed) return;

      const resolutions = new Map<string, GuidedTargetResolution>();
      for (const target of uniqueTargets(
        runtimeTarget,
        cursorTarget,
        ...getCursorDemoTargets(runtimeCursorDemo),
      )) {
        const registryResolution = await guidedTargetRegistry.resolve(target, {
          sessionId,
          nowMs: Date.now(),
        });
        if (disposed || useGuidedActionStore.getState().activeSession?.id !== sessionId) return;
        const fallbackPoint = registryResolution.status === 'missing'
          ? resolveCursorFallbackPoint(target, timelineSandbox)
          : null;
        const resolution: GuidedTargetResolution = fallbackPoint
          ? {
              status: 'resolved',
              target,
              center: fallbackPoint,
              point: fallbackPoint,
              rect: {
                x: fallbackPoint.x - 6,
                y: fallbackPoint.y - 14,
                width: 12,
                height: 28,
              },
            }
          : registryResolution;
        resolutions.set(getGuidedTargetKey(target), resolution);
        useGuidedActionStore.getState().recordTargetResolution(resolution);
      }

      if (disposed || useGuidedActionStore.getState().activeSession?.id !== sessionId) return;
      useGuidedActionStore.getState().setSpotlight(runtimeTarget ?? null);
      useGuidedActionStore.getState().setCallout({
        title: step.title,
        body: step.body,
        target: runtimeTarget,
      });

      if (runtimeCursorDemo && gestureAction?.type === 'showInputGesture') {
        void runCursorDemo({
          demo: runtimeCursorDemo,
          gesture: gestureAction.gesture,
          isActive: () => (
            !disposed
            && !timelineSandbox?.isDisposed()
            && useGuidedActionStore.getState().activeSession?.id === sessionId
          ),
          resolutions,
          restoreSlot,
          timelineSandbox,
        });
      } else if (cursorTarget && gestureAction?.type === 'showInputGesture') {
        const resolution = resolutions.get(getGuidedTargetKey(cursorTarget));
        if (resolution?.status === 'resolved') {
          useGuidedActionStore.getState().setCursor({
            inputGesture: gestureAction.gesture,
            position: resolution.center,
            transitionMs: 520,
            visible: true,
          });
        }
      }
    };

    void updatePresentation();
    return () => {
      disposed = true;
      restoreSlot.current?.();
      restoreSlot.current = null;
      restoreStepDockLayout();
      if (
        ownedStepHistoryBatchId !== null
        && useHistoryStore.getState().batchId === ownedStepHistoryBatchId
      ) {
        useHistoryStore.getState().cancelBatch();
      }
      const currentStore = useGuidedActionStore.getState();
      currentStore.setCursor({
        clicking: false,
        dragging: false,
        inputGesture: null,
        visible: false,
      });
      currentStore.setDragGhost(null);
      currentStore.clearHighlights();
    };
  }, [campaign, stepCount, stepIndex]);

  return null;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function uniqueTargets(
  ...targets: Array<GuidedTargetRef | undefined>
): GuidedTargetRef[] {
  const byKey = new Map<string, GuidedTargetRef>();
  for (const target of targets) {
    if (target) byKey.set(getGuidedTargetKey(target), target);
  }
  return [...byKey.values()];
}

function resolveTutorialTarget(
  target: GuidedTargetRef | undefined,
  timelineSandbox: TimelineTutorialSandbox | null,
): GuidedTargetRef | undefined {
  if (!target || !timelineSandbox) return target;
  return timelineSandbox.resolveTarget(target);
}

function resolveTutorialCursorDemo(
  demo: InteractiveCursorDemo | undefined,
  timelineSandbox: TimelineTutorialSandbox | null,
): InteractiveCursorDemo | undefined {
  if (!demo || !timelineSandbox) return demo;
  switch (demo.kind) {
    case 'drag-between':
    case 'timeline-media-drop':
    case 'timeline-scrub':
    case 'timeline-clip-move':
      return {
        ...demo,
        from: timelineSandbox.resolveTarget(demo.from),
        to: timelineSandbox.resolveTarget(demo.to),
      };
    case 'resize-edge':
    case 'corner-orbit':
    case 'timeline-playback':
    case 'timeline-clip-trim':
      return {
        ...demo,
        target: timelineSandbox.resolveTarget(demo.target),
      };
  }
}

function getCursorDemoTargets(
  demo: InteractiveCursorDemo | undefined,
): GuidedTargetRef[] {
  if (!demo) return [];
  if (
    demo.kind === 'drag-between'
    || demo.kind === 'timeline-media-drop'
    || demo.kind === 'timeline-scrub'
    || demo.kind === 'timeline-clip-move'
  ) {
    return [demo.from, demo.to];
  }
  return [demo.target];
}

async function runCursorDemo({
  demo,
  gesture,
  isActive,
  resolutions,
  restoreSlot,
  timelineSandbox,
}: {
  demo: InteractiveCursorDemo;
  gesture: GuidedInputGesture;
  isActive: () => boolean;
  resolutions: Map<string, GuidedTargetResolution>;
  restoreSlot: { current: (() => void) | null };
  timelineSandbox: TimelineTutorialSandbox | null;
}): Promise<void> {
  const guidedStore = useGuidedActionStore.getState();
  const startTarget = getCursorDemoStartTarget(demo);
  const startResolution = resolutions.get(getGuidedTargetKey(startTarget));
  const start = startResolution?.status === 'resolved'
    ? startResolution.center
    : resolveCursorFallbackPoint(startTarget, timelineSandbox);
  if (!start) return;
  const endResolution = hasCursorDemoEndTarget(demo)
    ? resolutions.get(getGuidedTargetKey(demo.to))
    : null;
  const end = hasCursorDemoEndTarget(demo)
    ? endResolution?.status === 'resolved'
      ? endResolution.center
      : resolveCursorFallbackPoint(demo.to, timelineSandbox)
    : null;
  if (hasCursorDemoEndTarget(demo) && !end) return;

  while (isActive()) {
    const approach = clampPointToViewport({
      x: start.x - 92,
      y: start.y - 58,
    });
    guidedStore.setCursor({
      clicking: false,
      dragging: false,
      inputGesture: gesture,
      position: approach,
      transitionMs: 0,
      visible: true,
    });
    if (!await waitWhileActive(80, isActive)) return;

    guidedStore.setCursor({ position: start, transitionMs: 620 });
    if (!await waitWhileActive(700, isActive)) return;

    if (demo.kind === 'timeline-playback') {
      if (!timelineSandbox) return;
      const restoreTimeline = timelineSandbox.captureTransientRestore();
      restoreSlot.current = restoreTimeline;
      guidedStore.setSpotlight(null);
      try {
        guidedStore.setCursor({ clicking: true, transitionMs: 0 });
        if (!await waitWhileActive(220, isActive)) return;
        guidedStore.setCursor({ clicking: false, transitionMs: 0 });
        await timelineSandbox.play();
        if (!await waitWhileActive(1100, isActive)) return;
        guidedStore.setCursor({ clicking: true, transitionMs: 0 });
        if (!await waitWhileActive(220, isActive)) return;
        timelineSandbox.pause();
        guidedStore.setCursor({ clicking: false, transitionMs: 0 });
      } finally {
        restoreTimeline();
        if (restoreSlot.current === restoreTimeline) restoreSlot.current = null;
      }
      if (!await finishCursorDemoLoop(startTarget, isActive)) return;
      continue;
    }

    guidedStore.setCursor({ clicking: true, transitionMs: 0 });
    if (!await waitWhileActive(220, isActive)) return;
    guidedStore.setCursor({ clicking: false, dragging: true, transitionMs: 0 });

    const isDockDemo = demo.kind === 'drag-between'
      || demo.kind === 'resize-edge'
      || demo.kind === 'corner-orbit';
    const layoutSnapshot = isDockDemo
      ? cloneDockLayout(useDockStore.getState().layout)
      : null;
    guidedStore.setSpotlight(null);
    const restoreDemoState = layoutSnapshot
      ? createDockLayoutRestore(layoutSnapshot)
      : timelineSandbox?.captureTransientRestore() ?? null;
    restoreSlot.current = restoreDemoState;

    try {
      if (demo.kind === 'drag-between' && endResolution?.status === 'resolved' && layoutSnapshot) {
        await performRealPanelRoundTrip({
          demo,
          endResolution,
          isActive,
          layoutSnapshot,
          start,
        });
      } else if (
        demo.kind === 'resize-edge'
        && layoutSnapshot
        && startResolution?.status === 'resolved'
      ) {
        await performRealEdgeResize({
          demo,
          isActive,
          layoutSnapshot,
          start,
          startResolution,
        });
      } else if (
        demo.kind === 'corner-orbit'
        && layoutSnapshot
        && startResolution?.status === 'resolved'
      ) {
        await performRealCornerResize({
          demo,
          isActive,
          layoutSnapshot,
          start,
          startResolution,
        });
      } else if (demo.kind === 'timeline-media-drop' && end && timelineSandbox) {
        await performTimelineMediaDrop({
          end,
          isActive,
          sandbox: timelineSandbox,
          start,
          target: demo.to,
        });
      } else if (demo.kind === 'timeline-scrub' && end && timelineSandbox) {
        await performTimelineScrub({
          demo,
          end,
          isActive,
          sandbox: timelineSandbox,
          start,
        });
      } else if (demo.kind === 'timeline-clip-move' && end && timelineSandbox) {
        await performTimelineClipMove({
          demo,
          end,
          isActive,
          sandbox: timelineSandbox,
          start,
        });
      } else if (demo.kind === 'timeline-clip-trim' && timelineSandbox) {
        await performTimelineClipTrim({
          demo,
          isActive,
          sandbox: timelineSandbox,
          start,
        });
      }
    } finally {
      restoreDemoState?.();
      if (restoreSlot.current === restoreDemoState) restoreSlot.current = null;
    }

    if (!await finishCursorDemoLoop(startTarget, isActive)) return;
  }
}

function getCursorDemoStartTarget(demo: InteractiveCursorDemo): GuidedTargetRef {
  return hasCursorDemoEndTarget(demo) ? demo.from : demo.target;
}

function hasCursorDemoEndTarget(
  demo: InteractiveCursorDemo,
): demo is Extract<InteractiveCursorDemo, {
  kind: 'drag-between' | 'timeline-media-drop' | 'timeline-scrub' | 'timeline-clip-move';
}> {
  return demo.kind === 'drag-between'
    || demo.kind === 'timeline-media-drop'
    || demo.kind === 'timeline-scrub'
    || demo.kind === 'timeline-clip-move';
}

function createDockLayoutRestore(layoutSnapshot: DockLayout): () => void {
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    useDockStore.getState().cancelDrag();
    useDockStore.setState({ layout: cloneDockLayout(layoutSnapshot) });
  };
}

async function finishCursorDemoLoop(
  startTarget: GuidedTargetRef,
  isActive: () => boolean,
): Promise<boolean> {
  if (!isActive()) return false;
  await nextAnimationFrame();
  if (!isActive()) return false;
  const restoredResolution = await guidedTargetRegistry.resolve(startTarget, {
    nowMs: Date.now(),
  });
  if (!isActive()) return false;
  useGuidedActionStore.getState().recordTargetResolution(restoredResolution);
  useGuidedActionStore.getState().setSpotlight(startTarget);
  useGuidedActionStore.getState().setCursor({
    clicking: false,
    dragging: false,
    inputGesture: null,
    ...(restoredResolution.status === 'resolved'
      ? { position: restoredResolution.center }
      : {}),
    transitionMs: 180,
  });
  if (!await waitWhileActive(640, isActive)) return false;
  useGuidedActionStore.getState().setCursor({ visible: false, transitionMs: 0 });
  return waitWhileActive(420, isActive);
}

async function performTimelineMediaDrop({
  end,
  isActive,
  sandbox,
  start,
  target,
}: {
  end: GuidedPoint;
  isActive: () => boolean;
  sandbox: TimelineTutorialSandbox;
  start: GuidedPoint;
  target: GuidedTargetRef;
}): Promise<void> {
  const guidedStore = useGuidedActionStore.getState();
  guidedStore.addHighlight({
    target,
    tone: 'success',
  });
  guidedStore.setDragGhost({ label: 'Tutorial Clip', mediaType: 'Solid' });
  const moved = await animateGuidedCursor(start, end, 1120, isActive);
  if (!moved) return;
  sandbox.ensureClip();
  guidedStore.setCursor({ dragging: false });
  guidedStore.setDragGhost(null);
  // Leave the result on screen long enough to read the target layer and see
  // that the media item has become a real timeline clip.
  if (!await waitWhileActive(1800, isActive)) return;
  guidedStore.clearHighlights();
  await animateGuidedCursor(end, start, 520, isActive);
}

async function performTimelineScrub({
  demo,
  end,
  isActive,
  sandbox,
  start,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'timeline-scrub' }>;
  end: GuidedPoint;
  isActive: () => boolean;
  sandbox: TimelineTutorialSandbox;
  start: GuidedPoint;
}): Promise<void> {
  const moved = await animatePoint(start, end, 1250, isActive, (_point, progress) => {
    sandbox.setPlayhead(demo.fromTime + (demo.toTime - demo.fromTime) * progress);
  });
  if (!moved || !await waitWhileActive(520, isActive)) return;
  await animatePoint(end, start, 980, isActive, (_point, progress) => {
    sandbox.setPlayhead(demo.toTime + (demo.fromTime - demo.toTime) * progress);
  });
  useGuidedActionStore.getState().setCursor({ dragging: false });
}

async function performTimelineClipMove({
  demo,
  end,
  isActive,
  sandbox,
  start,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'timeline-clip-move' }>;
  end: GuidedPoint;
  isActive: () => boolean;
  sandbox: TimelineTutorialSandbox;
  start: GuidedPoint;
}): Promise<void> {
  sandbox.selectClip();
  const moved = await animatePoint(start, end, 1180, isActive, (_point, progress) => {
    sandbox.moveClipTo(demo.fromTime + (demo.toTime - demo.fromTime) * progress);
  });
  if (!moved || !await waitWhileActive(520, isActive)) return;
  await animatePoint(end, start, 940, isActive, (_point, progress) => {
    sandbox.moveClipTo(demo.toTime + (demo.fromTime - demo.toTime) * progress);
  });
  useGuidedActionStore.getState().setCursor({ dragging: false });
}

async function performTimelineClipTrim({
  demo,
  isActive,
  sandbox,
  start,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'timeline-clip-trim' }>;
  isActive: () => boolean;
  sandbox: TimelineTutorialSandbox;
  start: GuidedPoint;
}): Promise<void> {
  sandbox.selectClip();
  const end = clampPointToViewport({
    x: start.x + demo.distance,
    y: start.y,
  });
  const trimmed = await animatePoint(start, end, 1050, isActive, (_point, progress) => {
    sandbox.trimClipToDuration(
      demo.fromDuration + (demo.toDuration - demo.fromDuration) * progress,
    );
  });
  if (!trimmed || !await waitWhileActive(540, isActive)) return;
  await animatePoint(end, start, 900, isActive, (_point, progress) => {
    sandbox.trimClipToDuration(
      demo.toDuration + (demo.fromDuration - demo.toDuration) * progress,
    );
  });
  useGuidedActionStore.getState().setCursor({ dragging: false });
}

async function performRealPanelRoundTrip({
  demo,
  endResolution,
  isActive,
  layoutSnapshot,
  start,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'drag-between' }>;
  endResolution: Extract<GuidedTargetResolution, { status: 'resolved' }>;
  isActive: () => boolean;
  layoutSnapshot: DockLayout;
  start: GuidedPoint;
}): Promise<void> {
  const original = findPanelAndGroup(layoutSnapshot.root, 'clip-properties');
  const targetGroupId = resolveDemoTargetGroupId(demo, endResolution, layoutSnapshot);
  if (!original || !targetGroupId) {
    await animateGuidedCursor(start, getDropPoint(endResolution, demo.dropPosition), 950, isActive);
    return;
  }

  const originalGroup = findTabGroupById(layoutSnapshot.root, original.groupId);
  const originalIndex = originalGroup?.panels.findIndex((panel) => panel.id === original.panel.id) ?? 0;
  const dropPosition = demo.dropPosition ?? 'center';
  const outwardEnd = getDropPoint(endResolution, dropPosition);
  const outwardTarget: DropTarget = {
    groupId: targetGroupId,
    position: dropPosition,
  };
  const dockStore = useDockStore.getState();
  dockStore.startDrag(original.panel, original.groupId, { x: 12, y: 9 }, start);
  const movedOut = await animateDockPanelDrag({
    dropTarget: outwardTarget,
    durationMs: 1050,
    from: start,
    isActive,
    to: outwardEnd,
  });
  if (!movedOut) return;
  useDockStore.getState().endDrag();
  useGuidedActionStore.getState().setCursor({ dragging: false });
  if (!await waitWhileActive(720, isActive)) return;

  const currentLayout = useDockStore.getState().layout;
  const movedPanel = findPanelAndGroup(currentLayout.root, 'clip-properties');
  const originalGroupStillExists = findTabGroupById(currentLayout.root, original.groupId);
  if (!movedPanel || !originalGroupStillExists) return;

  await nextAnimationFrame();
  if (!isActive()) return;
  const movedTab = document.querySelector('[data-guided-target="panel-tab:clip-properties"]');
  const returnStart = movedTab ? centerOfElement(movedTab) : outwardEnd;
  await animateGuidedCursor(outwardEnd, returnStart, 520, isActive);
  if (!isActive()) return;

  const guidedStore = useGuidedActionStore.getState();
  guidedStore.setCursor({ clicking: true, dragging: false, transitionMs: 0 });
  if (!await waitWhileActive(200, isActive)) return;
  guidedStore.setCursor({ clicking: false, dragging: true });

  useDockStore.getState().startDrag(
    movedPanel.panel,
    movedPanel.groupId,
    { x: 12, y: 9 },
    returnStart,
  );
  const movedBack = await animateDockPanelDrag({
    dropTarget: {
      groupId: original.groupId,
      position: 'center',
      tabInsertIndex: originalIndex,
    },
    durationMs: 980,
    from: returnStart,
    isActive,
    to: start,
  });
  if (!movedBack) return;
  useDockStore.getState().endDrag();
  guidedStore.setCursor({ dragging: false });
  await waitWhileActive(620, isActive);
}

async function performRealEdgeResize({
  demo,
  isActive,
  layoutSnapshot,
  start,
  startResolution,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'resize-edge' }>;
  isActive: () => boolean;
  layoutSnapshot: DockLayout;
  start: GuidedPoint;
  startResolution: Extract<GuidedTargetResolution, { status: 'resolved' }>;
}): Promise<void> {
  const bindings = getResizeBindings(startResolution.element, start, layoutSnapshot, false);
  const axis = bindings[0]?.axis
    ?? startResolution.element?.getAttribute('data-guided-resize-axis');
  const distance = demo.distance ?? 84;
  const end = clampPointToViewport(axis === 'y'
    ? { x: start.x, y: start.y + distance }
    : { x: start.x + distance, y: start.y });
  await animateResize(bindings, start, end, 900, isActive);
  if (!await waitWhileActive(420, isActive)) return;
  await animateResize(bindings, end, start, 820, isActive, start);
}

async function performRealCornerResize({
  demo,
  isActive,
  layoutSnapshot,
  start,
  startResolution,
}: {
  demo: Extract<InteractiveCursorDemo, { kind: 'corner-orbit' }>;
  isActive: () => boolean;
  layoutSnapshot: DockLayout;
  start: GuidedPoint;
  startResolution: Extract<GuidedTargetResolution, { status: 'resolved' }>;
}): Promise<void> {
  const bindings = getResizeBindings(startResolution.element, start, layoutSnapshot, true);
  const radius = demo.radius ?? 84;
  const orbitStart = clampPointToViewport({ x: start.x, y: start.y - radius });
  if (!await animateResize(bindings, start, orbitStart, 420, isActive, start)) return;
  if (!await animateCornerOrbit(bindings, start, radius, 2600, isActive)) return;
  await animateResize(bindings, orbitStart, start, 420, isActive, start);
}

interface ResizeBinding {
  axis: 'x' | 'y';
  dimension: number;
  originalRatio: number;
  splitId: string;
}

function getResizeBindings(
  element: Element | undefined,
  point: GuidedPoint,
  layout: DockLayout,
  includeIntersection: boolean,
): ResizeBinding[] {
  const ownHandle = element?.closest<HTMLElement>('[data-guided-resize-handle="true"]');
  if (!ownHandle) return [];
  const handles = includeIntersection
    ? [ownHandle, ...findIntersectingResizeHandles(ownHandle, point)]
    : [ownHandle];
  const seen = new Set<string>();

  return handles.flatMap((handle) => {
    const splitElement = handle.closest<HTMLElement>('.dock-split[data-split-id]');
    const splitId = splitElement?.dataset.splitId;
    const axis = handle.dataset.guidedResizeAxis;
    if (!splitId || (axis !== 'x' && axis !== 'y') || seen.has(splitId)) return [];
    const node = findNodeById(layout.root, splitId);
    if (!node || node.kind !== 'split') return [];
    const rect = splitElement.getBoundingClientRect();
    const dimension = axis === 'x' ? rect.width : rect.height;
    if (dimension <= 0) return [];
    seen.add(splitId);
    return [{ axis, dimension, originalRatio: node.ratio, splitId }];
  });
}

function findIntersectingResizeHandles(
  ownHandle: HTMLElement,
  point: GuidedPoint,
): HTMLElement[] {
  const ownAxis = ownHandle.dataset.guidedResizeAxis;
  const margin = 16;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-guided-resize-handle="true"]'))
    .filter((handle) => {
      if (handle === ownHandle || handle.dataset.guidedResizeAxis === ownAxis) return false;
      const rect = handle.getBoundingClientRect();
      return point.x >= rect.left - margin
        && point.x <= rect.right + margin
        && point.y >= rect.top - margin
        && point.y <= rect.bottom + margin;
    });
}

async function animateResize(
  bindings: ResizeBinding[],
  from: GuidedPoint,
  to: GuidedPoint,
  durationMs: number,
  isActive: () => boolean,
  origin: GuidedPoint = from,
): Promise<boolean> {
  return animatePoint(from, to, durationMs, isActive, (point) => {
    applyResizePoint(bindings, origin, point);
  });
}

function animateCornerOrbit(
  bindings: ResizeBinding[],
  center: GuidedPoint,
  radius: number,
  durationMs: number,
  isActive: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (now: number) => {
      if (!isActive()) {
        resolve(false);
        return;
      }
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const angle = -Math.PI / 2 + progress * Math.PI * 2;
      const point = clampPointToViewport({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
      useGuidedActionStore.getState().setCursor({
        position: point,
        transitionMs: 0,
        visible: true,
      });
      applyResizePoint(bindings, center, point);
      if (progress >= 1) {
        resolve(true);
      } else {
        window.requestAnimationFrame(tick);
      }
    };
    window.requestAnimationFrame(tick);
  });
}

function applyResizePoint(
  bindings: ResizeBinding[],
  origin: GuidedPoint,
  point: GuidedPoint,
): void {
  for (const binding of bindings) {
    const delta = binding.axis === 'x'
      ? (point.x - origin.x) / binding.dimension
      : (point.y - origin.y) / binding.dimension;
    useDockStore.getState().setSplitRatio(
      binding.splitId,
      binding.originalRatio + delta,
    );
  }
}

async function animateDockPanelDrag({
  dropTarget,
  durationMs,
  from,
  isActive,
  to,
}: {
  dropTarget: DropTarget;
  durationMs: number;
  from: GuidedPoint;
  isActive: () => boolean;
  to: GuidedPoint;
}): Promise<boolean> {
  return animatePoint(from, to, durationMs, isActive, (point, progress) => {
    useDockStore.getState().updateDrag(
      point,
      progress >= 0.52 ? dropTarget : null,
    );
  });
}

function animateGuidedCursor(
  from: GuidedPoint,
  to: GuidedPoint,
  durationMs: number,
  isActive: () => boolean,
): Promise<boolean> {
  return animatePoint(from, to, durationMs, isActive);
}

function animatePoint(
  from: GuidedPoint,
  to: GuidedPoint,
  durationMs: number,
  isActive: () => boolean,
  onFrame?: (point: GuidedPoint, progress: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = (now: number) => {
      if (!isActive()) {
        resolve(false);
        return;
      }
      const linearProgress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const progress = easeInOut(linearProgress);
      const point = clampPointToViewport({
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      });
      useGuidedActionStore.getState().setCursor({
        position: point,
        transitionMs: 0,
        visible: true,
      });
      onFrame?.(point, progress);
      if (linearProgress >= 1) {
        resolve(true);
      } else {
        window.requestAnimationFrame(tick);
      }
    };
    window.requestAnimationFrame(tick);
  });
}

function easeInOut(value: number): number {
  return value < 0.5
    ? 2 * value * value
    : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function resolveDemoTargetGroupId(
  demo: Extract<InteractiveCursorDemo, { kind: 'drag-between' }>,
  resolution: Extract<GuidedTargetResolution, { status: 'resolved' }>,
  layout: DockLayout,
): string | null {
  const domGroupId = resolution.element
    ?.closest<HTMLElement>('[data-group-id]')
    ?.dataset.groupId;
  if (domGroupId) return domGroupId;
  if (demo.to.kind === 'panel') {
    return findPanelAndGroup(layout.root, demo.to.panel)?.groupId ?? null;
  }
  return null;
}

function getDropPoint(
  resolution: Extract<GuidedTargetResolution, { status: 'resolved' }>,
  position: DropTarget['position'] = 'center',
): GuidedPoint {
  const rect = resolution.rect;
  if (!rect || position === 'center') return clampPointToViewport(resolution.center);
  const insetX = Math.min(54, rect.width * 0.14);
  const insetY = Math.min(54, rect.height * 0.14);
  switch (position) {
    case 'left': return clampPointToViewport({ x: rect.x + insetX, y: resolution.center.y });
    case 'right': return clampPointToViewport({ x: rect.x + rect.width - insetX, y: resolution.center.y });
    case 'top': return clampPointToViewport({ x: resolution.center.x, y: rect.y + insetY });
    case 'bottom': return clampPointToViewport({ x: resolution.center.x, y: rect.y + rect.height - insetY });
  }
}

function centerOfElement(element: Element): GuidedPoint {
  const rect = element.getBoundingClientRect();
  return clampPointToViewport({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });
}

function resolveCursorFallbackPoint(
  target: GuidedTargetRef,
  timelineSandbox: TimelineTutorialSandbox | null,
): GuidedPoint | null {
  if (target.kind === 'mediaItem') {
    const nameElement = Array.from(document.querySelectorAll<HTMLElement>('[data-guided-media-name]'))
      .find((element) => element.dataset.guidedMediaName === target.itemId);
    if (nameElement) return centerOfElement(nameElement);
    const mediaElement = Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]'))
      .find((element) => element.dataset.itemId === target.itemId);
    return mediaElement ? centerOfElement(mediaElement) : null;
  }

  if (target.kind === 'timelineTrimHandle') {
    if (!timelineSandbox || timelineSandbox.getClipId() !== target.clipId) return null;
    const clipBounds = timelineSandbox.getClipBounds();
    if (!clipBounds) return null;
    return resolveCursorFallbackPoint({
      kind: 'timelineTime',
      trackId: clipBounds.trackId,
      time: clipBounds.startTime + (target.edge === 'end' ? clipBounds.duration : 0),
    }, timelineSandbox);
  }

  if (target.kind !== 'timelineTime') return null;
  const timelineSurface = document.querySelector<HTMLElement>('[data-guided-target="timeline-tracks"]');
  if (!timelineSurface) return null;
  const zoom = Number(timelineSurface.dataset.guidedTimelineZoom ?? 72);
  const scrollX = Number(timelineSurface.dataset.guidedTimelineScrollX ?? 0);

  if (target.surface === 'ruler') {
    const ruler = document.querySelector<HTMLElement>('[data-guided-target="timeline-ruler"]');
    if (!ruler) return null;
    const rulerRect = ruler.getBoundingClientRect();
    return clampPointToViewport({
      x: rulerRect.left + target.time * zoom - scrollX,
      y: rulerRect.top + rulerRect.height / 2,
    });
  }

  const trackId = target.trackId ?? timelineSandbox?.getTrackId();
  const trackElement = Array.from(document.querySelectorAll<HTMLElement>('.track-lane[data-track-id]'))
    .find((element) => element.dataset.trackId === trackId);
  const rowElement = trackElement?.querySelector<HTMLElement>('.track-clip-row') ?? trackElement;
  if (!rowElement) return null;

  const rowRect = rowElement.getBoundingClientRect();
  const sectionViewport = rowElement.closest<HTMLElement>('.timeline-section-viewport');
  const viewportRect = sectionViewport?.getBoundingClientRect();
  if (
    viewportRect
    && (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom)
  ) return null;
  const laneReference = timelineSurface.querySelector<HTMLElement>(
    '[data-guided-target="timeline-lane-reference"]',
  );
  const surfaceRect = timelineSurface.getBoundingClientRect();
  const laneOriginX = laneReference?.getBoundingClientRect().left
    ?? surfaceRect.left + Number(timelineSurface.dataset.guidedTimelineOriginX ?? 0);
  return clampPointToViewport({
    x: laneOriginX + target.time * zoom - scrollX,
    y: rowRect.top + rowRect.height / 2,
  });
}

function clampPointToViewport(point: GuidedPoint): GuidedPoint {
  const margin = 34;
  const width = window.innerWidth || document.documentElement.clientWidth;
  const height = window.innerHeight || document.documentElement.clientHeight;
  return {
    x: Math.min(Math.max(margin, point.x), Math.max(margin, width - margin)),
    y: Math.min(Math.max(margin, point.y), Math.max(margin, height - margin)),
  };
}

function waitWhileActive(ms: number, isActive: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(isActive()), ms);
  });
}
