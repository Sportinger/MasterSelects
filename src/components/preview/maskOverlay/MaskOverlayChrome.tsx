import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { inferMaskVertexHandleMode } from '../../../utils/maskVertexHandles';
import type { ClipMask } from "../../../types/masks";
import { createMaskEdgeId, getMaskEdgeFeather } from '../../../utils/maskEdgeFeathers';
import { getDisplayHandleEndpoint } from './maskOverlayGeometry';
import type {
  CanvasMaskVertex,
  MaskEdgeSegment,
  PenEdgeInsertPreview,
  VisibleMaskPath,
} from './maskOverlayTypes';

type VertexMouseTarget = 'vertex' | 'handleIn' | 'handleOut';
const FEATHER_PREVIEW_GRADIENT_STEPS = 32;

interface MaskOverlayChromeProps {
  svgRef: RefObject<SVGSVGElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  displayWidth: number;
  displayHeight: number;
  viewZoom: number;
  maskEditMode: string;
  activeMask: ClipMask | undefined;
  selectedVertexIds: Set<string>;
  selectedMaskEdgeId: string | null;
  featherPreview: { edgeId: string | null; changedAt: number; phase: 'in' | 'out' } | null;
  hoveredVertexId: string | null;
  hoveredEdgeKey: string | null;
  penInsertPreview: PenEdgeInsertPreview | null;
  shapePreviewPath: string;
  pathData: string;
  visibleMaskPaths: VisibleMaskPath[];
  edgeSegments: MaskEdgeSegment[];
  canvasVertices: CanvasMaskVertex[];
  onSvgClick: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onPenMouseDown: (event: ReactMouseEvent<SVGSVGElement>) => boolean;
  onShapeMouseDown: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onShapeMouseMove: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onShapeMouseUp: () => void;
  onClearPenInsertPreview: () => void;
  onMaskDragStart: (event: ReactMouseEvent<Element>) => void;
  onEdgeMouseDown: (event: ReactMouseEvent<Element>, idA: string, idB: string) => void;
  onVertexMouseDown: (event: ReactMouseEvent<Element>, vertexId: string, target: VertexMouseTarget) => void;
  onVertexDoubleClick: (event: ReactMouseEvent<Element>, vertexId: string) => void;
  onFirstVertexClose: (event: ReactMouseEvent<Element>) => void;
  onHoveredEdgeChange: (edgeKey: string | null) => void;
  onHoveredVertexChange: (vertexId: string | null) => void;
}

function getCursor(maskEditMode: string): string {
  if (maskEditMode === 'drawingRect' || maskEditMode === 'drawingEllipse' || maskEditMode === 'drawingPen') {
    return 'crosshair';
  }
  if (maskEditMode === 'drawing') return 'crosshair';
  return 'default';
}

