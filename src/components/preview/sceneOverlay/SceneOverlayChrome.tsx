import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  PreviewSceneObject,
  SceneAxisScreenHandle,
  SceneGizmoAxis,
  SceneGizmoMode,
} from '../sceneObjectOverlayMath';
import { AXIS_LABELS, getAxisStyle, getCenterHandleLabel, getObjectBadge, MODE_LABELS } from './sceneOverlayDisplayPlans';
import { ROTATE_RING_VIEWBOX_SIZE } from './sceneOverlayProjectionPlans';
import type {
  DisplayCameraWireframePath,
  DisplaySceneObject,
  DisplayWorldGridPath,
  ProjectedRotateRing,
} from './sceneOverlayTypes';

interface SvgOverlayProps<TPath> {
  canvasSize: { width: number; height: number };
  paths: TPath[];
}

export function SceneWorldGridSvg({
  canvasSize,
  paths,
}: SvgOverlayProps<DisplayWorldGridPath>) {
  if (paths.length === 0) return null;

  return (
    <svg
      className="preview-scene-world-grid"
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
      aria-hidden="true"
    >
      {paths.map((path) => (
        <path
          key={path.key}
          className={`preview-scene-world-grid-line ${path.kind}`}
          d={path.d}
        />
      ))}
    </svg>
  );
}

export function SceneCameraWireframeSvg({
  canvasSize,
  paths,
}: SvgOverlayProps<DisplayCameraWireframePath>) {
  if (paths.length === 0) return null;

  return (
    <svg
      className="preview-camera-wireframe"
      width={canvasSize.width}
      height={canvasSize.height}
      viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
      aria-hidden="true"
    >
      {paths.map((path) => (
        <path
          key={path.key}
          className={`preview-camera-wireframe-line role-${path.role} ${path.selected ? 'selected' : ''}`}
          d={path.d}
        />
      ))}
    </svg>
  );
}

interface SceneRotateGizmoProps {
  selectedObject: PreviewSceneObject;
  rotateRings: ProjectedRotateRing[];
  hoveredAxis: SceneGizmoAxis | null;
  onMouseMove: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onMouseDown: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<SVGSVGElement>) => void;
  onMouseLeave: () => void;
}

export function SceneRotateGizmo({
  selectedObject,
  rotateRings,
  hoveredAxis,
  onMouseMove,
  onMouseDown,
  onDoubleClick,
  onMouseLeave,
}: SceneRotateGizmoProps) {
  return (
    <svg
      className="preview-scene-gizmo-rotate"
      style={{
        left: selectedObject.screen.x,
        top: selectedObject.screen.y,
        width: ROTATE_RING_VIEWBOX_SIZE,
        height: ROTATE_RING_VIEWBOX_SIZE,
      }}
      viewBox={`0 0 ${ROTATE_RING_VIEWBOX_SIZE} ${ROTATE_RING_VIEWBOX_SIZE}`}
      aria-hidden="true"
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseLeave={onMouseLeave}
    >
      {rotateRings.map((ring) => (
        <g
          key={ring.axis}
          className={`preview-scene-gizmo-rotate-ring axis-${ring.axis} ${hoveredAxis === ring.axis ? 'is-hovered' : ''}`}
        >
          <path className="preview-scene-gizmo-rotate-hit" d={ring.path} />
          <path className="preview-scene-gizmo-rotate-stroke" d={ring.path} />
        </g>
      ))}
    </svg>
  );
}

interface SceneAxisGizmoLayerProps {
  mode: SceneGizmoMode;
  axisHandles: SceneAxisScreenHandle[];
  hoveredAxis: SceneGizmoAxis | null;
  onAxisHover: (axis: SceneGizmoAxis | null) => void;
  onAxisMouseDown: (event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => void;
  onAxisDoubleClick: (event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => void;
}

export function SceneAxisGizmoLayers({
  mode,
  axisHandles,
  hoveredAxis,
  onAxisHover,
  onAxisMouseDown,
  onAxisDoubleClick,
}: SceneAxisGizmoLayerProps) {
  return (
    <>
      {axisHandles.map((handle) => (
        <div key={`${mode}-${handle.axis}`} className="preview-scene-gizmo-axis-layer">
          <button
            type="button"
            className={`preview-scene-gizmo-axis axis-${handle.axis} mode-${mode} ${hoveredAxis === handle.axis ? 'is-hovered' : ''}`}
            style={getAxisStyle(handle)}
            aria-label={`${MODE_LABELS[mode]} ${AXIS_LABELS[handle.axis]}`}
            onMouseEnter={() => onAxisHover(handle.axis)}
            onMouseLeave={() => onAxisHover(null)}
            onMouseDown={(event) => onAxisMouseDown(event, handle)}
            onDoubleClick={(event) => onAxisDoubleClick(event, handle)}
          >
            <span className="preview-scene-gizmo-axis-line" />
            <span className="preview-scene-gizmo-end" />
          </button>
          <span
            className={`preview-scene-gizmo-label axis-${handle.axis}`}
            style={{
              left: handle.end.x + handle.direction.x * 12,
              top: handle.end.y + handle.direction.y * 12,
            }}
          >
            {AXIS_LABELS[handle.axis]}
          </span>
        </div>
      ))}
    </>
  );
}

interface SceneObjectHandlesProps {
  objects: DisplaySceneObject[];
  selectedClipId: string | null;
  mode: SceneGizmoMode;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, object: PreviewSceneObject) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLButtonElement>, object: PreviewSceneObject) => void;
}

export function SceneObjectHandles({
  objects,
  selectedClipId,
  mode,
  onPointerDown,
  onDoubleClick,
}: SceneObjectHandlesProps) {
  return (
    <>
      {objects.map((object) => {
        if (!object.screen.visible) return null;
        const selected = object.clipId === selectedClipId;
        if (object.kind === 'camera' && !selected) return null;
        const centerDraggable = selected && (mode === 'move' || mode === 'scale');
        const label = centerDraggable ? getCenterHandleLabel(mode) : object.name;
        return (
          <button
            key={object.clipId}
            type="button"
            className={`preview-scene-object-handle kind-${object.kind} ${selected ? `selected gizmo-center mode-${mode}` : ''} ${centerDraggable ? 'center-draggable' : ''}`}
            style={{
              left: selected ? object.screen.x : object.displayX,
              top: selected ? object.screen.y : object.displayY,
            }}
            title={label}
            aria-label={label}
            onPointerDown={(event) => onPointerDown(event, object)}
            onDoubleClick={(event) => onDoubleClick(event, object)}
          >
            <span>{getObjectBadge(object.kind)}</span>
          </button>
        );
      })}
    </>
  );
}

interface SceneGizmoToolbarProps {
  mode: SceneGizmoMode;
  onModeChange: (mode: SceneGizmoMode) => void;
}

export function SceneGizmoToolbar({
  mode,
  onModeChange,
}: SceneGizmoToolbarProps) {
  return (
    <div className="preview-scene-gizmo-toolbar">
      {(['move', 'rotate', 'scale'] as SceneGizmoMode[]).map((nextMode) => (
        <button
          key={nextMode}
          type="button"
          className={nextMode === mode ? 'active' : ''}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onModeChange(nextMode);
          }}
        >
          {MODE_LABELS[nextMode]}
        </button>
      ))}
    </div>
  );
}
