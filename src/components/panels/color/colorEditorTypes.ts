import type { CSSProperties } from 'react';
import type { NodeGraphSignalType } from '../../../types/nodeGraph';

export interface ColorEditorPort {
  id: string;
  label: string;
  type: NodeGraphSignalType;
}

export interface ColorEditorNode {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
  params: Record<string, unknown>;
  position: { x: number; y: number };
  inputs?: ColorEditorPort[];
  outputs?: ColorEditorPort[];
}

export interface ColorEditorEdge {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  type: NodeGraphSignalType;
}

export interface ColorEditorVersion {
  id: string;
  name: string;
}

export interface ColorEditorViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ColorEditorParamDefinition {
  key: string;
  label: string;
  section: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
}

export interface ConnectionDragState {
  fromNodeId: string;
  fromPortId: string;
  type: NodeGraphSignalType;
  start: { x: number; y: number };
  current: { x: number; y: number };
  validTarget?: { nodeId: string; portId: string };
}

export interface ColorGraphMarquee {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

export type ColorProperty = string;

export type ColorGraphContentStyle = CSSProperties & {
  width: number;
  height: number;
};