export function MaskOverlayChrome({
  svgRef,
  canvasWidth,
  canvasHeight,
  displayWidth,
  displayHeight,
  viewZoom,
  maskEditMode,
  activeMask,
  selectedVertexIds,
  selectedMaskEdgeId,
  featherPreview,
  hoveredVertexId,
  hoveredEdgeKey,
  penInsertPreview,
  shapePreviewPath,
  pathData,
  visibleMaskPaths,
  edgeSegments,
  canvasVertices,
  onSvgClick,
  onPenMouseDown,
  onShapeMouseDown,
  onShapeMouseMove,
  onShapeMouseUp,
  onClearPenInsertPreview,
  onMaskDragStart,
  onEdgeMouseDown,
  onVertexMouseDown,
  onVertexDoubleClick,
  onFirstVertexClose,
  onHoveredEdgeChange,
  onHoveredVertexChange,
}: MaskOverlayChromeProps) {
  const hitPaddingX = canvasWidth * 2;
  const hitPaddingY = canvasHeight * 2;
  const hitViewBoxWidth = canvasWidth + hitPaddingX * 2;
  const hitViewBoxHeight = canvasHeight + hitPaddingY * 2;
  const zoomScale = Math.max(viewZoom, 0.0001);
  const unitsPerScreenPx = Math.max(
    displayWidth > 0 ? canvasWidth / displayWidth : 1,
    displayHeight > 0 ? canvasHeight / displayHeight : 1,
  ) / zoomScale;
  const vertexSize = 8 * unitsPerScreenPx;
  const handleSize = 6 * unitsPerScreenPx;
  const vertexHitRadius = 14 * unitsPerScreenPx;
  const thinStrokeWidth = unitsPerScreenPx;
  const outlineStrokeWidth = 2 * unitsPerScreenPx;
  const ringStrokeWidth = 1.5 * unitsPerScreenPx;
  const edgeHighlightWidth = 4 * unitsPerScreenPx;
  const edgeHitWidth = 16 * unitsPerScreenPx;
  const insertRadius = 7 * unitsPerScreenPx;
  const insertCrossSize = 4 * unitsPerScreenPx;
  const minHandleLength = 24 * unitsPerScreenPx;
  const dashPattern = `${5 * unitsPerScreenPx},${5 * unitsPerScreenPx}`;
  const featherPreviewAmount = activeMask && featherPreview
    ? featherPreview.edgeId
      ? getMaskEdgeFeather(activeMask, featherPreview.edgeId)
      : activeMask.feather
    : 0;
  const featherPreviewPath = activeMask && featherPreview
    ? featherPreview.edgeId
      ? edgeSegments.find(seg => createMaskEdgeId(seg.idA, seg.idB) === featherPreview.edgeId)?.d ?? ''
      : pathData
    : '';
  const featherPreviewRadius = Math.max(3 * unitsPerScreenPx, featherPreviewAmount * unitsPerScreenPx);
  const showFeatherPreview = featherPreviewPath.length > 0 && featherPreviewAmount > 0;
  const featherPreviewStrokes = showFeatherPreview
    ? Array.from({ length: FEATHER_PREVIEW_GRADIENT_STEPS }, (_, index) => {
        const step = index + 1;
        const targetBefore = 0.5 * ((step - 1) / FEATHER_PREVIEW_GRADIENT_STEPS);
        const targetAfter = 0.5 * (step / FEATHER_PREVIEW_GRADIENT_STEPS);
        return {
          opacity: 1 - ((1 - targetAfter) / (1 - targetBefore)),
          strokeWidth: 2 * featherPreviewRadius * ((FEATHER_PREVIEW_GRADIENT_STEPS - index) / FEATHER_PREVIEW_GRADIENT_STEPS),
        };
      })
    : [];

  return (
    <svg
      ref={svgRef}
      className="mask-overlay-svg"
      viewBox={`${-hitPaddingX} ${-hitPaddingY} ${hitViewBoxWidth} ${hitViewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={onSvgClick}
      onMouseDown={(e) => {
        if (onPenMouseDown(e)) return;
        onShapeMouseDown(e);
      }}
      onMouseMove={(e) => {
        onShapeMouseMove(e);
      }}
      onMouseUp={onShapeMouseUp}
      onMouseLeave={() => {
        onClearPenInsertPreview();
        onShapeMouseUp();
      }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: displayWidth * (hitViewBoxWidth / canvasWidth),
        height: displayHeight * (hitViewBoxHeight / canvasHeight),
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        cursor: getCursor(maskEditMode),
      }}
    >
      {shapePreviewPath && (
        <path
          d={shapePreviewPath}
          fill="rgba(45, 140, 235, 0.15)"
          stroke="#2997E5"
          strokeWidth={outlineStrokeWidth}
          strokeDasharray={dashPattern}
          pointerEvents="none"
        />
      )}

      {activeMask?.closed && activeMask.visible && pathData && (
        <path
          d={pathData}
          fill="transparent"
          stroke="none"
          pointerEvents={maskEditMode === 'editing' ? 'all' : 'none'}
          cursor="move"
          onMouseDown={onMaskDragStart}
        />
      )}

      {visibleMaskPaths.map(maskPath => (
        <path
          key={`mask-outline-${maskPath.id}`}
          d={maskPath.d}
          fill="none"
          stroke={maskPath.color}
          strokeWidth={outlineStrokeWidth}
          strokeDasharray={maskPath.closed ? 'none' : dashPattern}
          pointerEvents="none"
        />
      ))}

      {showFeatherPreview && (
        <g
          className={`mask-feather-preview ${featherPreview?.phase === 'out' ? 'fade-out' : 'fade-in'}`}
          pointerEvents="none"
        >
          {featherPreviewStrokes.map((stroke, index) => (
            <path
              key={`feather-gradient-${index}`}
              d={featherPreviewPath}
              fill="none"
              stroke={`rgba(255, 0, 0, ${stroke.opacity})`}
              strokeWidth={stroke.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      )}

      {maskEditMode === 'drawingPen' && penInsertPreview && (
        <g className="mask-edge-insert-preview" pointerEvents="none">
          <circle
            cx={penInsertPreview.canvasX}
            cy={penInsertPreview.canvasY}
            r={insertRadius}
            fill="rgba(255, 153, 0, 0.18)"
            stroke="#ff9900"
            strokeWidth={outlineStrokeWidth}
          />
          <path
            d={`M ${penInsertPreview.canvasX - insertCrossSize} ${penInsertPreview.canvasY} L ${penInsertPreview.canvasX + insertCrossSize} ${penInsertPreview.canvasY} M ${penInsertPreview.canvasX} ${penInsertPreview.canvasY - insertCrossSize} L ${penInsertPreview.canvasX} ${penInsertPreview.canvasY + insertCrossSize}`}
            fill="none"
            stroke="#ff9900"
            strokeWidth={ringStrokeWidth}
          />
        </g>
      )}

      {maskEditMode === 'editing' && activeMask && edgeSegments.map((seg) => {
        const edgeKey = createMaskEdgeId(seg.idA, seg.idB);
        const isSelectedEdge = selectedMaskEdgeId === edgeKey;
        const isHoveredEdge = hoveredEdgeKey === edgeKey;
        return (
          <g
            key={`edge-${edgeKey}`}
            data-guided-target={`mask-edge:${activeMask.id}:${seg.fromIndex}:${seg.toIndex}`}
            data-guided-mask-edge={`${activeMask.id}:${seg.fromIndex}:${seg.toIndex}`}
          >
            {(isHoveredEdge || isSelectedEdge) && (
              <path
                d={seg.d}
                fill="none"
                stroke={isSelectedEdge ? 'rgba(41, 151, 229, 0.95)' : 'rgba(255, 153, 0, 0.85)'}
                strokeWidth={edgeHighlightWidth}
                pointerEvents="none"
                className="mask-edge-highlight"
              />
            )}
            <path
              d={seg.d}
              fill="none"
              stroke="transparent"
              strokeWidth={edgeHitWidth}
              cursor="move"
              pointerEvents="stroke"
              data-guided-target={`mask-edge:${activeMask.id}:${seg.fromIndex}:${seg.toIndex}`}
              data-guided-mask-edge={`${activeMask.id}:${seg.fromIndex}:${seg.toIndex}`}
              onMouseEnter={() => onHoveredEdgeChange(edgeKey)}
              onMouseLeave={() => onHoveredEdgeChange(null)}
              onMouseDown={(e) => onEdgeMouseDown(e, seg.idA, seg.idB)}
            />
          </g>
        );
      })}

      {activeMask && canvasVertices.map((vertex, index) => {
        const isSelected = selectedVertexIds.has(vertex.id);
        const handleMode = inferMaskVertexHandleMode(vertex);
        if (!isSelected || handleMode === 'none') return null;

        const previousVertex = canvasVertices[index - 1] ?? (activeMask.closed ? canvasVertices[canvasVertices.length - 1] : undefined);
        const nextVertex = canvasVertices[index + 1] ?? (activeMask.closed ? canvasVertices[0] : undefined);
        const handleInEndpoint = getDisplayHandleEndpoint(vertex, 'handleIn', previousVertex, nextVertex, minHandleLength);
        const handleOutEndpoint = getDisplayHandleEndpoint(vertex, 'handleOut', previousVertex, nextVertex, minHandleLength);

        return (
          <g key={`handles-${vertex.id}`} className={`mask-handle-group ${handleMode}`}>
            <line
              x1={vertex.x}
              y1={vertex.y}
              x2={handleInEndpoint.x}
              y2={handleInEndpoint.y}
              stroke="#ff9900"
              strokeWidth={thinStrokeWidth}
              pointerEvents="none"
            />
            <circle
              cx={handleInEndpoint.x}
              cy={handleInEndpoint.y}
              r={handleSize / 2 + 1}
              fill="#ff9900"
              stroke="#fff"
              strokeWidth={thinStrokeWidth}
              cursor="move"
              className="mask-handle-point"
              data-guided-target={`mask-handle:${activeMask.id}:${vertex.id}:in`}
              data-guided-mask-handle={`${activeMask.id}:${vertex.id}:in`}
              data-guided-mask-handle-index={`${activeMask.id}:${index}:in`}
              onMouseDown={(e) => onVertexMouseDown(e, vertex.id, 'handleIn')}
            />

            <line
              x1={vertex.x}
              y1={vertex.y}
              x2={handleOutEndpoint.x}
              y2={handleOutEndpoint.y}
              stroke="#ff9900"
              strokeWidth={thinStrokeWidth}
              pointerEvents="none"
            />
            <circle
              cx={handleOutEndpoint.x}
              cy={handleOutEndpoint.y}
              r={handleSize / 2 + 1}
              fill="#ff9900"
              stroke="#fff"
              strokeWidth={thinStrokeWidth}
              cursor="move"
              className="mask-handle-point"
              data-guided-target={`mask-handle:${activeMask.id}:${vertex.id}:out`}
              data-guided-mask-handle={`${activeMask.id}:${vertex.id}:out`}
              data-guided-mask-handle-index={`${activeMask.id}:${index}:out`}
              onMouseDown={(e) => onVertexMouseDown(e, vertex.id, 'handleOut')}
            />
          </g>
        );
      })}

      {activeMask && canvasVertices.map((vertex, index) => {
        const isSelected = selectedVertexIds.has(vertex.id);
        const isHovered = hoveredVertexId === vertex.id;
        const handleMode = inferMaskVertexHandleMode(vertex);
        if (!activeMask.visible && !isSelected) return null;

        const isFirst = index === 0;
        const isClosableFirst = isFirst &&
          (maskEditMode === 'drawing' || maskEditMode === 'drawingPen') &&
          activeMask.vertices.length >= 3;

        return (
          <g
            key={vertex.id}
            className={`mask-vertex-group ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''} ${handleMode}`}
            data-guided-target={`mask-vertex:${activeMask.id}:${vertex.id}`}
            data-guided-mask-vertex={`${activeMask.id}:${vertex.id}`}
            data-guided-mask-vertex-index={`${activeMask.id}:${index}`}
          >
            <circle
              cx={vertex.x}
              cy={vertex.y}
              r={vertexHitRadius}
              fill="transparent"
              stroke="none"
              pointerEvents="all"
              cursor={isClosableFirst ? 'crosshair' : 'move'}
              onMouseEnter={() => onHoveredVertexChange(vertex.id)}
              onMouseLeave={() => onHoveredVertexChange(null)}
              onMouseDown={isClosableFirst
                ? onFirstVertexClose
                : (e) => onVertexMouseDown(e, vertex.id, 'vertex')}
              onDoubleClick={(e) => {
                if (!isClosableFirst) {
                  onVertexDoubleClick(e, vertex.id);
                }
              }}
            />
            {(isSelected || isHovered || isClosableFirst) && (
              <circle
                cx={vertex.x}
                cy={vertex.y}
                r={isClosableFirst ? vertexSize * 1.15 : vertexSize}
                fill="none"
                stroke={isClosableFirst ? '#ff4d4d' : '#ff9900'}
                strokeWidth={ringStrokeWidth}
                className={isSelected ? 'mask-active-vertex-ring' : 'mask-hover-vertex-ring'}
                pointerEvents="none"
              />
            )}
            <rect
              x={vertex.x - vertexSize / 2}
              y={vertex.y - vertexSize / 2}
              width={vertexSize}
              height={vertexSize}
              fill={isSelected ? '#2997E5' : '#fff'}
              stroke={isClosableFirst ? '#ff4d4d' : '#2997E5'}
              strokeWidth={isClosableFirst ? outlineStrokeWidth : thinStrokeWidth}
              cursor={isClosableFirst ? 'crosshair' : 'move'}
              className={`mask-vertex-point ${isSelected ? 'selected' : ''}`}
              data-guided-target={`mask-vertex:${activeMask.id}:${vertex.id}`}
              data-guided-mask-vertex={`${activeMask.id}:${vertex.id}`}
              data-guided-mask-vertex-index={`${activeMask.id}:${index}`}
              onMouseEnter={() => onHoveredVertexChange(vertex.id)}
              onMouseLeave={() => onHoveredVertexChange(null)}
              onMouseDown={isClosableFirst
                ? onFirstVertexClose
                : (e) => onVertexMouseDown(e, vertex.id, 'vertex')}
              onDoubleClick={(e) => {
                if (!isClosableFirst) {
                  onVertexDoubleClick(e, vertex.id);
                }
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
