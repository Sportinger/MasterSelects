import { useEffect, useMemo } from 'react';
import { useGuidedActionStore } from '../../stores/guidedActionStore';
import {
  getGuidedActionRuntime,
  getGuidedTargetKey,
  guidedTargetRegistry,
  registerDomGuidedTargetResolvers,
  type GuidedRect,
  type GuidedTargetRef,
} from '../../services/guidedActions';
import { GuidedCallout } from './GuidedCallout';
import { GuidedCursor } from './GuidedCursor';
import { GuidedSpotlight } from './GuidedSpotlight';
import { GuidedStepHud } from './GuidedStepHud';
import { GuidedTargetHighlight } from './GuidedTargetHighlight';
import './GuidedActionOverlay.css';

export function GuidedActionOverlay() {
  const activeSession = useGuidedActionStore((state) => state.activeSession);
  const callout = useGuidedActionStore((state) => state.callout);
  const currentStep = useGuidedActionStore((state) => state.currentStep);
  const cursor = useGuidedActionStore((state) => state.cursor);
  const highlights = useGuidedActionStore((state) => state.highlights);
  const previewPaths = useGuidedActionStore((state) => state.previewPaths);
  const spotlight = useGuidedActionStore((state) => state.spotlight);
  const targetResolutions = useGuidedActionStore((state) => state.targetResolutions);

  useEffect(() => registerDomGuidedTargetResolvers(guidedTargetRegistry), []);

  useEffect(() => {
    if (
      !activeSession
      || activeSession.status !== 'running'
      || activeSession.context.visualizationMode === 'off'
      || activeSession.context.animationBudget.disabled
    ) {
      return;
    }

    let frameId: number | null = null;
    let disposed = false;

    const resolveVisibleTargets = () => {
      frameId = null;
      const targets = collectVisibleTargets({
        calloutTarget: callout?.target,
        highlightTargets: highlights.map((highlight) => highlight.target),
        inputLockTargets: activeSession.context.inputLock.mode === 'targetOnly'
          ? activeSession.context.inputLock.targets
          : [],
        spotlightTarget: spotlight,
      });

      for (const target of targets) {
        void guidedTargetRegistry.resolve(target, {
          sessionId: activeSession.id,
          nowMs: Date.now(),
        }).then((resolution) => {
          if (!disposed) {
            useGuidedActionStore.getState().recordTargetResolution(resolution);
          }
        });
      }
    };

    const scheduleResolve = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(resolveVisibleTargets);
    };

    window.addEventListener('resize', scheduleResolve);
    window.addEventListener('scroll', scheduleResolve, true);

    return () => {
      disposed = true;
      window.removeEventListener('resize', scheduleResolve);
      window.removeEventListener('scroll', scheduleResolve, true);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [activeSession, callout, highlights, spotlight]);

  useEffect(() => {
    if (!activeSession || activeSession.context.inputLock.mode !== 'locked') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      getGuidedActionRuntime().cancelSession(activeSession.id, 'Cancelled with Escape');
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeSession]);

  const spotlightRect = useMemo(() => {
    if (!spotlight) {
      return null;
    }
    return getResolvedRect(spotlight, targetResolutions);
  }, [spotlight, targetResolutions]);

  const calloutRect = useMemo(() => {
    if (!callout?.target) {
      return null;
    }
    return getResolvedRect(callout.target, targetResolutions);
  }, [callout, targetResolutions]);

  if (!activeSession || activeSession.status === 'completed' || activeSession.status === 'cancelled' || activeSession.status === 'skipped') {
    return null;
  }

  if (activeSession.context.visualizationMode === 'off' || activeSession.context.animationBudget.disabled) {
    return null;
  }

  const inputLock = activeSession.context.inputLock;
  const locked = inputLock.mode === 'locked';
  const targetOnlyRects = inputLock.mode === 'targetOnly'
    ? inputLock.targets
      .map((target) => getResolvedRect(target, targetResolutions))
      .filter((rect): rect is GuidedRect => rect !== null)
    : [];

  return (
    <div className="guided-action-overlay" data-input-lock={inputLock.mode}>
      {locked && <div className="guided-input-shield" />}
      {targetOnlyRects.length > 0 && <GuidedTargetOnlyShield allowedRects={targetOnlyRects} />}

      {spotlight && <GuidedSpotlight rect={spotlightRect} />}

      {highlights.map((highlight) => {
        const rect = getResolvedRect(highlight.target, targetResolutions);
        if (!rect) {
          return null;
        }
        return (
          <GuidedTargetHighlight
            key={highlight.id}
            rect={rect}
            tone={highlight.tone}
          />
        );
      })}

      {previewPaths.length > 0 && (
        <svg className="guided-preview-path-layer" aria-hidden="true">
          {previewPaths.map((path) => (
            <polyline
              key={path.id}
              className={`guided-preview-path ${path.closed ? 'guided-preview-path--closed' : ''}`}
              points={formatPreviewPathPoints(path.points, path.closed)}
            />
          ))}
        </svg>
      )}

      {callout && (
        <GuidedCallout
          body={callout.body}
          targetRect={calloutRect}
          title={callout.title}
        />
      )}

      <GuidedCursor
        clicking={cursor.clicking}
        position={cursor.position}
        visible={cursor.visible}
      />

      <GuidedStepHud currentStep={currentStep} session={activeSession} />

      {(locked || inputLock.mode === 'targetOnly') && (
        <div className="guided-control-strip">
          <button
            type="button"
            className="guided-control-btn"
            title="Cancel guided action"
            aria-label="Cancel guided action"
            onClick={() => getGuidedActionRuntime().cancelSession(activeSession.id, 'Cancelled by user')}
          >
            x
          </button>
          <button
            type="button"
            className="guided-control-btn"
            title="Skip guided action"
            aria-label="Skip guided action"
            onClick={() => getGuidedActionRuntime().skipSession(activeSession.id, 'Skipped by user')}
          >
            &gt;&gt;
          </button>
        </div>
      )}
    </div>
  );
}

function getResolvedRect(
  target: GuidedTargetRef,
  resolutions: Record<string, { status: string; rect?: GuidedRect }>,
): GuidedRect | null {
  const resolution = resolutions[getGuidedTargetKey(target)];
  if (!resolution || resolution.status !== 'resolved' || !resolution.rect) {
    return null;
  }
  return resolution.rect;
}

function formatPreviewPathPoints(points: Array<{ x: number; y: number }>, closed: boolean): string {
  const drawnPoints = closed && points[0]
    ? [...points, points[0]]
    : points;
  return drawnPoints.map((point) => `${point.x},${point.y}`).join(' ');
}

function GuidedTargetOnlyShield({ allowedRects }: { allowedRects: GuidedRect[] }) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const rects = allowedRects
    .map((rect) => clampRectToViewport(rect, viewportWidth, viewportHeight))
    .filter((rect): rect is GuidedRect => rect !== null);

  if (rects.length === 0) {
    return <div className="guided-input-shield" />;
  }

  const segments = buildTargetOnlyShieldSegments(rects, viewportWidth, viewportHeight);

  return (
    <>
      {segments.map((segment) => (
        <div
          key={`${segment.x}:${segment.y}:${segment.width}:${segment.height}`}
          className="guided-input-shield guided-input-shield--segment"
          style={{
            left: segment.x,
            top: segment.y,
            width: segment.width,
            height: segment.height,
          }}
        />
      ))}
    </>
  );
}

