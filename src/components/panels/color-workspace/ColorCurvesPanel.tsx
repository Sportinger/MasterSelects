import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { beginColorEditGesture, runColorEditGesture, type ColorEditGesture } from '../color/colorEditGesture';
import { useTimelineStore } from '../../../stores/timeline';
import type { BezierHandle } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import {
  COLOR_CURVE_CHANNELS,
  createNeutralColorCurve,
  getColorCurveParamKey,
  parseColorCurvePoints,
  sampleColorCurve,
  serializeColorCurvePoints,
  type ColorCurveChannel,
  type ColorCurvePoint,
} from '../../../types/colorCurves';
import {
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
} from '../../../types/colorCorrection';
import { CurveEditor, type CurveEditorEditPhase } from '../../timeline/CurveEditor';
import '../../timeline/TimelineKeyframesCurveEditor.css';
import { createCurveTouchMapping, findTouchedCurvePoint, type CurveTouchMapping } from './colorCurveTouch';

interface ColorCurvesPanelProps {
  clipId: string;
}

const CHANNEL_LABELS: Record<ColorCurveChannel, string> = {
  y: 'Y',
  r: 'R',
  g: 'G',
  b: 'B',
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toKeyframe(point: ColorCurvePoint, clipId: string): Keyframe {
  return {
    id: point.id,
    clipId,
    time: point.x,
    property: 'opacity',
    value: point.y,
    easing: 'bezier',
    handleIn: point.handleIn,
    handleOut: point.handleOut,
  };
}

function getLargestGapMidpoint(points: ColorCurvePoint[]): number {
  const sorted = points.toSorted((left, right) => left.x - right.x);
  let bestLeft = 0;
  let bestGap = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].x - sorted[index - 1].x;
    if (gap > bestGap) {
      bestGap = gap;
      bestLeft = sorted[index - 1].x;
    }
  }
  return bestLeft + bestGap / 2;
}

