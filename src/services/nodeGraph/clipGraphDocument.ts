import {
  ensureColorCorrectionState,
  getActiveColorVersion,
  type ColorNode,
} from '../../types/colorCorrection';
import { buildClipNodeGraphView } from './clipGraphProjectionBuildView';
import { buildClipFlockNodeGraph } from './clipGraphFlockProjection';
import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import { applyClipNodeGraphState } from './clipGraphProjectionState';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import type {
  NodeGraph,
  NodeGraphDocument,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphPort,
  NodeGraphView,
  NodeGraphViewTheme,
} from './types';

const COLOR_UNSUPPORTED_SOURCE_TYPES = new Set([
  'audio',
  'camera',
  'light',
  'splat-effector',
  'motion-adjustment',
]);

export function getClipColorGraphId(clipId: string, versionId: string): string {
  return `clip-graph:${clipId}:color:${versionId}`;
}

export function clipSupportsColorGraph(clip: TimelineClip): boolean {
  return !COLOR_UNSUPPORTED_SOURCE_TYPES.has(clip.source?.type ?? '');
}

function colorNodeKind(node: ColorNode): NodeGraphNode['kind'] {
  if (node.type === 'input' || node.type === 'source') return 'source';
  if (node.type === 'output' || node.type === 'alpha-output') return 'output';
  if (node.type === 'primary' || node.type === 'wheels') return 'color';
  return 'custom';
}

function colorNodePorts(node: ColorNode): { inputs: NodeGraphPort[]; outputs: NodeGraphPort[] } {
  const textureInput = (id = 'in', label = 'Image'): NodeGraphPort => ({
    id, label, type: 'texture', direction: 'input',
  });
  const textureOutput = (id = 'out', label = 'Image'): NodeGraphPort => ({
    id, label, type: 'texture', direction: 'output',
  });
  const keyInput = (id = 'key-in', label = 'Key'): NodeGraphPort => ({
    id, label, type: 'mask', direction: 'input',
  });
  const keyOutput = (id = 'key-out', label = 'Key'): NodeGraphPort => ({
    id, label, type: 'mask', direction: 'output',
  });

  switch (node.type) {
    case 'input':
    case 'source':
      return { inputs: [], outputs: [textureOutput()] };
    case 'output':
      return { inputs: [textureInput()], outputs: [] };
    case 'alpha-output':
      return { inputs: [keyInput()], outputs: [] };
    case 'key-mixer':
      return {
        inputs: [keyInput('key-in', 'Key 1'), keyInput('key-in-2', 'Key 2')],
        outputs: [keyOutput()],
      };
    case 'parallel-mixer':
    case 'layer-mixer':
      return {
        inputs: [textureInput('in', 'Image 1'), textureInput('in-2', 'Image 2')],
        outputs: [textureOutput()],
      };
    case 'splitter':
      return {
        inputs: [textureInput()],
        outputs: [
          textureOutput('red-out', 'Red'),
          textureOutput('green-out', 'Green'),
          textureOutput('blue-out', 'Blue'),
        ],
      };
    case 'combiner':
      return {
        inputs: [
          textureInput('red-in', 'Red'),
          textureInput('green-in', 'Green'),
          textureInput('blue-in', 'Blue'),
        ],
        outputs: [textureOutput()],
      };
    default:
      return {
        inputs: [textureInput(), keyInput()],
        outputs: [textureOutput(), keyOutput()],
      };
  }
}

function buildColorNodeGraphNode(
  clipId: string,
  versionId: string,
  node: ColorNode,
): NodeGraphNode {
  const isInput = node.type === 'input';
  const isOutput = node.type === 'output';
  const ports = colorNodePorts(node);
  const isGrade = node.type === 'primary' || node.type === 'wheels';

  return {
    id: node.id,
    kind: colorNodeKind(node),
    runtime: 'builtin',
    label: node.name,
    description: isInput
      ? 'Input signal for the active clip color grade.'
      : isOutput
        ? 'Output signal from the active clip color grade.'
        : isGrade
          ? `${node.type === 'wheels' ? 'Color wheels' : 'Primary color'} correction node.`
          : `${node.name} structure node in the clip color graph.`,
    inputs: ports.inputs,
    outputs: ports.outputs,
    params: {
      ...node.params,
      enabled: node.enabled,
      nodeType: node.type,
      clipId,
    },
    layout: { ...node.position },
    domain: 'color',
    binding: {
      kind: 'color-node',
      versionId,
      nodeId: node.id,
      nodeType: node.type,
    },
  };
}

export function buildClipColorNodeGraph(clip: TimelineClip): NodeGraph | null {
  if (!clipSupportsColorGraph(clip)) return null;

  const colorState = ensureColorCorrectionState(clip.colorCorrection);
  const activeVersion = getActiveColorVersion(colorState);
  if (!activeVersion) return null;

  const owner = { kind: 'clip' as const, id: clip.id, name: clip.name };
  const edges: NodeGraphEdge[] = activeVersion.edges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    fromPortId: edge.fromPort,
    toNodeId: edge.toNodeId,
    toPortId: edge.toPort,
    type: edge.fromPort.startsWith('key-') || edge.toPort.startsWith('key-')
      ? 'mask'
      : 'texture',
  }));

  return {
    id: getClipColorGraphId(clip.id, activeVersion.id),
    owner,
    nodes: activeVersion.nodes.map((node) => buildColorNodeGraphNode(clip.id, activeVersion.id, node)),
    edges,
    domain: 'color',
  };
}

function buildViews(rootGraph: NodeGraph, colorGraph: NodeGraph | null, flockGraph: NodeGraph | null): NodeGraphView[] {
  return [
    {
      id: `${rootGraph.id}:view:general`,
      theme: 'general',
      label: 'General',
      graphId: rootGraph.id,
    },
    ...(flockGraph ? [{
      id: `${flockGraph.id}:view:flock`,
      theme: 'flock' as const,
      label: 'Flock',
      graphId: flockGraph.id,
    }] : []),
    ...(colorGraph ? [{
      id: `${colorGraph.id}:view:color`,
      theme: 'color' as const,
      label: 'Color',
      graphId: colorGraph.id,
    }] : []),
  ];
}

export function buildClipNodeGraphDocument(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraphDocument {
  const rootGraph = applyClipNodeGraphState(
    buildClipNodeGraphView(clip, track, options),
    clip.nodeGraph,
  );
  const colorGraph = buildClipColorNodeGraph(clip);
  const flockGraph = buildClipFlockNodeGraph(clip);

  return {
    id: `clip-graph-document:${clip.id}`,
    owner: rootGraph.owner,
    rootGraphId: rootGraph.id,
    graphs: [rootGraph, ...(flockGraph ? [flockGraph] : []), ...(colorGraph ? [colorGraph] : [])],
    views: buildViews(rootGraph, colorGraph, flockGraph),
  };
}

export function getNodeGraphDocumentGraph(
  document: NodeGraphDocument,
  graphId: string,
): NodeGraph | null {
  return document.graphs.find((graph) => graph.id === graphId) ?? null;
}

export function getNodeGraphView(
  document: NodeGraphDocument,
  theme: NodeGraphViewTheme,
): NodeGraph {
  const view = document.views.find((candidate) => candidate.theme === theme);
  const graph = view ? getNodeGraphDocumentGraph(document, view.graphId) : null;
  return graph ?? getNodeGraphDocumentGraph(document, document.rootGraphId) ?? document.graphs[0];
}
