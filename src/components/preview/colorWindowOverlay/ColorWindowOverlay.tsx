import { useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { ensureColorCorrectionState, getActiveColorVersion, getEditableColorNodes } from '../../../types/colorCorrection';
import { projectLayerUvToCanvas, unprojectCanvasToLayerUv } from '../editModeOverlayMath';
import { getProjectionParams, withClipProjectionTransform } from '../maskOverlay/maskOverlayProjectionPlans';
import { useColorWindowTarget } from './colorWindowTarget';
import {
  colorWindowOutline,
  dragColorWindow,
  hasColorWindow,
  nodesSharingWindow,
  readColorWindow,
  type ColorWindowDragMode,
  type UvPoint,
} from './colorWindowGeometry';
import './ColorWindowOverlay.css';

interface ColorWindowOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Shows the window of the selected correction node (Color tab) as an outline in the preview: solid at
 * the edge, dashed where the soft edge starts and ends. Drag inside to move it, the right and bottom
 * handles to resize. Nodes with the same window (an inside/outside pair) move together.
 */
export function ColorWindowOverlay({ canvasWidth, canvasHeight }: ColorWindowOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useColorWindowTarget(state => state.clipId);
  const clip = useTimelineStore(state => clipId ? state.clips.find(candidate => candidate.id === clipId) : undefined);
  const layers = useTimelineStore(state => state.layers);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const getInterpolatedTransform = useTimelineStore(state => state.getInterpolatedTransform);

  const colorState = clip?.colorCorrection ? ensureColorCorrectionState(clip.colorCorrection) : null;
  const version = colorState ? getActiveColorVersion(colorState) : undefined;
  const editable = colorState ? getEditableColorNodes(colorState) : [];
  const node = editable.find(candidate => candidate.id === colorState?.ui.selectedNodeId) ?? editable[0];
  const window = node ? readColorWindow(node) : null;

  const projection = useMemo(() => {
    if (!clip) return null;
    const layer = layers.find(candidate => candidate?.sourceClipId === clip.id);
    const projected = withClipProjectionTransform(layer ?? undefined, getInterpolatedTransform(clip.id, playheadPosition - clip.startTime));
    return getProjectionParams(projected, canvasWidth, canvasHeight);
  }, [canvasHeight, canvasWidth, clip, getInterpolatedTransform, layers, playheadPosition]);

  const toCanvas = useCallback((uv: UvPoint) => projection ? projectLayerUvToCanvas(uv, projection) : { x: uv.x * canvasWidth, y: uv.y * canvasHeight }, [canvasHeight, canvasWidth, projection]);
  const pointerToUv = useCallback((clientX: number, clientY: number): UvPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const point = { x: ((clientX - rect.left) / rect.width) * canvasWidth, y: ((clientY - rect.top) / rect.height) * canvasHeight };
    return projection ? unprojectCanvasToLayerUv(point, projection) : { x: point.x / canvasWidth, y: point.y / canvasHeight };
  }, [canvasHeight, canvasWidth, projection]);

  const startDrag = useCallback((mode: ColorWindowDragMode, event: React.PointerEvent) => {
    if (!clip || !version || !node || !window) return;
    const start = pointerToUv(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const linked = nodesSharingWindow(version.nodes, window);
    const targets = linked.length > 0 ? linked : [node];
    const batch = startBatch('Move color window');
    const onMove = (move: PointerEvent) => {
      const current = pointerToUv(move.clientX, move.clientY);
      if (!current) return;
      const patch = dragColorWindow(window, mode, start, current);
      const store = useTimelineStore.getState();
      for (const target of targets) {
        for (const [key, value] of Object.entries(patch)) store.updateColorNodeParam(clip.id, version.id, target.id, key, value as number);
      }
    };
    const onUp = () => {
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      if (batch.opened) endBatch();
    };
    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp);
  }, [clip, node, pointerToUv, version, window]);

  if (!clip || !node || !window || !hasColorWindow(window)) return null;
  const path = (scale: number) => colorWindowOutline(window, scale).map(toCanvas).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  const softness = Math.min(Math.max(window.windowSoftness, 0), 1);
  const widthHandle = toCanvas({ x: window.windowX + window.windowWidth / 2, y: window.windowY });
  const heightHandle = toCanvas({ x: window.windowX, y: window.windowY + window.windowHeight / 2 });
  const center = toCanvas({ x: window.windowX, y: window.windowY });
  const handleRadius = Math.max(canvasWidth, canvasHeight) * 0.006;
  return (
    <svg ref={svgRef} className="color-window-overlay" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} preserveAspectRatio="none" aria-label="Color window">
      {softness > 0.0001 && <path className="color-window-soft" d={path(1 - softness)} />}
      {softness > 0.0001 && <path className="color-window-soft" d={path(1 + softness)} />}
      <path className="color-window-edge" d={path(1)} onPointerDown={event => startDrag('move', event)} />
      <circle className="color-window-center" cx={center.x} cy={center.y} r={handleRadius} onPointerDown={event => startDrag('move', event)} />
      <circle className="color-window-handle" cx={widthHandle.x} cy={widthHandle.y} r={handleRadius} onPointerDown={event => startDrag('width', event)} />
      <circle className="color-window-handle" cx={heightHandle.x} cy={heightHandle.y} r={handleRadius} onPointerDown={event => startDrag('height', event)} />
      <text className="color-window-label" x={center.x} y={center.y - handleRadius * 2.5}>
        {window.windowOutside >= 0.5 ? 'corrects outside' : 'corrects inside'}
      </text>
    </svg>
  );
}