function clampRectToViewport(
  rect: GuidedRect,
  viewportWidth: number,
  viewportHeight: number,
): GuidedRect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(viewportWidth, rect.x + rect.width);
  const bottom = Math.min(viewportHeight, rect.y + rect.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function collectVisibleTargets({
  calloutTarget,
  highlightTargets,
  inputLockTargets,
  spotlightTarget,
}: {
  calloutTarget?: GuidedTargetRef;
  highlightTargets: GuidedTargetRef[];
  inputLockTargets: GuidedTargetRef[];
  spotlightTarget: GuidedTargetRef | null;
}): GuidedTargetRef[] {
  const targets = [
    spotlightTarget,
    calloutTarget ?? null,
    ...highlightTargets,
    ...inputLockTargets,
  ].filter((target): target is GuidedTargetRef => target !== null);
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = getGuidedTargetKey(target);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildTargetOnlyShieldSegments(
  allowedRects: GuidedRect[],
  viewportWidth: number,
  viewportHeight: number,
): GuidedRect[] {
  const xEdges = uniqueSorted([
    0,
    viewportWidth,
    ...allowedRects.flatMap((rect) => [rect.x, rect.x + rect.width]),
  ]);
  const yEdges = uniqueSorted([
    0,
    viewportHeight,
    ...allowedRects.flatMap((rect) => [rect.y, rect.y + rect.height]),
  ]);
  const segments: GuidedRect[] = [];

  for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex += 1) {
      const x = xEdges[xIndex];
      const y = yEdges[yIndex];
      const width = xEdges[xIndex + 1] - x;
      const height = yEdges[yIndex + 1] - y;
      if (width <= 0 || height <= 0) {
        continue;
      }

      const center = {
        x: x + width / 2,
        y: y + height / 2,
      };
      if (allowedRects.some((rect) => containsPoint(rect, center))) {
        continue;
      }

      segments.push({ x, y, width, height });
    }
  }

  return segments;
}

function containsPoint(rect: GuidedRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))]
    .toSorted((a, b) => a - b);
}
