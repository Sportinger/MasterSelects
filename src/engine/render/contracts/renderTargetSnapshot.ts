/**
 * Freezes the data-only output routing view from renderTargetStore and sliceStore.
 * First implementor: a renderTargetStore plus sliceStore adapter.
 * Eliminates class-c getState reads in RenderDispatcher target selection,
 * slice lookup, output preview mirroring, and transparency-grid routing.
 */

import type { RenderResolution } from './renderFrameSnapshot';

export type RenderTargetSource =
  | { readonly type: 'activeComp' }
  | { readonly type: 'program' }
  | { readonly type: 'composition'; readonly compositionId: string }
  | { readonly type: 'layer'; readonly compositionId: string; readonly layerIds: readonly string[] }
  | { readonly type: 'layer-index'; readonly compositionId: string | null; readonly layerIndex: number }
  | { readonly type: 'slot'; readonly slotIndex: number };

export type RenderTargetDestinationType = 'canvas' | 'window' | 'tab';

export interface RenderTargetDescriptor {
  readonly id: string;
  readonly name: string;
  readonly source: RenderTargetSource;
  readonly destinationType: RenderTargetDestinationType;
  readonly enabled: boolean;
  readonly showTransparencyGrid: boolean;
  readonly isFullscreen: boolean;
}

export interface RenderSlicePoint {
  readonly x: number;
  readonly y: number;
}

export type RenderSliceWarp =
  | {
      readonly mode: 'cornerPin';
      readonly corners: readonly [RenderSlicePoint, RenderSlicePoint, RenderSlicePoint, RenderSlicePoint];
    }
  | {
      readonly mode: 'meshGrid';
      readonly cols: number;
      readonly rows: number;
      readonly points: readonly RenderSlicePoint[];
    };

export type RenderSliceItemType = 'slice' | 'mask';

export interface RenderOutputSliceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly type: RenderSliceItemType;
  readonly inverted: boolean;
  readonly enabled: boolean;
  readonly inputCorners: readonly [RenderSlicePoint, RenderSlicePoint, RenderSlicePoint, RenderSlicePoint];
  readonly warp: RenderSliceWarp;
}

export interface RenderTargetSliceConfig {
  readonly targetId: string;
  readonly slices: readonly RenderOutputSliceDescriptor[];
  readonly selectedSliceId: string | null;
}

export interface RenderOutputPreviewState {
  readonly activeTab: 'input' | 'output';
  readonly previewingTargetId: string | null;
}

export interface RenderTargetSnapshot {
  readonly resolution: RenderResolution;
  readonly targets: readonly RenderTargetDescriptor[];
  readonly activeCompositionTargetIds: readonly string[];
  readonly independentTargetIds: readonly string[];
  readonly sliceConfigs: Readonly<Record<string, RenderTargetSliceConfig>>;
  readonly outputPreview: RenderOutputPreviewState;
}

export function findRenderTargetDescriptor(
  snapshot: RenderTargetSnapshot,
  targetId: string,
): RenderTargetDescriptor | undefined {
  return snapshot.targets.find((target) => target.id === targetId);
}
