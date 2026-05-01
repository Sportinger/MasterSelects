// Rectangle and ellipse shape drawing for mask creation

import { useRef, useState, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { MaskVertex, TimelineClip } from '../../types';

interface ShapeDrawState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDrawing: boolean;
}

export function useMaskShapeDraw(
  svgRef: React.RefObject<SVGSVGElement | null>,
  selectedClip: TimelineClip | undefined,
  maskEditMode: string,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const {
    addMask,
    setActiveMask,
    setMaskEditMode,
  } = useTimelineStore();

  const [shapeDrawState, setShapeDrawState] = useState<ShapeDrawState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isDrawing: false,
  });

  const justFinishedDrawing = useRef(false);

  const handleShapeMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!selectedClip) return;
    if (maskEditMode !== 'drawingRect' && maskEditMode !== 'drawingEllipse') return;

    const svg = svgRef.current;
    if (!svg) return;

    const localPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    const rect = svg.getBoundingClientRect();
    const x = localPoint?.x ?? (e.clientX - rect.left) / rect.width;
    const y = localPoint?.y ?? (e.clientY - rect.top) / rect.height;

    setShapeDrawState({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      isDrawing: true,
    });

    e.preventDefault();
  }, [clientToLocalPoint, selectedClip, maskEditMode, svgRef]);

  const handleShapeMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!shapeDrawState.isDrawing) return;

    const svg = svgRef.current;
    if (!svg) return;

    const localPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    const rect = svg.getBoundingClientRect();
    const x = localPoint?.x ?? (e.clientX - rect.left) / rect.width;
    const y = localPoint?.y ?? (e.clientY - rect.top) / rect.height;

    setShapeDrawState(prev => ({
      ...prev,
      currentX: x,
      currentY: y,
    }));
  }, [clientToLocalPoint, shapeDrawState.isDrawing, svgRef]);

  const handleShapeMouseUp = useCallback((e?: React.MouseEvent) => {
    if (!shapeDrawState.isDrawing || !selectedClip) {
      setShapeDrawState(prev => ({ ...prev, isDrawing: false }));
      return;
    }

    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const { startX, startY, currentX, currentY } = shapeDrawState;
    const minX = Math.min(startX, currentX);
    const maxX = Math.max(startX, currentX);
    const minY = Math.min(startY, currentY);
    const maxY = Math.max(startY, currentY);

    if (maxX - minX < 0.01 || maxY - minY < 0.01) {
      setShapeDrawState(prev => ({ ...prev, isDrawing: false }));
      return;
    }

    let vertices: MaskVertex[];

    if (maskEditMode === 'drawingRect') {
      vertices = [
        { id: `v-${Date.now()}-1`, x: minX, y: minY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
        { id: `v-${Date.now()}-2`, x: maxX, y: minY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
        { id: `v-${Date.now()}-3`, x: maxX, y: maxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
        { id: `v-${Date.now()}-4`, x: minX, y: maxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      ];
    } else {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = (maxX - minX) / 2;
      const ry = (maxY - minY) / 2;
      const k = 0.5523;

      vertices = [
        { id: `v-${Date.now()}-1`, x: cx, y: minY, handleIn: { x: -rx * k, y: 0 }, handleOut: { x: rx * k, y: 0 }, handleMode: 'mirrored' },
        { id: `v-${Date.now()}-2`, x: maxX, y: cy, handleIn: { x: 0, y: -ry * k }, handleOut: { x: 0, y: ry * k }, handleMode: 'mirrored' },
        { id: `v-${Date.now()}-3`, x: cx, y: maxY, handleIn: { x: rx * k, y: 0 }, handleOut: { x: -rx * k, y: 0 }, handleMode: 'mirrored' },
        { id: `v-${Date.now()}-4`, x: minX, y: cy, handleIn: { x: 0, y: ry * k }, handleOut: { x: 0, y: -ry * k }, handleMode: 'mirrored' },
      ];
    }

    const maskId = addMask(selectedClip.id, {
      name: maskEditMode === 'drawingRect' ? 'Rectangle Mask' : 'Ellipse Mask',
      vertices,
      closed: true,
    });
    setActiveMask(selectedClip.id, maskId);
    setMaskEditMode('editing');

    setShapeDrawState({
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isDrawing: false,
    });

    justFinishedDrawing.current = true;
  }, [shapeDrawState, selectedClip, maskEditMode, addMask, setActiveMask, setMaskEditMode]);

  return {
    shapeDrawState,
    justFinishedDrawing,
    handleShapeMouseDown,
    handleShapeMouseMove,
    handleShapeMouseUp,
  };
}