export function ColorCurvesPanel({ clipId }: ColorCurvesPanelProps) {
  const [activeChannel, setActiveChannel] = useState<ColorCurveChannel>('y');
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [graphSize, setGraphSize] = useState({ width: 320, height: 220 });
  const graphHostRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<ColorEditGesture | null>(null);
  const touchDragRef = useRef<{ pointerId: number; id: string; mapping: CurveTouchMapping } | null>(null);
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const ensureColorCorrection = useTimelineStore(state => state.ensureColorCorrection);
  const updateColorNodeParam = useTimelineStore(state => state.updateColorNodeParam);

  useEffect(() => {
    ensureColorCorrection(clipId);
  }, [clipId, ensureColorCorrection]);

  useEffect(() => {
    const host = graphHostRef.current;
    if (!host) return undefined;
    const observer = new ResizeObserver(() => {
      setGraphSize({
        width: Math.max(160, host.clientWidth),
        height: Math.max(120, host.clientHeight),
      });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const colorState = useMemo(
    () => ensureColorCorrectionState(clip?.colorCorrection),
    [clip?.colorCorrection],
  );
  const activeVersion = getActiveColorVersion(colorState);
  const editableNodes = getEditableColorNodes(colorState);
  const selectedNode = activeVersion?.nodes.find(node => node.id === colorState.ui.selectedNodeId)
    ?? editableNodes[0];
  const paramKey = getColorCurveParamKey(activeChannel);
  const points = useMemo(
    () => parseColorCurvePoints(selectedNode?.params[paramKey], activeChannel),
    [activeChannel, paramKey, selectedNode?.params],
  );
  const keyframes = useMemo(
    () => points.map(point => toKeyframe(point, clipId)),
    [clipId, points],
  );

  useEffect(() => () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    gesture?.commit();
  }, []);

  if (!clip || !activeVersion || !selectedNode) {
    return <div className="panel-empty"><p>Select a video clip to edit its curves</p></div>;
  }

  const writePoints = (nextPoints: ColorCurvePoint[]) => {
    const write = () => updateColorNodeParam(
      clipId,
      activeVersion.id,
      selectedNode.id,
      paramKey,
      serializeColorCurvePoints(nextPoints),
    );
    if (gestureRef.current) gestureRef.current.run(write);
    else write();
  };

  // One curve drag = one undo step (see colorEditGesture). The commit phase writes its final value
  // first, then closes the gesture.
  const updateBatch = (phase: CurveEditorEditPhase | undefined) => {
    if (phase === 'begin' && !gestureRef.current) {
      gestureRef.current = beginColorEditGesture('Adjust color curve');
    }
  };
  const finishBatch = (phase: CurveEditorEditPhase | undefined) => {
    if (phase !== 'commit' || !gestureRef.current) return;
    const gesture = gestureRef.current;
    gestureRef.current = null;
    gesture.commit();
  };

  const movePoint = (id: string, x: number, y: number, phase?: CurveEditorEditPhase) => {
    updateBatch(phase);
    const sorted = points.toSorted((left, right) => left.x - right.x);
    const index = sorted.findIndex(point => point.id === id);
    if (index < 0) { finishBatch(phase); return; }
    const minX = index === 0 ? 0 : sorted[index - 1].x + 0.001;
    const maxX = index === sorted.length - 1 ? 1 : sorted[index + 1].x - 0.001;
    writePoints(sorted.map(point => point.id === id ? {
      ...point,
      x: index === 0 ? 0 : index === sorted.length - 1 ? 1 : Math.max(minX, Math.min(maxX, x)),
      y: clampUnit(y),
    } : point));
    finishBatch(phase);
  };

  const updateHandle = (
    id: string,
    handle: 'in' | 'out',
    position: BezierHandle,
    phase?: CurveEditorEditPhase,
  ) => {
    updateBatch(phase);
    writePoints(points.map(point => point.id === id ? {
      ...point,
      [handle === 'in' ? 'handleIn' : 'handleOut']: position,
    } : point));
    finishBatch(phase);
  };

  const addPoint = () => {
    const x = getLargestGapMidpoint(points);
    const samples = sampleColorCurve(points, 257);
    const point: ColorCurvePoint = {
      id: `curve-${activeChannel}-${Date.now().toString(36)}`,
      x,
      y: samples[Math.round(x * (samples.length - 1))],
    };
    runColorEditGesture('Add color curve point', () => writePoints([...points, point]));
    setSelectedPointIds(new Set([point.id]));
  };

  const resetCurve = () => {
    runColorEditGesture('Reset color curve', () => writePoints(createNeutralColorCurve(activeChannel)));
    setSelectedPointIds(new Set());
  };

  const selectedPoint = points.find(point => selectedPointIds.has(point.id));

  // Touch: the shared CurveEditor drags points with mouse events, which a finger never sends while
  // moving. A finger therefore grabs the nearest point within a finger-sized radius here and drags it
  // through the same movePoint path (one undo step per drag). Mouse and pen keep the CurveEditor path.
  const handleTouchPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    const host = event.currentTarget;
    const centres = [...host.querySelectorAll<SVGCircleElement>('circle.curve-editor-keyframe')].map(circle => {
      const rect = circle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const hostRect = host.getBoundingClientRect();
    const mapping = createCurveTouchMapping(points, centres, { top: hostRect.top, height: hostRect.height });
    if (!mapping) return;
    const id = findTouchedCurvePoint(points, mapping, event.clientX, event.clientY);
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    host.setPointerCapture?.(event.pointerId);
    touchDragRef.current = { pointerId: event.pointerId, id, mapping };
    setSelectedPointIds(new Set([id]));
    updateBatch('begin');
  };

  const handleTouchPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = drag.mapping.toCurve(event.clientX, event.clientY);
    movePoint(drag.id, point.x, point.y);
  };

  const finishTouchDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    touchDragRef.current = null;
    event.stopPropagation();
    finishBatch('commit');
  };

  return (
    <section className="color-curves-panel" data-channel={activeChannel}>
      <header className="color-workspace-surface-header">
        <strong>Curves · Custom</strong>
        <div className="color-curve-toolbar" role="group" aria-label="Curve channel">
          {COLOR_CURVE_CHANNELS.map(channel => (
            <button
              aria-pressed={activeChannel === channel}
              className={`color-curve-channel color-curve-channel-${channel}${activeChannel === channel ? ' active' : ''}`}
              key={channel}
              onClick={() => {
                setActiveChannel(channel);
                setSelectedPointIds(new Set());
              }}
              type="button"
            >
              {CHANNEL_LABELS[channel]}
            </button>
          ))}
          <button onClick={addPoint} title="Add curve point" type="button">+</button>
          <button onClick={resetCurve} title="Reset curve" type="button">Reset</button>
        </div>
      </header>

      <div className="color-curves-body">
        <div
          className="color-curves-graph"
          onLostPointerCapture={finishTouchDrag}
          onPointerCancelCapture={finishTouchDrag}
          onPointerDownCapture={handleTouchPointerDown}
          onPointerMoveCapture={handleTouchPointerMove}
          onPointerUpCapture={finishTouchDrag}
          ref={graphHostRef}
        >
          <CurveEditor
            clipDuration={1}
            clipId={clipId}
            clipStartTime={0}
            disableWheelResize
            heightOverride={graphSize.height}
            keyframes={keyframes}
            onMoveKeyframe={movePoint}
            onSelectKeyframe={(id, addToSelection) => {
              setSelectedPointIds(current => {
                if (!id) return new Set();
                if (!addToSelection) return new Set([id]);
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onUpdateBezierHandle={updateHandle}
            pixelToTime={pixel => pixel / graphSize.width}
            property="opacity"
            selectedKeyframeIds={selectedPointIds}
            timeToPixel={time => time * graphSize.width}
            trackId={clip.trackId}
            valueRangeOverride={{ min: 0, max: 1 }}
            width={graphSize.width}
          />
        </div>

        <aside className="color-curves-readout">
          <strong>Edit</strong>
          <span>Input</span>
          <output>{selectedPoint ? Math.round(selectedPoint.x * 100) : '—'}</output>
          <span>Output</span>
          <output>{selectedPoint ? Math.round(selectedPoint.y * 100) : '—'}</output>
          <small>{selectedNode.name}</small>
        </aside>
      </div>
    </section>
  );
}
