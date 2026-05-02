export type ColorViewMode = 'nodes' | 'list';

export type ColorNodeType = 'input' | 'primary' | 'output';

export type ColorParamValue = number | boolean | string;

export const MAX_RUNTIME_PRIMARY_NODES = 8;

export interface ColorCorrectionUiState {
  viewMode: ColorViewMode;
  selectedNodeId?: string;
  workspaceViewport?: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface ColorNode {
  id: string;
  type: ColorNodeType;
  name: string;
  enabled: boolean;
  params: Record<string, ColorParamValue>;
  position: { x: number; y: number };
  preview?: { collapsed?: boolean };
}

export interface ColorEdge {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
}

export interface ColorGradeVersion {
  id: string;
  name: string;
  nodes: ColorNode[];
  edges: ColorEdge[];
  outputNodeId: string;
}

export interface ColorCorrectionState {
  version: 1;
  enabled: boolean;
  activeVersionId: string;
  versions: ColorGradeVersion[];
  ui: ColorCorrectionUiState;
}

export interface RuntimePrimaryColorParams {
  exposure: number;
  contrast: number;
  pivot: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  blackPoint: number;
  whitePoint: number;
  lift: number;
  gamma: number;
  gain: number;
  offset: number;
  shadows: number;
  highlights: number;
  hue: number;
}

export interface RuntimeColorGrade {
  enabled: boolean;
  graphHash: string;
  nodeIds: string[];
  primary: RuntimePrimaryColorParams;
  primaryNodes: RuntimePrimaryColorParams[];
  diagnostics: string[];
}

export interface ColorParamDefinition {
  key: keyof RuntimePrimaryColorParams;
  section: 'Balance' | 'Tone' | 'Levels' | 'Creative';
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  decimals: number;
}

export const DEFAULT_PRIMARY_COLOR_PARAMS: RuntimePrimaryColorParams = {
  exposure: 0,
  contrast: 1,
  pivot: 0.5,
  saturation: 1,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  blackPoint: 0,
  whitePoint: 1,
  lift: 0,
  gamma: 1,
  gain: 1,
  offset: 0,
  shadows: 0,
  highlights: 0,
  hue: 0,
};

export const PRIMARY_COLOR_PARAM_DEFS: ColorParamDefinition[] = [
  { key: 'exposure', section: 'Tone', label: 'Exposure', min: -4, max: 4, step: 0.01, defaultValue: 0, decimals: 2 },
  { key: 'contrast', section: 'Tone', label: 'Contrast', min: 0, max: 3, step: 0.01, defaultValue: 1, decimals: 2 },
  { key: 'pivot', section: 'Tone', label: 'Pivot', min: 0, max: 1, step: 0.001, defaultValue: 0.5, decimals: 3 },
  { key: 'shadows', section: 'Tone', label: 'Shadows', min: -1, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
  { key: 'highlights', section: 'Tone', label: 'Highlights', min: -1, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
  { key: 'lift', section: 'Levels', label: 'Lift', min: -0.5, max: 0.5, step: 0.001, defaultValue: 0, decimals: 3 },
  { key: 'gamma', section: 'Levels', label: 'Gamma', min: 0.1, max: 4, step: 0.01, defaultValue: 1, decimals: 2 },
  { key: 'gain', section: 'Levels', label: 'Gain', min: 0, max: 4, step: 0.01, defaultValue: 1, decimals: 2 },
  { key: 'offset', section: 'Levels', label: 'Offset', min: -1, max: 1, step: 0.001, defaultValue: 0, decimals: 3 },
  { key: 'blackPoint', section: 'Levels', label: 'Black', min: 0, max: 0.5, step: 0.001, defaultValue: 0, decimals: 3 },
  { key: 'whitePoint', section: 'Levels', label: 'White', min: 0.5, max: 1, step: 0.001, defaultValue: 1, decimals: 3 },
  { key: 'saturation', section: 'Creative', label: 'Saturation', min: 0, max: 3, step: 0.01, defaultValue: 1, decimals: 2 },
  { key: 'vibrance', section: 'Creative', label: 'Vibrance', min: -1, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
  { key: 'hue', section: 'Creative', label: 'Hue', min: -180, max: 180, step: 0.1, defaultValue: 0, decimals: 1 },
  { key: 'temperature', section: 'Balance', label: 'Temp', min: -1, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
  { key: 'tint', section: 'Balance', label: 'Tint', min: -1, max: 1, step: 0.01, defaultValue: 0, decimals: 2 },
];

export function createColorNodeId(prefix: string = 'node'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createPrimaryColorNode(id = 'node_primary', name = 'Primary'): ColorNode {
  return {
    id,
    type: 'primary',
    name,
    enabled: true,
    params: { ...DEFAULT_PRIMARY_COLOR_PARAMS },
    position: { x: 160, y: 80 },
  };
}

export function createDefaultColorCorrectionState(): ColorCorrectionState {
  const inputNode: ColorNode = {
    id: 'node_input',
    type: 'input',
    name: 'Input',
    enabled: true,
    params: {},
    position: { x: 0, y: 80 },
  };
  const primaryNode = createPrimaryColorNode();
  const outputNode: ColorNode = {
    id: 'node_output',
    type: 'output',
    name: 'Output',
    enabled: true,
    params: {},
    position: { x: 340, y: 80 },
  };

  return {
    version: 1,
    enabled: true,
    activeVersionId: 'version_main',
    versions: [{
      id: 'version_main',
      name: 'A',
      nodes: [inputNode, primaryNode, outputNode],
      edges: [
        { id: 'edge_input_primary', fromNodeId: inputNode.id, fromPort: 'out', toNodeId: primaryNode.id, toPort: 'in' },
        { id: 'edge_primary_output', fromNodeId: primaryNode.id, fromPort: 'out', toNodeId: outputNode.id, toPort: 'in' },
      ],
      outputNodeId: outputNode.id,
    }],
    ui: {
      viewMode: 'list',
      selectedNodeId: primaryNode.id,
      workspaceViewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}

export function cloneColorCorrectionState(state: ColorCorrectionState): ColorCorrectionState {
  return structuredClone(state);
}

export function ensureColorCorrectionState(state?: ColorCorrectionState): ColorCorrectionState {
  if (!state || state.version !== 1 || state.versions.length === 0) {
    return createDefaultColorCorrectionState();
  }

  const next = cloneColorCorrectionState(state);
  const activeVersion = getActiveColorVersion(next);
  if (!activeVersion) {
    return createDefaultColorCorrectionState();
  }

  next.enabled = next.enabled !== false;
  next.ui = {
    viewMode: next.ui?.viewMode ?? 'list',
    selectedNodeId: next.ui?.selectedNodeId,
    workspaceViewport: next.ui?.workspaceViewport ?? { x: 0, y: 0, zoom: 1 },
  };

  return next;
}

export function getActiveColorVersion(state: ColorCorrectionState): ColorGradeVersion | undefined {
  return state.versions.find(version => version.id === state.activeVersionId) ?? state.versions[0];
}

export function getColorNode(state: ColorCorrectionState, nodeId: string): ColorNode | undefined {
  return getActiveColorVersion(state)?.nodes.find(node => node.id === nodeId);
}

export function getEditableColorNodes(state: ColorCorrectionState): ColorNode[] {
  return getActiveColorVersion(state)?.nodes.filter(node => node.type !== 'input' && node.type !== 'output') ?? [];
}

export function createColorProperty(versionId: string, nodeId: string, paramName: string): `color.${string}.${string}.${string}` {
  return `color.${versionId}.${nodeId}.${paramName}`;
}

export function parseColorProperty(property: string): { versionId: string; nodeId: string; paramName: string } | null {
  const parts = property.split('.');
  if (parts.length !== 4 || parts[0] !== 'color') {
    return null;
  }
  return { versionId: parts[1], nodeId: parts[2], paramName: parts[3] };
}

export function getColorNodeParamValue(
  state: ColorCorrectionState,
  nodeId: string,
  paramName: string,
  fallback = 0
): number {
  const value = getColorNode(state, nodeId)?.params[paramName];
  return typeof value === 'number' ? value : fallback;
}

export function setColorNodeParamValue(
  state: ColorCorrectionState,
  versionId: string,
  nodeId: string,
  paramName: string,
  value: ColorParamValue
): ColorCorrectionState {
  return {
    ...state,
    versions: state.versions.map(version => (
      version.id !== versionId
        ? version
        : {
            ...version,
            nodes: version.nodes.map(node => (
              node.id !== nodeId
                ? node
                : { ...node, params: { ...node.params, [paramName]: value } }
            )),
          }
    )),
  };
}

export function getPrimaryRuntimeParams(node: ColorNode): RuntimePrimaryColorParams {
  return {
    exposure: typeof node.params.exposure === 'number' ? node.params.exposure : DEFAULT_PRIMARY_COLOR_PARAMS.exposure,
    contrast: typeof node.params.contrast === 'number' ? node.params.contrast : DEFAULT_PRIMARY_COLOR_PARAMS.contrast,
    pivot: typeof node.params.pivot === 'number' ? node.params.pivot : DEFAULT_PRIMARY_COLOR_PARAMS.pivot,
    saturation: typeof node.params.saturation === 'number' ? node.params.saturation : DEFAULT_PRIMARY_COLOR_PARAMS.saturation,
    vibrance: typeof node.params.vibrance === 'number' ? node.params.vibrance : DEFAULT_PRIMARY_COLOR_PARAMS.vibrance,
    temperature: typeof node.params.temperature === 'number' ? node.params.temperature : DEFAULT_PRIMARY_COLOR_PARAMS.temperature,
    tint: typeof node.params.tint === 'number' ? node.params.tint : DEFAULT_PRIMARY_COLOR_PARAMS.tint,
    blackPoint: typeof node.params.blackPoint === 'number' ? node.params.blackPoint : DEFAULT_PRIMARY_COLOR_PARAMS.blackPoint,
    whitePoint: typeof node.params.whitePoint === 'number' ? node.params.whitePoint : DEFAULT_PRIMARY_COLOR_PARAMS.whitePoint,
    lift: typeof node.params.lift === 'number' ? node.params.lift : DEFAULT_PRIMARY_COLOR_PARAMS.lift,
    gamma: typeof node.params.gamma === 'number' ? node.params.gamma : DEFAULT_PRIMARY_COLOR_PARAMS.gamma,
    gain: typeof node.params.gain === 'number' ? node.params.gain : DEFAULT_PRIMARY_COLOR_PARAMS.gain,
    offset: typeof node.params.offset === 'number' ? node.params.offset : DEFAULT_PRIMARY_COLOR_PARAMS.offset,
    shadows: typeof node.params.shadows === 'number' ? node.params.shadows : DEFAULT_PRIMARY_COLOR_PARAMS.shadows,
    highlights: typeof node.params.highlights === 'number' ? node.params.highlights : DEFAULT_PRIMARY_COLOR_PARAMS.highlights,
    hue: typeof node.params.hue === 'number' ? node.params.hue : DEFAULT_PRIMARY_COLOR_PARAMS.hue,
  };
}

export function isNeutralPrimaryParams(params: RuntimePrimaryColorParams): boolean {
  return PRIMARY_COLOR_PARAM_DEFS.every(def => Math.abs(params[def.key] - def.defaultValue) < 1e-6);
}

function combinePrimaryRuntimeParams(primaryNodes: RuntimePrimaryColorParams[]): RuntimePrimaryColorParams {
  const primary = { ...DEFAULT_PRIMARY_COLOR_PARAMS };
  for (const params of primaryNodes) {
    primary.exposure += params.exposure;
    primary.contrast *= params.contrast;
    primary.pivot = params.pivot;
    primary.saturation *= params.saturation;
    primary.vibrance += params.vibrance;
    primary.temperature += params.temperature;
    primary.tint += params.tint;
    primary.blackPoint = Math.max(primary.blackPoint, params.blackPoint);
    primary.whitePoint = Math.min(primary.whitePoint, params.whitePoint);
    primary.lift += params.lift;
    primary.gamma *= params.gamma;
    primary.gain *= params.gain;
    primary.offset += params.offset;
    primary.shadows += params.shadows;
    primary.highlights += params.highlights;
    primary.hue += params.hue;
  }
  return primary;
}

function getOrderedRuntimeNodes(version: ColorGradeVersion, diagnostics: string[]): ColorNode[] {
  const byId = new Map(version.nodes.map(node => [node.id, node]));
  const inputNode = version.nodes.find(node => node.type === 'input');
  const outputNode = version.nodes.find(node => node.id === version.outputNodeId)
    ?? version.nodes.find(node => node.type === 'output');

  if (!inputNode || !outputNode) {
    diagnostics.push('Color graph is missing an input or output node; using saved node order.');
    return version.nodes.filter(node => node.type !== 'input' && node.type !== 'output');
  }

  const outgoing = new Map<string, ColorEdge[]>();
  for (const edge of version.edges) {
    const edges = outgoing.get(edge.fromNodeId) ?? [];
    edges.push(edge);
    outgoing.set(edge.fromNodeId, edges);
  }

  const orderedNodes: ColorNode[] = [];
  const visited = new Set<string>([inputNode.id]);
  let currentNodeId = inputNode.id;

  for (let guard = 0; guard < version.nodes.length + 1; guard++) {
    const edges = (outgoing.get(currentNodeId) ?? [])
      .filter(edge => byId.has(edge.toNodeId));
    if (edges.length > 1) {
      diagnostics.push('Parallel color graph branches are preserved in state but not yet compiled; using the first serial branch.');
    }

    const nextEdge = edges[0];
    if (!nextEdge) {
      diagnostics.push('Color graph has an open serial chain; using saved node order.');
      return version.nodes.filter(node => node.type !== 'input' && node.type !== 'output');
    }

    const nextNode = byId.get(nextEdge.toNodeId);
    if (!nextNode) {
      break;
    }
    if (nextNode.id === outputNode.id || nextNode.type === 'output') {
      return orderedNodes;
    }
    if (visited.has(nextNode.id)) {
      diagnostics.push('Color graph contains a cycle; using saved node order.');
      return version.nodes.filter(node => node.type !== 'input' && node.type !== 'output');
    }

    orderedNodes.push(nextNode);
    visited.add(nextNode.id);
    currentNodeId = nextNode.id;
  }

  diagnostics.push('Color graph traversal exceeded node count; using saved node order.');
  return version.nodes.filter(node => node.type !== 'input' && node.type !== 'output');
}

export function compileRuntimeColorGrade(state?: ColorCorrectionState): RuntimeColorGrade | undefined {
  if (!state?.enabled) {
    return undefined;
  }

  const version = getActiveColorVersion(state);
  if (!version) {
    return undefined;
  }

  const diagnostics: string[] = [];
  const nodeIds: string[] = [];
  const primaryNodes: RuntimePrimaryColorParams[] = [];
  const orderedNodes = getOrderedRuntimeNodes(version, diagnostics);

  for (const node of orderedNodes) {
    if (!node.enabled) {
      continue;
    }
    if (node.type !== 'primary') {
      diagnostics.push(`Unsupported color node type "${node.type}" skipped.`);
      continue;
    }
    if (primaryNodes.length >= MAX_RUNTIME_PRIMARY_NODES) {
      diagnostics.push(`Only the first ${MAX_RUNTIME_PRIMARY_NODES} primary color nodes are compiled in realtime.`);
      break;
    }

    const params = getPrimaryRuntimeParams(node);
    if (isNeutralPrimaryParams(params)) {
      continue;
    }

    primaryNodes.push(params);
    nodeIds.push(node.id);
  }

  if (nodeIds.length === 0) {
    return undefined;
  }

  const primary = combinePrimaryRuntimeParams(primaryNodes);
  const graphHash = JSON.stringify({
    versionId: version.id,
    enabled: state.enabled,
    nodeIds,
    primaryNodes,
  });

  return {
    enabled: true,
    graphHash,
    nodeIds,
    primary,
    primaryNodes,
    diagnostics,
  };
}
