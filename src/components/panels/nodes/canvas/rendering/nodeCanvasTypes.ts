import type { AnimatableProperty } from '../../../../../types/animationProperties';
import type { Keyframe } from '../../../../../types/keyframes';
import type { PreviewFrame } from '../../../../../services/nodePreview/previewTypes';

// Only drawing data crosses the worker boundary, never graph params or media handles.
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface CanvasView { zoom: number; panX: number; panY: number; width: number; height: number; ratio: number; moving?: boolean }
export interface CanvasTheme { background: string; card: string; text: string; muted: string; border: string; accent: string }
export interface CanvasPort extends Point { id?: string; label: string; type: string; color: string; input: boolean; highlighted?: boolean }
export interface CanvasCurve extends Rect {
  clipId: string; start: number; duration: number; property: AnimatableProperty;
  sourceTime: boolean; keys: Keyframe[]; value: number; points: number[];
  compactBadge: boolean; channels: number;
  activityKeys: Array<{ property: AnimatableProperty; keys: Keyframe[]; sourceTime: boolean }>;
}
export interface CanvasNode extends Rect {
  id: string; label: string; description: string; kind: string; runtime: string;
  color: string; selected: boolean; bypassed: boolean; bypassable: boolean;
  badges: Array<{ label: string; tone: string }>; ports: CanvasPort[];
  curve?: CanvasCurve;
  viewerEnabled?: boolean;
  valueBesideOutput?: boolean;
  expandable?: boolean;
  mathSymbol?: Point & { text: string };
  preview?: Rect & { key: string; label: string; text?: boolean };
}
export interface CanvasCable {
  occlusions?: Rect[];
  baked?: boolean;
  from: Point; to: Point; color: string; highlighted: boolean; draft?: boolean;
}
export interface CanvasPlug { center: Point; tip: Point; input: boolean; color: string; highlighted: boolean; ghost?: boolean }
export interface CanvasGroup extends Rect { label: string; color: string; collapsed: boolean; count: string; bypassable?: boolean; bypassed?: boolean }
export interface CanvasScene { nodes: CanvasNode[]; cables: CanvasCable[]; groups: CanvasGroup[]; plugs: CanvasPlug[] }
export interface CanvasTransport { playhead: number; playing: boolean; active: boolean; visible: boolean; reducedMotion: boolean; sourceTimes: Record<string, number>; playbackSpeed?: number; timestamp?: number }
export type CanvasMessage =
  | { type: 'init' }
  | { type: 'presented' }
  | { type: 'previews'; frames: PreviewFrame[]; batchId: number }
  | { type: 'scene'; scene: CanvasScene }
  | { type: 'view'; view: CanvasView; theme: CanvasTheme; revision?: number }
  | { type: 'transport'; transport: CanvasTransport };

/** Pixels and their coordinate system are presented together on the main thread. */
export type CanvasWorkerReply =
  | { type: 'frame'; bitmap: ImageBitmap; revision?: number }
  | { type: 'failed' }
  | { type: 'previews-ready'; batchId: number; previewCount: number | undefined }
  | { type: 'stats'; fps: number; paintMs: number; maxPaintMs: number; phases?: { baseMs: number; overlayMs: number; previewMs: number } };
