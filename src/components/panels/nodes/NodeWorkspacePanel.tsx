import { SceneOutputNavigation } from './workspace/SceneOutputNavigation';
import { readTimelineRuntimeState } from '../../../services/timeline/timelineRuntimeCoordinator';
import { transferNodeGroup } from '../../../services/nodeGraph/transferNodeGroup';
import { NodeCatalog } from './workspace/NodeCatalog';
import { EffectPresetLibrary } from './workspace/EffectPresetLibrary';
import { getEffectOperator } from '../../../services/operators/operatorRegistry';
import { useUnifiedNodeActions } from './useUnifiedNodeActions';
import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCategoriesWithEffects, getEffect } from '../../../effects';
import type { NodeGraphConnectionRequest, NodeGraphLayout, NodeGraphViewTheme } from '../../../services/nodeGraph';
import type { NodeWorkspaceViewRequest } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { NodeGraphCanvas, type NodeGraphMove } from './NodeGraphCanvas';
import { reconnectNodePorts } from './canvas/reconnectNodePorts';
import { sceneOutputTarget } from '../../../services/nodeGraph/sceneGraphOutputs';
import { publishSceneGraphOutput } from '../../../services/nodeGraph/publishSceneGraphOutput';
import { NodeContextMenu } from './workspace/NodeContextMenu';
import { ConnectedNodeMenu } from './workspace/ConnectedNodeMenu';
import type { NodeConnectionDrop } from '../../../types/nodeGraph';
import { buildCableInsertEntries, buildNodeContextMenuEntries } from './workspace/nodeContextMenuEntries';
import { addableEffectOperators } from '../../../services/operators/effectGraphOwner';
import { addEffectGraphNode } from './workspace/addEffectGraphNode';
import { createSingleNodeEffect } from '../../../services/operators/imageNodeGraphEffect';
import { effectGraphId } from '../../../services/nodeGraph/effectGraphProjection';
import { addControlNode } from '../../../services/parameterSources/parameterSourceActions';
import { NodeInspector } from './workspace/NodeWorkspaceInspector';
import {
  canDeleteNodeFromClip,
  clampNodeWorkspaceInspectorWidth,
  NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH,
  NODE_WORKSPACE_INSPECTOR_WIDTH_KEY,
} from './workspace/nodeWorkspaceUtils';
import { useNodeGraphSubject } from './useNodeGraphSubject';
import { useNodeWorkspaceViewRequests } from './useNodeWorkspaceViewRequests';
import { useFlockGraphActions } from './flock/useFlockGraphActions';
import { FlockNodeContextMenu } from './flock/FlockNodeContextMenu';
import { FlockGraphStatusBar } from './flock/FlockGraphStatusBar';
import './NodeWorkspacePanel.css';
import { addKeyframeNode } from '../../../services/nodeGraph/keyframeNodeActions';
import { ControlNodeMenu } from './workspace/ControlNodeMenu';
import { NodeWorkspaceSourceSelect } from './workspace/NodeWorkspaceSourceSelect';
import type { NodeWorkspacePanelData } from '../../../types/dock';
import { focusKeyframeConnections } from '../../../services/nodeGraph/keyframeNodeProjection';
/** Graph kinds that accept operator nodes, in the order they receive a node nobody else offers. */
const GRAPH_OWNER_TYPES = ['invert', 'analog-signal-lab', 'voxel-relief', 'face-cables', 'splat-exploration', 'pixel-particle-disintegrate'];

interface NodeWorkspaceContextMenuState {
  x: number;
  y: number;
  layout: NodeGraphLayout;
  nodeId?: string | null;
}

interface NodeWorkspaceSelection {
  graphId: string | null;
  nodeId: string | null;
  nodeIds: string[];
}

