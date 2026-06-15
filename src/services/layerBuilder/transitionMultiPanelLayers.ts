import type { Layer } from '../../types';
import type { TransitionPrimitive } from '../../transitions';
import {
  createTransitionMultiPanelPlan,
  type TransitionMultiPanelCellPlan,
} from './transitionMultiPanelPlan';

type MultiPanelPrimitive = Extract<TransitionPrimitive, { kind: 'multi-panel' }>;

export interface CreateTransitionMultiPanelLayersInput {
  baseLayer: Layer;
  primitive: MultiPanelPrimitive;
  progress: number;
  seed: number;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function panelCenter(panel: TransitionMultiPanelCellPlan): { x: number; y: number } {
  return {
    x: panel.sourceRect.x + panel.sourceRect.width * 0.5,
    y: panel.sourceRect.y + panel.sourceRect.height * 0.5,
  };
}

function addRotationZ(rotation: Layer['rotation'], rotateZ: number): Layer['rotation'] {
  if (rotateZ === 0) return rotation;
  if (typeof rotation === 'number') return rotation + rotateZ;
  return {
    ...rotation,
    z: rotation.z + rotateZ,
  };
}

function puzzleOffset(panel: TransitionMultiPanelCellPlan): { x: number; y: number } {
  const travel = (1 - panel.progress) * 0.22;
  const direction = (panel.row + panel.column) % 4;
  if (direction === 0) return { x: -travel, y: 0 };
  if (direction === 1) return { x: travel, y: 0 };
  if (direction === 2) return { x: 0, y: -travel };
  return { x: 0, y: travel };
}

function magneticOffset(panel: TransitionMultiPanelCellPlan): { x: number; y: number } {
  const center = panelCenter(panel);
  const pull = (1 - panel.progress) * 0.45;
  return {
    x: (0.5 - center.x) * pull,
    y: (0.5 - center.y) * pull,
  };
}

function shatterOffset(panel: TransitionMultiPanelCellPlan): { x: number; y: number } {
  const center = panelCenter(panel);
  const push = panel.progress * 0.38;
  return {
    x: (center.x - 0.5) * push,
    y: (center.y - 0.5) * push,
  };
}

function panelMotion(
  primitive: MultiPanelPrimitive,
  panel: TransitionMultiPanelCellPlan,
): { x: number; y: number; rotateZ: number; opacity: number } {
  if (primitive.motion === 'magnetic') {
    return {
      ...magneticOffset(panel),
      rotateZ: 0,
      opacity: panel.progress,
    };
  }

  if (primitive.motion === 'shatter') {
    const direction = panel.index % 2 === 0 ? 1 : -1;
    return {
      ...shatterOffset(panel),
      rotateZ: direction * panel.progress * 0.28,
      opacity: 1 - panel.progress,
    };
  }

  const offset = puzzleOffset(panel);
  return {
    ...offset,
    rotateZ: 0,
    opacity: panel.progress,
  };
}

function panelPositionValue(value: number, size: number): number {
  return value / Math.max(size, 0.0001);
}

export function createTransitionMultiPanelLayers({
  baseLayer,
  primitive,
  progress,
  seed,
}: CreateTransitionMultiPanelLayersInput): Layer[] {
  const panelPlan = createTransitionMultiPanelPlan({
    rows: primitive.rows,
    columns: primitive.columns,
    progress: clamp01(progress),
    order: primitive.order,
    seed: primitive.seed ?? seed,
    stagger: primitive.stagger,
  });

  return panelPlan
    .toSorted((a, b) => a.zIndex - b.zIndex || a.index - b.index)
    .flatMap((panel): Layer[] => {
      const motion = panelMotion(primitive, panel);
      const opacity = baseLayer.opacity * clamp01(motion.opacity);
      if (opacity <= 0.001) return [];

      const center = panelCenter(panel);
      const sourceRect = { ...panel.sourceRect };
      return [{
        ...baseLayer,
        id: `${baseLayer.id}:${panel.id}`,
        name: `${baseLayer.name} ${panel.id}`,
        opacity,
        sourceRect,
        position: {
          x: baseLayer.position.x + panelPositionValue(center.x - 0.5 + motion.x, sourceRect.width),
          y: baseLayer.position.y + panelPositionValue(center.y - 0.5 + motion.y, sourceRect.height),
          z: baseLayer.position.z + panel.zIndex * 0.0001,
        },
        scale: {
          ...baseLayer.scale,
          x: baseLayer.scale.x * sourceRect.width,
          y: baseLayer.scale.y * sourceRect.height,
        },
        rotation: addRotationZ(baseLayer.rotation, motion.rotateZ),
      }];
    });
}
