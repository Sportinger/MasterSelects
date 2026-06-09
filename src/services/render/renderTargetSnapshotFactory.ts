import type {
  RenderOutputSliceDescriptor,
  RenderSlicePoint,
  RenderSliceWarp,
  RenderTargetDescriptor,
  RenderTargetSnapshot,
  RenderTargetSource,
} from '../../engine/render/contracts';
import { useMediaStore } from '../../stores/mediaStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useSliceStore } from '../../stores/sliceStore';
import type { RenderSource } from '../../types/renderTarget';
import type { OutputSlice, SliceWarp } from '../../types/outputSlice';

function clonePoint(point: RenderSlicePoint): RenderSlicePoint {
  return { x: point.x, y: point.y };
}

function cloneCorners(
  corners: readonly [RenderSlicePoint, RenderSlicePoint, RenderSlicePoint, RenderSlicePoint],
): readonly [RenderSlicePoint, RenderSlicePoint, RenderSlicePoint, RenderSlicePoint] {
  return [
    clonePoint(corners[0]),
    clonePoint(corners[1]),
    clonePoint(corners[2]),
    clonePoint(corners[3]),
  ];
}

function mapSource(source: RenderSource): RenderTargetSource {
  switch (source.type) {
    case 'activeComp':
      return { type: 'activeComp' };
    case 'program':
      return { type: 'program' };
    case 'composition':
      return { type: 'composition', compositionId: source.compositionId };
    case 'layer':
      return {
        type: 'layer',
        compositionId: source.compositionId,
        layerIds: [...source.layerIds],
      };
    case 'layer-index':
      return {
        type: 'layer-index',
        compositionId: source.compositionId,
        layerIndex: source.layerIndex,
      };
    case 'slot':
      return { type: 'slot', slotIndex: source.slotIndex };
  }
}

function mapWarp(warp: SliceWarp): RenderSliceWarp {
  if (warp.mode === 'cornerPin') {
    return {
      mode: 'cornerPin',
      corners: cloneCorners(warp.corners),
    };
  }

  return {
    mode: 'meshGrid',
    cols: warp.cols,
    rows: warp.rows,
    points: warp.points.map(clonePoint),
  };
}

function mapSlice(slice: OutputSlice): RenderOutputSliceDescriptor {
  return {
    id: slice.id,
    name: slice.name,
    type: slice.type,
    inverted: slice.inverted,
    enabled: slice.enabled,
    inputCorners: cloneCorners(slice.inputCorners),
    warp: mapWarp(slice.warp),
  };
}

function getActiveCompositionResolution(): { width: number; height: number } {
  const mediaState = useMediaStore.getState();
  const composition = mediaState.activeCompositionId
    ? mediaState.compositions.find((entry) => entry.id === mediaState.activeCompositionId)
    : null;

  return {
    width: composition?.width ?? 1920,
    height: composition?.height ?? 1080,
  };
}

export function captureRenderTargetSnapshot(): RenderTargetSnapshot {
  const targetState = useRenderTargetStore.getState();
  const sliceState = useSliceStore.getState();

  const targets: RenderTargetDescriptor[] = [...targetState.targets.values()].map((target) => ({
    id: target.id,
    name: target.name,
    source: mapSource(target.source),
    destinationType: target.destinationType,
    enabled: target.enabled,
    showTransparencyGrid: target.showTransparencyGrid,
    isFullscreen: target.isFullscreen,
  }));

  return {
    resolution: getActiveCompositionResolution(),
    targets,
    activeCompositionTargetIds: targetState.getActiveCompTargets().map((target) => target.id),
    independentTargetIds: targetState.getIndependentTargets().map((target) => target.id),
    sliceConfigs: Object.fromEntries(
      [...sliceState.configs.entries()].map(([targetId, config]) => [
        targetId,
        {
          targetId: config.targetId,
          slices: config.slices.map(mapSlice),
          selectedSliceId: config.selectedSliceId,
        },
      ]),
    ),
    outputPreview: {
      activeTab: sliceState.activeTab,
      previewingTargetId: sliceState.previewingTargetId,
    },
  };
}
