const SCENE_GIZMO_TOUCH_DRAG_SELECTOR = [
  '.preview-scene-object-handle',
  '.preview-scene-gizmo-axis',
  '.preview-scene-gizmo-rotate',
].join(',');

export function isSceneGizmoTouchDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest(SCENE_GIZMO_TOUCH_DRAG_SELECTOR) !== null;
}
