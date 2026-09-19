import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCategoriesWithEffects } from '../../../effects';
import type { NodeGraphConnectionRequest, NodeGraphLayout, NodeGraphViewTheme } from '../../../services/nodeGraph';
import type { NodeWorkspaceViewRequest } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { NodeGraphCanvas, type NodeGraphMove } from './NodeGraphCanvas';
import { NodeContextMenu } from './workspace/NodeContextMenu';
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
  startBatch(label);
  try {
    run();
  } finally {
    endBatch();
  }
}

export function NodeWorkspacePanel() {
  const [viewTheme, setViewTheme] = useState<NodeGraphViewTheme>('general');
  const subject = useNodeGraphSubject(viewTheme);
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
  const removeColorNode = useTimelineStore((state) => state.removeColorNode);
  const moveColorNode = useTimelineStore((state) => state.moveColorNode);
  const connectColorNodes = useTimelineStore((state) => state.connectColorNodes);
  const removeColorEdge = useTimelineStore((state) => state.removeColorEdge);
  const setColorNodeEnabled = useTimelineStore((state) => state.setColorNodeEnabled);
  const selectClip = useTimelineStore((state) => state.selectClip);
  const flockActions = useFlockGraphActions(subject?.clip.source?.type === 'flock' ? subject.clip : null);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);
  const [contextMenu, setContextMenu] = useState<NodeWorkspaceContextMenuState | null>(null);
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
    return subject.graph.nodes.find((node) => node.id === selectedNodeId) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);
  const contextMenuNode = useMemo(() => {
    if (!subject || !contextMenu?.nodeId) return null;
    return subject.graph.nodes.find((node) => node.id === contextMenu.nodeId) ?? null;
  }, [contextMenu?.nodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({ graphId, nodeId, nodeIds: [] });
  }, [graphId]);

  const selectNodes = useCallback((nodeIds: string[]) => {
    setSelection({
      graphId,
      nodeId: nodeIds[nodeIds.length - 1] ?? null,
      nodeIds: nodeIds.length > 1 ? nodeIds : [],
    });
  }, [graphId]);

  const toggleNodeSelection = useCallback((nodeId: string) => {
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
  }, []);

  const handleViewRequest = useCallback((request: NodeWorkspaceViewRequest) => {
    if (request.clipId !== subject?.selectedClip.id && request.clipId !== subject?.id) {
      selectClip(request.clipId);
    }
    setViewTheme(request.theme);
    setContextMenu(null);
  }, [selectClip, subject?.id, subject?.selectedClip.id]);
  useNodeWorkspaceViewRequests(handleViewRequest);

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

    if (activeTheme === 'flock') {
      return {
        moveNode: flockActions.moveNode,
        moveNodes: flockActions.moveNodes,
        connectPorts: (connection) => {
          flockActions.connect(connection);
        },
        disconnectEdge: flockActions.disconnect,
        deleteNode: (nodeId) => {
          if (flockActions.deleteNodes([nodeId])) selectFallbackAfterDelete([nodeId]);
        },
        deleteNodes: (nodeIds) => {
          if (flockActions.deleteNodes(nodeIds)) selectFallbackAfterDelete(nodeIds);
        },
        toggleBypass: flockActions.toggleBypass,
        duplicateSelection: () => {
          const ids = flockActions.duplicate(selectedNodeIds);
          if (ids.length > 0) selectNodes(ids);
        },
        groupSelection: () => {
          const groupNodeId = flockActions.group(selectedNodeIds, 'Group');
          if (groupNodeId) selectNode(groupNodeId);
        },
        supportsAddMenu: true,
        supportsMultiSelection: true,
        layoutScaleX: 1,
      };
    }

    if (activeTheme === 'color') {
      return {
        moveNode: (nodeId, layout) => moveColorNode(clipId, nodeId, layout),
        connectPorts: (connection) => batched('Connect node ports', () => connectColorNodes(
          clipId,
          connection.fromNodeId,
          connection.toNodeId,
          connection.fromPortId,
          connection.toPortId,
        )),
        disconnectEdge: (edgeId) => batched('Disconnect node link', () => removeColorEdge(clipId, edgeId)),
        deleteNode: (nodeId) => {
          const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
          const binding = node?.binding?.kind === 'color-node' ? node.binding : null;
          if (!binding || binding.nodeType === 'input' || binding.nodeType === 'output') return;
          batched('Delete node', () => removeColorNode(clipId, nodeId));
          selectFallbackAfterDelete([nodeId]);
        },
        toggleBypass: (nodeId) => {
          const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
          if (node?.binding?.kind !== 'color-node') return;
          batched('Toggle node bypass', () => setColorNodeEnabled(clipId, nodeId, node.params?.enabled === false));
        },
        supportsAddMenu: false,
        supportsMultiSelection: false,
        layoutScaleX: 1.75,
      };
    }

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
    connectColorNodes,
    disconnectClipNodeGraphEdge,
    flockActions,
    moveClipNodeGraphNode,
    moveColorNode,
    removeClipNodeGraphNode,
    removeColorEdge,
    removeColorNode,
    selectFallbackAfterDelete,
    selectNode,
    selectNodes,
    selectedNodeIds,
    setClipEffectEnabled,
    setColorNodeEnabled,
    subject,
    updateClipAICustomNode,
  ]);

  const deleteContextNode = useCallback((nodeId: string) => {
    adapter?.deleteNode(nodeId);
    closeContextMenu();
  }, [adapter, closeContextMenu]);

  const switchTheme = useCallback((theme: NodeGraphViewTheme) => {
    if (!subject) return;
    if (theme === 'color') {
      ensureColorCorrection(subject.id);
    }
    setViewTheme(theme);
    closeContextMenu();
  }, [closeContextMenu, ensureColorCorrection, subject]);

  const addColorGraphNode = useCallback((type: 'primary' | 'wheels') => {
    if (!subject || activeTheme !== 'color') return;
    batched(`Add ${type} color node`, () => {
      addColorNode(subject.id, type);
    });
  }, [activeTheme, addColorNode, subject]);

  if (!subject || !adapter) {
    return (
      <div className="node-workspace-panel" ref={panelRef}>
        <div className="node-workspace-empty-state">
          <h3>Nodes</h3>
          <p>Select a timeline clip</p>
        </div>
      </div>
    );
  }

  const viewLabel = activeTheme === 'color' ? 'Color subgraph' : subject.view.label;

  return (
    <div className="node-workspace-panel" ref={panelRef}>
      <div className="node-workspace-main">
        <div className="node-workspace-view-bar">
          <div className="node-workspace-view-tabs" role="tablist" aria-label="Node graph theme">
            {subject.availableViews.map((view) => (
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
          {activeTheme === 'color' && (
            <div className="node-workspace-view-actions">
              <button type="button" onClick={() => addColorGraphNode('primary')}>+ Primary</button>
              <button type="button" onClick={() => addColorGraphNode('wheels')}>+ Wheels</button>
            </div>
          )}
        </div>
        {activeTheme === 'flock' && (
          <FlockGraphStatusBar
            clip={subject.clip}
            message={flockActions.message}
            onDismissMessage={flockActions.clearMessage}
          />
        )}
        <NodeGraphCanvas
          key={subject.graph.id}
          graph={subject.graph}
          selectedNodeId={selectedNode?.id ?? null}
          selectedNodeIds={adapter.supportsMultiSelection && selectedNodeIds.length > 1 ? selectedNodeIds : undefined}
          onSelectNode={selectNode}
          onToggleNodeSelection={adapter.supportsMultiSelection ? toggleNodeSelection : undefined}
          onMoveNode={adapter.moveNode}
          onMoveNodes={adapter.moveNodes}
          onConnectPorts={adapter.connectPorts}
          onDisconnectEdge={adapter.disconnectEdge}
          onDeleteNode={adapter.deleteNode}
          onDeleteNodes={adapter.deleteNodes}
          onDuplicateSelection={adapter.duplicateSelection}
          onGroupSelection={adapter.groupSelection}
          onToggleNodeBypass={adapter.toggleBypass}
          onOpenAddMenu={adapter.supportsAddMenu ? setContextMenu : undefined}
          layoutScaleX={adapter.layoutScaleX}
        />
      </div>
      <NodeInspector
        node={selectedNode}
        clip={subject.clip}
        inspectorWidth={inspectorWidth}
        onSelectNode={selectNode}
        onOpenProperties={openProperties}
        onStartResizeInspector={startInspectorResize}
        showClipActions={activeTheme === 'general'}
        flockActions={activeTheme === 'flock' ? flockActions : undefined}
      />
      {contextMenu && activeTheme === 'general' && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetNode={contextMenuNode}
          canDeleteTarget={canDeleteNodeFromClip(subject.clip, contextMenuNode)}
          canAddVisualBuiltIns={subject.clip.source?.type !== 'audio'}
          effectCategories={effectCategories}
          onClose={closeContextMenu}
          onDeleteNode={() => {
            if (contextMenuNode) {
              deleteContextNode(contextMenuNode.id);
            }
          }}
          onAddAI={addAICustomNode}
          onAddBuiltIn={addBuiltInNode}
          onAddEffect={addEffectNode}
        />
      )}
      {contextMenu && activeTheme === 'flock' && subject.clip.flock && (
        <FlockNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          layout={contextMenu.layout}
          definition={subject.clip.flock}
          targetNode={contextMenuNode}
          selectedNodeIds={contextMenuNode && !selectedNodeIds.includes(contextMenuNode.id) ? [contextMenuNode.id] : selectedNodeIds}
          actions={flockActions}
          onSelectNodes={selectNodes}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
