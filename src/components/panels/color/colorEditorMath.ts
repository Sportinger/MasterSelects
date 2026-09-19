import type { ColorEditorNode, ColorEditorParamDefinition } from './colorEditorTypes';

export const GRAPH_NODE_WIDTH = 64;
export const GRAPH_NODE_HEIGHT = 58;
export const GRAPH_ANCHOR_WIDTH = 14;
export const GRAPH_ANCHOR_HEIGHT = 24;
export const GRAPH_STRUCTURE_WIDTH = 30;
export const GRAPH_STRUCTURE_HEIGHT = 54;
export const GRAPH_NODE_PADDING = 24;
export const GRAPH_INPUT_PORT_LEFT = -12;
export const GRAPH_OUTPUT_PORT_RIGHT = -11;
export const GRAPH_ANCHOR_PORT_SIZE = 8;

export function isColorGraphAnchorNode(node: { type: string }): boolean {
  return node.type === 'input'
    || node.type === 'output'
    || node.type === 'source'
    || node.type === 'alpha-output';
}

export function isOriginalColorGraphAnchorNode(node: { type: string }): boolean {
  return node.type === 'input' || node.type === 'output';
}

export function isColorGraphGradeNode(node: { type: string }): boolean {
  return node.type === 'primary' || node.type === 'wheels';
}

export function isCompactColorGraphStructureNode(node: { type: string }): boolean {
  return node.type === 'parallel-mixer'
    || node.type === 'layer-mixer'
    || node.type === 'key-mixer'
    || node.type === 'splitter'
    || node.type === 'combiner';
}

export function getColorGraphNodeWidth(node: { type: string }): number {
  if (isColorGraphAnchorNode(node)) return GRAPH_ANCHOR_WIDTH;
  return isCompactColorGraphStructureNode(node) ? GRAPH_STRUCTURE_WIDTH : GRAPH_NODE_WIDTH;
}

export function getColorGraphNodeHeight(node: { type: string }): number {
  if (isColorGraphAnchorNode(node)) return GRAPH_ANCHOR_HEIGHT;
  return isCompactColorGraphStructureNode(node) ? GRAPH_STRUCTURE_HEIGHT : GRAPH_NODE_HEIGHT;
}

export function getColorGraphPortY(
  node: ColorEditorNode,
  direction: 'input' | 'output',
  portId: string,
  visualZoom = 1,
): number {
  const ports = (direction === 'input' ? node.inputs : node.outputs) ?? [];
  const index = Math.max(0, ports.findIndex(port => port.id === portId));
  const ratio = ports.length === 2
    ? (index === 0 ? 0.28 : 0.72)
    : ports.length === 3
      ? 0.18 + index * 0.32
      : (index + 1) / (ports.length + 1);
  return getColorGraphNodeTop(node)
    + getColorGraphNodeHeight(node) * ratio / visualZoom;
}

export function getColorGraphPortX(
  node: ColorEditorNode,
  direction: 'input' | 'output',
  visualZoom = 1,
): number {
  const nodeWidth = getColorGraphNodeWidth(node);
  if (isColorGraphAnchorNode(node)) {
    const outerEdge = direction === 'input'
      ? (nodeWidth - GRAPH_ANCHOR_PORT_SIZE) / 2
      : (nodeWidth + GRAPH_ANCHOR_PORT_SIZE) / 2;
    return node.position.x + outerEdge / visualZoom;
  }

  const outerEdge = direction === 'input'
    ? GRAPH_INPUT_PORT_LEFT
    : nodeWidth - GRAPH_OUTPUT_PORT_RIGHT;
  return node.position.x + outerEdge / visualZoom;
}

export function getColorGraphNodeRight(node: ColorEditorNode, visualZoom = 1): number {
  return node.position.x + getColorGraphNodeWidth(node) / visualZoom;
}

export function getColorGraphNodeBottom(node: ColorEditorNode, visualZoom = 1): number {
  return getColorGraphNodeTop(node) + getColorGraphNodeHeight(node) / visualZoom;
}

