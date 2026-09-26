import type { AnimatableProperty } from '../../../../../types/animationProperties';
import type { Keyframe } from '../../../../../types/keyframes';
import type { PreviewFrame } from '../../../../../services/nodePreview/previewTypes';
import type { CanvasNodeDrag } from './canvasNodeDrag';
import type { NodeCableStyle } from '../../../../../types/nodeGraph';

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
  appearance?: number; disappearing?: boolean;
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
  id?: string; appearance?: number; disappearing?: boolean;
  /** Endpoint node ids: a new cable connects once both of its nodes have appeared. */
  fromNode?: string; toNode?: string;
  /** Endpoint branch points; a pointer drag moves these ends with the point. */
  fromBranch?: string; toBranch?: string;
  occlusions?: Rect[];
  baked?: boolean;
  from: Point; to: Point; color: string; highlighted: boolean; draft?: boolean;
  /** Omitted for the default bezier. */
  style?: NodeCableStyle;
  /** Waypoints around cards when obstacle avoidance is on. */
  via?: Point[];
}
export interface CanvasPlug { id?: string; nodeId?: string; center: Point; tip: Point; input: boolean; color: string; highlighted: boolean; ghost?: boolean }
/** Presentation-only cable branch point. */
export interface CanvasBranch extends Point { id: string; color: string; selected: boolean }
export interface CanvasGroup extends Rect { fillOpacity?: number; id?: string; nodeIds?: string[]; label: string; color: string; collapsed: boolean; count: string; bypassable?: boolean; bypassed?: boolean }
/** glideMs: the worker eases positions from what it currently shows to this scene. */
export interface CanvasScene { graphId?: string; nodes: CanvasNode[]; cables: CanvasCable[]; groups: CanvasGroup[]; plugs: CanvasPlug[]; branches?: CanvasBranch[]; glideMs?: number }
export interface CanvasTransport { playhead: number; playing: boolean; active: boolean; visible: boolean; reducedMotion: boolean; sourceTimes: Record<string, number>; playbackSpeed?: number; timestamp?: number }
export type CanvasMessage =
  | { type: 'init' }
  | { type: 'presented' }
  | { type: 'previews'; frames: PreviewFrame[]; batchId: number }
  | { type: 'scene'; scene: CanvasScene }
  | { type: 'view'; view: CanvasView; theme: CanvasTheme; revision?: number }
  | { type: 'transport'; transport: CanvasTransport }
  /** Hover highlight only repaints the overlay; the scene and base layer stay untouched. */
  | { type: 'hover'; edgeId: string | null }
  /** Pointer drag offset; the scene keeps committed positions until the drop. */
  // `hold` releases the drag once a committed scene has moved the dragged items.
  | { type: 'drag'; drag: CanvasNodeDrag | null; hold?: boolean };

/** Pixels and their coordinate system are presented together on the main thread. */
export type CanvasWorkerReply =
  | { type: 'frame'; bitmap: ImageBitmap; revision?: number }
  | { type: 'failed' }
  | { type: 'previews-ready'; batchId: number; previewCount: number | undefined }
  | { type: 'previews-evicted'; keys: string[] }
  | { type: 'motion'; active: boolean }
  | { type: 'stats'; fps: number; paintMs: number; maxPaintMs: number; phases?: { baseMs: number; overlayMs: number; previewMs: number; updateMs?: number; drawMs?: number; composeMs?: number } };