/** Per-view write-through behavior; each domain keeps its own canonical data. */
interface NodeDomainAdapter {
  moveNode: (nodeId: string, layout: NodeGraphLayout) => void;
  moveNodes?: (moves: NodeGraphMove[]) => void;
  connectPorts: (connection: NodeGraphConnectionRequest) => void;
  disconnectEdge: (edgeId: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteNodes?: (nodeIds: string[]) => void;
  toggleBypass: (nodeId: string) => void;
  duplicateSelection?: () => void;
  groupSelection?: () => void;
  supportsAddMenu: boolean;
  supportsMultiSelection: boolean;
  layoutScaleX: number;
}

function batched(label: string, run: () => void): void {
  const batch = startBatch(label);
  try {
    run();
  } finally {
    if (batch.opened) endBatch();
  }
}

export function NodeWorkspacePanel({ panelId = 'node-workspace', data }: { panelId?: string; data?: NodeWorkspacePanelData }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [animationInspector, setAnimationInspector] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [viewTheme, setViewTheme] = useState<NodeGraphViewTheme>('general');
  const pinnedClipId = typeof data?.nodeClipId === 'string' && data.nodeClipId ? data.nodeClipId : null;
  const subject = useNodeGraphSubject(viewTheme, pinnedClipId);
  const updatePanelData = useDockStore(state => state.updatePanelData);
  const setSource = (nodeClipId: string | null) => updatePanelData(panelId, { nodeClipId });
  const sourceSelect = <NodeWorkspaceSourceSelect clipId={pinnedClipId} onChange={setSource} />;
  const keyframesLocked = useTimelineStore(state => state.isExporting || Boolean(state.tracks.find(t => t.id === subject?.clip.trackId)?.locked));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moveClipNodeGraphNode = useTimelineStore((state) => state.moveClipNodeGraphNode);
  const showClipNodeGraphBuiltIn = useTimelineStore((state) => state.showClipNodeGraphBuiltIn);
  const connectClipNodeGraphPorts = useTimelineStore((state) => state.connectClipNodeGraphPorts);
  const disconnectClipNodeGraphEdge = useTimelineStore((state) => state.disconnectClipNodeGraphEdge);
  const removeClipNodeGraphNode = useTimelineStore((state) => state.removeClipNodeGraphNode);
  const setClipEffectEnabled = useTimelineStore((state) => state.setClipEffectEnabled);
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const ensureColorCorrection = useTimelineStore((state) => state.ensureColorCorrection);
  const addColorNode = useTimelineStore((state) => state.addColorNode);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const flockActions = useFlockGraphActions(subject?.clip.source?.type === 'flock' ? subject.clip : null);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);
  const [contextMenuError, setContextMenuError] = useState('');
  const [contextMenu, setContextMenu] = useState<NodeWorkspaceContextMenuState | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<{ graphId: string; drop: NodeConnectionDrop } | null>(null);
  const [selection, setSelection] = useState<NodeWorkspaceSelection>({ graphId: null, nodeId: null, nodeIds: [] });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
    }
    const storedWidth = Number(window.localStorage.getItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY));
    return Number.isFinite(storedWidth)
      ? clampNodeWorkspaceInspectorWidth(storedWidth, window.innerWidth)
      : NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
  });
  const activeTheme = subject?.view.theme ?? 'general';
  const graphId = subject?.graph.id ?? null;
  const isCurrentGraphSelection = selection.graphId === graphId;
  const selectedNodeId = isCurrentGraphSelection
    ? selection.nodeId
    : subject?.graph.nodes[0]?.id ?? null;
  const selectedNodeIds = useMemo(() => {
    if (!isCurrentGraphSelection) return selectedNodeId ? [selectedNodeId] : [];
    if (selection.nodeIds.length > 0) return selection.nodeIds;
    return selection.nodeId ? [selection.nodeId] : [];
  }, [isCurrentGraphSelection, selectedNodeId, selection.nodeId, selection.nodeIds]);

  const selectedNode = useMemo(() => {
    if (!subject) return null;
    const group = subject.graph.groups?.find(g => g.proxyId === selectedNodeId);
    return subject.graph.nodes.find(node => node.id === selectedNodeId) ?? subject.graph.nodes.find(node => node.id === group?.nodeIds[0]) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);
  const contextMenuNode = useMemo(() => {
    if (!subject || !contextMenu?.nodeId) return null;
    return subject.graph.nodes.find((node) => node.id === contextMenu.nodeId) ?? null;
  }, [contextMenu?.nodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setAnimationInspector(false);
    setSelection({ graphId, nodeId, nodeIds: [] });
  }, [graphId]);

  const selectNodes = useCallback((nodeIds: string[]) => {
    setAnimationInspector(false);
    setSelection({
      graphId,
      nodeId: nodeIds[nodeIds.length - 1] ?? null,
      nodeIds: nodeIds.length > 1 ? nodeIds : [],
    });
  }, [graphId]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setAnimationInspector(false);
    const next = selectedNodeIds.includes(nodeId)
      ? selectedNodeIds.filter((candidate) => candidate !== nodeId)
      : [...selectedNodeIds, nodeId];
    setSelection({ graphId, nodeId: next[next.length - 1] ?? null, nodeIds: next });
  }, [graphId, selectedNodeIds]);

  const openProperties = useCallback(() => {
    useDockStore.getState().activatePanelType('clip-properties');
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextMenuError('');
  }, []);

  const handleViewRequest = useCallback((request: NodeWorkspaceViewRequest) => {
    if (request.clipId !== subject?.selectedClip.id && request.clipId !== subject?.id) {
      selectClip(request.clipId);
    }
    setViewTheme('general');
    setContextMenu(null);
    if (request.theme.startsWith('effect:')) {
      const state = readTimelineRuntimeState(useTimelineStore);
      const current = state.clips.find(c => c.id === request.clipId);
      if (current) state.updateClip(current.id, { nodeGraph: {
        version: 1, nodes: [], ...current.nodeGraph, groups: { ...current.nodeGraph?.groups,
          [request.theme]: { ...current.nodeGraph?.groups?.[request.theme], collapsed: false } },
      } });
    }
    if (request.nodeId) {
      setCatalogOpen(false);
      setPresetsOpen(false);
      setAnimationInspector(request.animation === true);
      setSelection({ graphId, nodeId: request.nodeId, nodeIds: [] });
    }
  }, [selectClip, subject?.id, subject?.selectedClip.id, graphId]);
  useNodeWorkspaceViewRequests(handleViewRequest, panelId, pinnedClipId);

  const startInspectorResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const panelRect = panelRef.current?.getBoundingClientRect();
    const panelRight = panelRect?.right ?? window.innerWidth;
    const panelWidth = panelRect?.width ?? window.innerWidth;

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampNodeWorkspaceInspectorWidth(panelRight - moveEvent.clientX, panelWidth);
      setInspectorWidth(nextWidth);
      window.localStorage.setItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY, String(Math.round(nextWidth)));
    };

    const handleUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const addBuiltInNode = useCallback((node: 'transform' | 'mask' | 'color') => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add built-in node');
    try {
      showClipNodeGraphBuiltIn(subject.id, node);
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, node, contextMenu.layout);
      }
      selectNode(node);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, showClipNodeGraphBuiltIn, subject]);

  const addEffectNode = useCallback((effectType: string) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add effect node');
    try {
      const effectId = addClipEffect(subject.id, effectType);
      const nodeId = `effect-${effectId}`;
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
      }
      selectNode(nodeId);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipEffect, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const addAICustomNode = useCallback(() => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add AI node');
    try {
      const nodeId = addClipAICustomNode(subject.id);
      if (nodeId) {
        if (contextMenu) {
          moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
        }
        selectNode(nodeId);
      }
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipAICustomNode, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const selectFallbackAfterDelete = useCallback((removedIds: readonly string[]) => {
    if (!subject) return;
    const remaining = subject.graph.nodes.filter((candidate) => !removedIds.includes(candidate.id));
    const fallbackNode = remaining.find((candidate) => candidate.kind === 'output') ?? remaining[0] ?? null;
    setSelection({ graphId: subject.graph.id, nodeId: fallbackNode?.id ?? null, nodeIds: [] });
  }, [subject]);

  const adapter = useMemo<NodeDomainAdapter | null>(() => {
    if (!subject) return null;
    const clipId = subject.id;


    return {
      moveNode: (nodeId, layout) => moveClipNodeGraphNode(clipId, nodeId, layout),
      connectPorts: (connection) => batched('Connect node ports', () => connectClipNodeGraphPorts(clipId, connection)),
      disconnectEdge: (edgeId) => batched('Disconnect node link', () => disconnectClipNodeGraphEdge(clipId, edgeId)),
      deleteNode: (nodeId) => {
        const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!canDeleteNodeFromClip(subject.clip, node)) return;
        batched('Delete node', () => removeClipNodeGraphNode(clipId, nodeId));
        selectFallbackAfterDelete([nodeId]);
      },
      toggleBypass: (nodeId) => {
        const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return;
        const targetClipId = typeof node.params?.targetClipId === 'string' ? node.params.targetClipId : clipId;
        batched('Toggle node bypass', () => {
          if (node.kind === 'effect' && nodeId.startsWith('effect-')) {
            setClipEffectEnabled(targetClipId, nodeId.slice('effect-'.length), node.params?.enabled === false);
          } else if (node.binding?.kind === 'clip-audio-effect-instance') {
            readTimelineRuntimeState(useTimelineStore).setClipAudioEffectInstanceEnabled(targetClipId, node.binding.effectId, node.params?.enabled === false);
          } else if (node.kind === 'custom') {
            updateClipAICustomNode(clipId, nodeId, { bypassed: node.params?.bypassed !== true });
          }
        });
      },
      supportsAddMenu: true,
      supportsMultiSelection: false,
      layoutScaleX: 1,
    };
  }, [
    activeTheme,
    connectClipNodeGraphPorts,
    disconnectClipNodeGraphEdge,
    flockActions,
    moveClipNodeGraphNode,
    removeClipNodeGraphNode,
    selectFallbackAfterDelete,
    selectNode,
    selectNodes,
    selectedNodeIds,
    setClipEffectEnabled,
    subject,
    updateClipAICustomNode,
  ]);

  const unified = useUnifiedNodeActions(subject?.clip, subject?.graph, adapter, flockActions);
  const displayGraph = useMemo(() => subject && focusKeyframeConnections(subject.graph, selectedNodeIds), [subject, selectedNodeIds]);

  const deleteContextNode = (nodeId: string) => { unified.deleteNode(nodeId); closeContextMenu(); };

  const switchTheme = useCallback((theme: NodeGraphViewTheme) => {
    if (!subject) return;
    if (theme === 'color') {
      ensureColorCorrection(subject.id);
    }
    setViewTheme(theme);
    closeContextMenu();
  }, [closeContextMenu, ensureColorCorrection, subject]);

  const addColorGraphNode = useCallback((type: 'primary' | 'wheels') => {
    if (!subject) return;
    batched(`Add ${type} color node`, () => {
      addColorNode(subject.id, type);
    });
  }, [activeTheme, addColorNode, subject]);

  if (!subject || !adapter) {
    return (
      <div className="node-workspace-panel" ref={panelRef}>
        <div className="node-workspace-main">
          <div className="node-workspace-view-bar">{sourceSelect}</div>
          <div className="node-workspace-empty-state">
            <h3>Nodes</h3>
            <p>{pinnedClipId ? 'Assigned clip is not in the active composition. Choose another source or Active.' : 'Select a timeline clip'}</p>
          </div>
        </div>
      </div>
    );
  }

  const flockSelection = selectedNodeIds.flatMap(id => {
    const binding = subject.graph.nodes.find(n => n.id === id)?.binding;
    return binding?.kind === 'flock-node' ? [binding.nodeId] : [];
  });
  const selectFlockNodes = (ids: string[]) => selectNodes(ids.flatMap(id => subject.graph.nodes.filter(n => n.binding?.kind === 'flock-node' && n.binding.nodeId === id).map(n => n.id)));
  const flockContext = contextMenuNode?.binding?.kind === 'flock-node';
  const flockMenu = Boolean(subject.clip.flock && (flockContext || (!contextMenu?.nodeId && selectedNode?.groupId === 'flock')));
  const operatorContext = contextMenuNode?.binding?.kind === 'effect-operator' ? contextMenuNode.binding : null;
  const canDeleteContext = operatorContext ? operatorContext.nodeId !== 'wind' && Boolean(getEffectOperator(operatorContext.operator)?.addable)
    : contextMenuNode?.binding?.kind === 'scene-operator' ? Boolean(getEffectOperator(contextMenuNode.binding.operator)?.addable)
    : contextMenuNode?.binding?.kind === 'operator-group' ? false
    : contextMenuNode?.binding?.kind === 'color-node' ? !['input', 'output'].includes(contextMenuNode.binding.nodeType)
    : canDeleteNodeFromClip(subject.clip, contextMenuNode);
  const viewLabel = activeTheme === 'color' ? 'Color subgraph' : subject.view.label;
  const presetEffectId = selectedNode?.binding && 'effectId' in selectedNode.binding ? selectedNode.binding.effectId
    : subject.graph.groups?.find(group => group.proxyId === selectedNodeId || group.id === selectedNode?.groupId)?.effectId
      ?? (selectedNode?.id.startsWith('effect-') ? selectedNode.id.slice(7) : undefined);
  const presetEffect = subject.clip.effects.find(effect => effect.id === presetEffectId);
  const reusableTarget = contextMenu?.nodeId ? contextMenuNode : selectedNode;
  const addSingleNodeGroup = (operatorId: string, position: NodeGraphLayout, chain?: { beforeEffectId?: string }) => {
    const { effectId, nodeId } = createSingleNodeEffect(subject.id, operatorId, { groupPosition: position, chain });
    selectNode(`${effectGraphId(subject.id, effectId)}/${nodeId}`);
  };
  const reusableEffectId = reusableTarget?.binding && 'effectId' in reusableTarget.binding ? reusableTarget.binding.effectId
    : subject.graph.groups?.find(group => group.proxyId === reusableTarget?.id || group.id === reusableTarget?.groupId)?.effectId;
  const reusableEffect = subject.clip.effects.find(effect => effect.id === reusableEffectId);

  return (
    <div className="node-workspace-panel" ref={panelRef}>
      <div className="node-workspace-main">
        <div className="node-workspace-view-bar">
          {sourceSelect}
          <div className="node-workspace-view-tabs" role="tablist" aria-label="Node graph theme">
            {subject.availableViews.filter(view => view.theme === 'general').map((view) => (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={view.theme === activeTheme}
                className={view.theme === activeTheme ? 'active' : ''}
                onClick={(event) => {
                  if (event.detail > 0) event.currentTarget.blur();
                  switchTheme(view.theme);
                }}
              >
                {view.label}
              </button>
            ))}
          </div>
          <nav className="node-workspace-breadcrumb" aria-label="Graph location">
            {activeTheme === 'general' ? (
              <span className="node-workspace-view-context">Clip graph</span>
            ) : (
              <>
                <button
                  type="button"
                  className="node-workspace-breadcrumb-link"
                  onClick={(event) => {
                    if (event.detail > 0) event.currentTarget.blur();
                    switchTheme('general');
                  }}
                >
                  Clip graph
                </button>
                <span className="node-workspace-breadcrumb-separator" aria-hidden="true">›</span>
                <span className="node-workspace-view-context" aria-current="location">{viewLabel}</span>
              </>
            )}
          </nav>
          <button type="button" className="node-workspace-breadcrumb-link node-catalog-toggle" aria-pressed={catalogOpen}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); setPresetsOpen(false); setCatalogOpen(open => !open); }}>Catalog</button>
          <button type="button" className="node-workspace-breadcrumb-link" aria-pressed={presetsOpen}
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); setCatalogOpen(false); setPresetsOpen(open => !open); }}>Effect presets</button>
          <button type="button" disabled={keyframesLocked} className="node-workspace-breadcrumb-link" onClick={event => {
            if (event.detail > 0) event.currentTarget.blur();
            setCatalogOpen(false);
            setPresetsOpen(false);
            if (!keyframesLocked) selectNode(addKeyframeNode(subject.id, { x: selectedNode?.layout.x ?? 0, y: (selectedNode?.layout.y ?? 0) - 270 }));
          }}>+ Keyframes</button>
          {sceneOutputTarget(subject.clip, subject.graph, selectedNode) && <button type="button" className="node-workspace-breadcrumb-link"
            disabled={keyframesLocked} onClick={event => {
              if (event.detail > 0) event.currentTarget.blur();
              const target = sceneOutputTarget(subject.clip, subject.graph, selectedNode);
              if (target) publishSceneGraphOutput(subject.id, target);
            }}>Show output in timeline</button>}
          <ControlNodeMenu clipId={subject.id} disabled={keyframesLocked} onAdded={selectNode}
            layout={{ x: selectedNode?.layout.x ?? 0, y: (selectedNode?.layout.y ?? 0) - 300 }} />
          {selectedNode?.groupId === 'color' && (
            <div className="node-workspace-view-actions">
              <button type="button" onClick={event => { if (event.detail > 0) event.currentTarget.blur(); addColorGraphNode('primary'); }}>+ Primary</button>
              <button type="button" onClick={event => { if (event.detail > 0) event.currentTarget.blur(); addColorGraphNode('wheels'); }}>+ Wheels</button>
            </div>
          )}
        </div>
        <SceneOutputNavigation clip={subject.clip} graph={subject.graph} onFocus={selectNode} />
        {subject.clip.flock && (
          <FlockGraphStatusBar
            clip={subject.clip}
            message={flockActions.message}
            onDismissMessage={flockActions.clearMessage}
          />
        )}
        {unified.message && <div className="node-workspace-graph-message" role="status">{unified.message}<button type="button" onClick={unified.clearMessage}>Dismiss</button></div>}
        <NodeGraphCanvas
          key={subject.graph.id}
          initialGroupId={subject.clip.sceneGraphOutput?.groupId}
          graph={displayGraph!}
          projectGroupStates={subject.projectGroupStates}
          selectedNodeId={selectedNode?.id ?? null}
          selectedNodeIds={selectedNodeIds.length > 1 ? selectedNodeIds : undefined}
          onSelectNode={selectNode}
          onSelectNodes={selectNodes}
          onToggleNodeSelection={toggleNodeSelection}
          onMoveNode={unified.moveNode}
          onMoveNodes={moves => batched('Move nodes', () => moves.forEach(move => unified.moveNode(move.nodeId, move.layout)))}
          onTransferNodes={(ids, groupId) => {
            const moved = transferNodeGroup(subject.id, subject.graph, ids, groupId);
            selectNodes(Object.values(moved));
            return moved;
          }}
          onConnectPorts={unified.connectPorts}
          onDropConnection={drop => { setContextMenu(null); setConnectionMenu({ graphId: subject.graph.id, drop }); }}
          cableInsertEntries={(edge, point) => {
            // Cables inside one effect graph: any of its nodes goes between the cable's ends.
            const from = subject.graph.nodes.find(node => node.id === edge.fromNodeId), to = subject.graph.nodes.find(node => node.id === edge.toNodeId);
            const effectId = from?.binding?.kind === 'effect-operator' ? from.binding.effectId : undefined;
            const effect = subject.clip.effects.find(candidate => candidate.id === effectId);
            if (!effect || to?.binding?.kind !== 'effect-operator' || to.binding.effectId !== effect.id) {
              // Clip chain cables into an effect group or the clip output: a new group with the node joins there.
              const before = to?.binding?.kind === 'clip-effect' || to?.binding?.kind === 'effect-operator' ? to.binding.effectId : undefined;
              if (edge.type !== 'texture' || (!before && to?.binding?.kind !== 'clip-output')) return [];
              return buildCableInsertEntries({ effectId: 'new-group', effectName: 'a new group', operators: addableEffectOperators('invert'),
                onAdd: operatorId => { try { addSingleNodeGroup(operatorId, point, { beforeEffectId: before }); } catch (error) { console.warn('Insert node into cable failed', error); } } });
            }
            return buildCableInsertEntries({ effectId: effect.id, effectName: effect.name === effect.type ? getEffect(effect.type)?.name ?? effect.name : effect.name,
              operators: addableEffectOperators(effect.type), onAdd: operatorId => {
                const batch = startBatch('Insert node into cable');
                try {
                  const offset = from?.groupOffset;
                  const nodeId = addEffectGraphNode(subject.id, effect.id, operatorId, { x: point.x - (offset?.x ?? 0), y: point.y - (offset?.y ?? 0) });
                  const operator = getEffectOperator(operatorId);
                  const port = <T extends { id: string; type: string }>(ports: readonly T[] | undefined) => ports?.find(candidate => candidate.type === edge.type) ?? ports?.[0];
                  const input = port(operator?.inputs), output = port(operator?.outputs);
                  // No type filter: connect what fits; an unconnectable side keeps the original cable.
                  let wired = 0;
                  try { if (input) { unified.connectPorts({ fromNodeId: edge.fromNodeId, fromPortId: edge.fromPortId, toNodeId: nodeId, toPortId: input.id }); wired++; } } catch { /* stays unconnected */ }
                  try { if (output) { unified.connectPorts({ fromNodeId: nodeId, fromPortId: output.id, toNodeId: edge.toNodeId, toPortId: edge.toPortId }); wired++; } } catch { /* stays unconnected */ }
                  if (wired === 2) { try { unified.disconnectEdge(edge.id); } catch { /* already replaced */ } }
                  selectNode(nodeId);
                } catch (error) { console.warn('Insert node into cable failed', error); }
                finally { if (batch.opened) endBatch(); }
              } });
          }}
          onDisconnectEdge={unified.disconnectEdge}
          onReconnectPorts={(edgeId, connection) => batched('Reconnect node link', () => reconnectNodePorts(
            subject.graph, edgeId, connection, () => readTimelineRuntimeState(useTimelineStore).clips,
            unified.connectPorts, unified.disconnectEdge,
          ))}
          onDeleteNode={unified.deleteNode}
          onDeleteNodes={ids => batched('Delete nodes', () => ids.forEach(unified.deleteNode))}
          onDuplicateSelection={flockSelection.length === selectedNodeIds.length ? () => selectFlockNodes(flockActions.duplicate(flockSelection)) : undefined}
          onGroupSelection={flockSelection.length > 0 && flockSelection.length === selectedNodeIds.length ? () => { const id = flockActions.group(flockSelection, 'Group'); if (id) selectFlockNodes([id]); }
            : () => unified.groupNodes(selectedNodeIds.length ? selectedNodeIds : selectedNode ? [selectedNode.id] : [])}
          onToggleNodeBypass={unified.toggleBypass}
          onOpenAddMenu={adapter.supportsAddMenu ? setContextMenu : undefined}
          onToggleGroup={id => { unified.toggleGroup(id); const group = subject.graph.groups?.find(g => g.id === id); if (group) selectNode(group.proxyId); }}
          onSetAllGroupsCollapsed={unified.setAllGroupsCollapsed}
          layoutScaleX={adapter.layoutScaleX}
        />
      </div>
      <button type="button" className="node-workspace-inspector-handle"
        aria-expanded={inspectorOpen} aria-label={inspectorOpen ? 'Hide node inspector' : 'Show node inspector'}
        title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        onClick={() => setInspectorOpen(open => !open)}>
        {inspectorOpen ? '›' : '‹'}
      </button>
      {inspectorOpen && (presetsOpen ? <EffectPresetLibrary clipId={subject.id} effect={presetEffect} width={inspectorWidth}
        locked={keyframesLocked || subject.clip.source?.type === 'audio'} onSelectNode={selectNode} /> : catalogOpen ? <NodeCatalog width={inspectorWidth} /> : <NodeInspector
        node={selectedNode}
        showAnimation={animationInspector && isCurrentGraphSelection}
        onShowParameters={() => setAnimationInspector(false)}
        clip={subject.clip}
        inspectorWidth={inspectorWidth}
        onSelectNode={selectNode}
        onOpenProperties={openProperties}
        onStartResizeInspector={startInspectorResize}
        showClipActions={activeTheme === 'general'}
        flockActions={subject.clip.flock ? flockActions : undefined}
      />)}
      {connectionMenu?.graphId === subject.graph.id && <ConnectedNodeMenu clip={subject.clip} graph={subject.graph} drop={connectionMenu.drop}
        onClose={() => setConnectionMenu(null)} onAdded={selectNode} />}
      {contextMenu && !flockMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetNode={contextMenuNode}
          onPublishOutput={sceneOutputTarget(subject.clip, subject.graph, contextMenuNode) && !keyframesLocked
            ? () => { const target = sceneOutputTarget(subject.clip, subject.graph, contextMenuNode); if (target) publishSceneGraphOutput(subject.id, target); closeContextMenu(); } : undefined}
          canDeleteTarget={canDeleteContext}
          entries={buildNodeContextMenuEntries({
            clipStages: { canAddVisual: subject.clip.source?.type !== 'audio', canAddKeyframes: !keyframesLocked,
              onAddAI: addAICustomNode, onAddStage: addBuiltInNode,
              onAddKeyframes: () => { if (!keyframesLocked) selectNode(addKeyframeNode(subject.id, contextMenu.layout)); closeContextMenu(); } },
            effects: { groups: effectCategories, onAdd: addEffectNode },
            graphs: (() => {
              const insert = (effectId: () => string) => (operatorId: string) => {
                const batch = startBatch('Add node');
                try {
                  const id = effectId();
                  // Graph-local coordinates: offset of the pointer node, or of any card of that effect.
                  const offset = id === reusableEffect?.id ? reusableTarget?.groupOffset
                    : subject.graph.nodes.find(node => node.binding && 'effectId' in node.binding && node.binding.effectId === id)?.groupOffset;
                  const nodeId = addEffectGraphNode(subject.id, id, operatorId,
                    { x: contextMenu.layout.x - (offset?.x ?? 0), y: contextMenu.layout.y - (offset?.y ?? 0) });
                  const group = subject.graph.groups?.find(candidate => candidate.id === `effect:${id}`);
                  if (group?.collapsed) unified.toggleGroup(group.id);
                  selectNode(nodeId); closeContextMenu();
                } catch (error) { setContextMenuError(error instanceof Error ? error.message : String(error)); }
                finally { if (batch.opened) endBatch(); }
              };
              const imageCapable = !['audio', 'motion-adjustment'].includes(subject.clip.source?.type ?? '');
              const displayName = (effect: { name: string; type: string }) => effect.name === effect.type ? getEffect(effect.type)?.name ?? effect.name : effect.name;
              // Every graph kind: an existing effect of that kind receives the node, otherwise one is added on first use.
              const kinds = imageCapable ? GRAPH_OWNER_TYPES.map(type => {
                // Image nodes each get their own free-standing group at the menu position.
                if (type === 'invert') return { effectId: 'new-group', operators: addableEffectOperators(type), effectName: 'a new free group',
                  onAdd: (operatorId: string) => {
                    try { addSingleNodeGroup(operatorId, contextMenu.layout); closeContextMenu(); }
                    catch (error) { setContextMenuError(error instanceof Error ? error.message : String(error)); }
                  } };
                const existing = subject.clip.effects.find(effect => effect.type === type);
                return { effectId: existing?.id ?? `new:${type}`, operators: addableEffectOperators(type),
                  effectName: existing ? displayName(existing) : `new ${getEffect(type)?.name ?? type}`,
                  onAdd: insert(() => existing?.id ?? addClipEffect(subject.id, type)) };
              }) : [];
              return { owners: [
                ...(reusableEffect ? [{ effectId: reusableEffect.id, operators: addableEffectOperators(reusableEffect.type), onAdd: insert(() => reusableEffect.id),
                  effectName: displayName(reusableEffect) }] : []),
                ...kinds,
              ] };
            })(),
            controls: { disabled: keyframesLocked, onAdd: operatorId => {
              try { selectNode(addControlNode(subject.id, operatorId, contextMenu.layout)); closeContextMenu(); }
              catch (error) { setContextMenuError(error instanceof Error ? error.message : String(error)); }
            } },
          })}
          error={contextMenuError}
          onClose={closeContextMenu}
          onDeleteNode={() => {
            if (contextMenuNode) {
              deleteContextNode(contextMenuNode.id);
            }
          }}
        />
      )}
      {contextMenu && flockMenu && subject.clip.flock && (
        <FlockNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          layout={{ x: contextMenu.layout.x - (contextMenuNode?.groupOffset?.x ?? selectedNode?.groupOffset?.x ?? 0), y: contextMenu.layout.y - (contextMenuNode?.groupOffset?.y ?? selectedNode?.groupOffset?.y ?? 0) }}
          definition={subject.clip.flock}
          targetNode={flockContext ? { ...contextMenuNode!, id: (contextMenuNode!.binding as { nodeId: string }).nodeId } : null}
          selectedNodeIds={flockContext && !selectedNodeIds.includes(contextMenuNode!.id) ? [(contextMenuNode!.binding as { nodeId: string }).nodeId] : flockSelection}
          actions={flockActions}
          onSelectNodes={selectFlockNodes}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