export function getColorGraphNodeTop(node: { type: string; position: { y: number } }): number {
  return node.position.y + ((GRAPH_NODE_HEIGHT - getColorGraphNodeHeight(node)) / 2);
}

export interface WheelControlConfig {
  id: 'lift' | 'gamma' | 'gain' | 'offset';
  label: string;
  rKey: string;
  gKey: string;
  bKey: string;
  yKey: string;
  chromaRange: number;
}

export const WHEEL_CONTROL_CONFIGS: WheelControlConfig[] = [
  { id: 'lift', label: 'Lift', rKey: 'liftR', gKey: 'liftG', bKey: 'liftB', yKey: 'liftY', chromaRange: 0.35 },
  { id: 'gamma', label: 'Gamma', rKey: 'gammaR', gKey: 'gammaG', bKey: 'gammaB', yKey: 'gammaY', chromaRange: 0.65 },
  { id: 'gain', label: 'Gain', rKey: 'gainR', gKey: 'gainG', bKey: 'gainB', yKey: 'gainY', chromaRange: 0.65 },
  { id: 'offset', label: 'Offset', rKey: 'offsetR', gKey: 'offsetG', bKey: 'offsetB', yKey: 'offsetY', chromaRange: 0.45 },
];

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getControlSections(defs: ColorEditorParamDefinition[]) {
  const sections = new Map<string, ColorEditorParamDefinition[]>();
  for (const def of defs) {
    const sectionDefs = sections.get(def.section) ?? [];
    sectionDefs.push(def);
    sections.set(def.section, sectionDefs);
  }
  return [...sections.entries()];
}

export function getWheelParamDef(
  defs: ColorEditorParamDefinition[],
  key: string
): ColorEditorParamDefinition {
  const def = defs.find(candidate => candidate.key === key);
  if (!def) {
    throw new Error(`Missing wheel color parameter definition for ${key}`);
  }
  return def;
}

export function getWheelPuckPosition(
  config: WheelControlConfig,
  values: { r: number; g: number; b: number },
  neutral: number
): { x: number; y: number } {
  const rBias = values.r - neutral;
  const gBias = values.g - neutral;
  const bBias = values.b - neutral;
  // Resolve presents the RGB basis rotated 180 degrees: red is left,
  // blue is right, green is down, and magenta is up.
  const x = -(rBias - bBias) / (2 * config.chromaRange);
  const y = -(2 * gBias - rBias - bBias) / (3 * config.chromaRange);
  return {
    x: clampNumber(x, -1, 1),
    y: clampNumber(y, -1, 1),
  };
}

export function getWheelValuesFromPoint(
  config: WheelControlConfig,
  defs: ColorEditorParamDefinition[],
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const rDef = getWheelParamDef(defs, config.rKey);
  const gDef = getWheelParamDef(defs, config.gKey);
  const bDef = getWheelParamDef(defs, config.bKey);
  const neutral = rDef.defaultValue;
  const rgbX = -x;
  const rgbY = -y;
  return {
    r: clampNumber(neutral + rgbX * config.chromaRange - rgbY * config.chromaRange * 0.5, rDef.min, rDef.max),
    g: clampNumber(neutral + rgbY * config.chromaRange, gDef.min, gDef.max),
    b: clampNumber(neutral - rgbX * config.chromaRange - rgbY * config.chromaRange * 0.5, bDef.min, bDef.max),
  };
}

export function getWheelPoint(pad: HTMLDivElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = pad.getBoundingClientRect();
  const rawX = ((clientX - rect.left) / rect.width - 0.5) * 2;
  const rawY = -(((clientY - rect.top) / rect.height - 0.5) * 2);
  const radius = Math.hypot(rawX, rawY);
  if (radius <= 1) {
    return { x: rawX, y: rawY };
  }
  return { x: rawX / radius, y: rawY / radius };
}

export function getEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}
