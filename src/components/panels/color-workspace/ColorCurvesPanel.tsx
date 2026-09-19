import { useEffect, useMemo, useRef, useState } from 'react';

import { endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { BezierHandle, Keyframe } from '../../../types';
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
  const batchOpenRef = useRef(false);
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
    if (batchOpenRef.current) endBatch();
  }, []);

  if (!clip || !activeVersion || !selectedNode) {
    return <div className="panel-empty"><p>Select a video clip to edit its curves</p></div>;
  }

  const writePoints = (nextPoints: ColorCurvePoint[]) => {
    updateColorNodeParam(
      clipId,
      activeVersion.id,
      selectedNode.id,
      paramKey,
      serializeColorCurvePoints(nextPoints),
    );
  };

  const updateBatch = (phase: CurveEditorEditPhase | undefined) => {
    if (phase === 'begin' && !batchOpenRef.current) {
      startBatch('Adjust color curve');
      batchOpenRef.current = true;
    }
    if (phase === 'commit' && batchOpenRef.current) {
      endBatch();
      batchOpenRef.current = false;
    }
  };

  const movePoint = (id: string, x: number, y: number, phase?: CurveEditorEditPhase) => {
    updateBatch(phase);
    const sorted = points.toSorted((left, right) => left.x - right.x);
    const index = sorted.findIndex(point => point.id === id);
    if (index < 0) return;
    const minX = index === 0 ? 0 : sorted[index - 1].x + 0.001;
    const maxX = index === sorted.length - 1 ? 1 : sorted[index + 1].x - 0.001;
    writePoints(sorted.map(point => point.id === id ? {
      ...point,
      x: index === 0 ? 0 : index === sorted.length - 1 ? 1 : Math.max(minX, Math.min(maxX, x)),
      y: clampUnit(y),
    } : point));
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
  };

  const addPoint = () => {
    const x = getLargestGapMidpoint(points);
    const samples = sampleColorCurve(points, 257);
    const point: ColorCurvePoint = {
      id: `curve-${activeChannel}-${Date.now().toString(36)}`,
      x,
      y: samples[Math.round(x * (samples.length - 1))],
    };
    startBatch('Add color curve point');
    writePoints([...points, point]);
    endBatch();
    setSelectedPointIds(new Set([point.id]));
  };

  const resetCurve = () => {
    startBatch('Reset color curve');
    writePoints(createNeutralColorCurve(activeChannel));
    endBatch();
    setSelectedPointIds(new Set());
  };

  const selectedPoint = points.find(point => selectedPointIds.has(point.id));

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
        <div className="color-curves-graph" ref={graphHostRef}>
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
