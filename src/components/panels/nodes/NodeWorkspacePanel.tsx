import { compositionTrackStripView } from '../../../services/nodeGraph/composition/compositionTrackStripView';
import { compositionGroupId } from '../../../services/nodeGraph/composition/compositionGraphPrimitives';
import { getNodeHeight } from './canvas/canvasGeometry';
import { WorkspaceControllerMenus } from './unified/WorkspaceControllerMenus';
import { WorkspaceContextMenu } from './unified/WorkspaceContextMenu';
import { shareProjectedGraph } from '../../../services/nodeGraph/unified/shareProjectedGraph';
import { layoutWorkspaceExpansion } from './unified/layoutWorkspaceExpansion';
import { setWorkspaceClipGroupsCollapsed } from './unified/clipGroupFolding';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { useDockStore } from '../../../stores/dockStore';
import type { NodeGraphConnectionRequest, NodeGraphNode } from '../../../types/nodeGraph';
import type { NodeWorkspacePanelData } from '../../../types/dock';
import { NodeGraphCanvas } from './NodeGraphCanvas';
import { ACTIVE_NODE_SOURCE, NodeWorkspaceSourceSelect, TIMELINE_NODE_SOURCE, nodeViewSource } from './workspace/NodeWorkspaceSourceSelect';
import { NodeViewLockButton } from './workspace/NodeViewLockButton';
import { NodeCatalog } from './workspace/NodeCatalog';
import { CompositionBreadcrumb } from './composition/CompositionBreadcrumb';
import { CompositionNodeInspector } from './composition/CompositionNodeInspector';
import { useCompositionGraphSubject } from './composition/useCompositionGraphSubject';
import { moveCompositionClip } from './composition/compositionTimelineEdits';
import { useTransitionCompositionOpen } from '../../timeline/hooks/useTransitionCompositionOpen';
import { resolveLinkedClipNodeGraphContext } from '../../../services/nodeGraph/clipGraphLinking';
import { workspaceClipGroup, workspaceClipId, workspaceClipOwner } from '../../../services/nodeGraph/unified/workspaceIds';
import { embedWorkspaceGraph, workspaceClipRoot, collectOpenClipProjections } from '../../../services/nodeGraph/unified/embedWorkspaceGraph';
import { ClipWorkspaceController, type ClipWorkspaceControllerValue } from './unified/ClipWorkspaceController';
import { workspaceRouting } from './unified/workspaceRouting';
import { clipWorkspaceBatch } from './unified/useClipDomainAdapter';
import { useNodeWorkspaceNavigation } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import './NodeWorkspacePanel.css';

const clipOf = (node?: NodeGraphNode) => node?.binding?.kind === 'composition-clip' || node?.binding?.kind === 'composition-time-chain' ? node.binding.clipId : undefined;

/** One workspace, canvas and inspector for either root. Only open clips mount domain adapters. */
export function NodeWorkspacePanel({ panelId = 'node-workspace', data }: { panelId?: string; data?: NodeWorkspacePanelData }) {
  const compositionId = useMediaStore(state => state.activeCompositionId) ?? '';
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClips = useTimelineStore(state => state.selectedClipIds);
  const primary = useTimelineStore(state => state.primarySelectedClipId);
  const collapsed = useTimelineStore(state => state.compositionGraph?.layout?.collapsed);
  // Locked by default on the whole timeline; '@active' follows the selection; a clip id pins that clip.
  const source = nodeViewSource(data?.nodeClipId);
  const locked = source !== ACTIVE_NODE_SOURCE;
  const selectedClip = primary && selectedClips.has(primary) ? primary : selectedClips.values().next().value;
  const rootClipId = source === TIMELINE_NODE_SOURCE ? null : source === ACTIVE_NODE_SOURCE ? selectedClip ?? null : source;
  const rootOwner = rootClipId ? resolveLinkedClipNodeGraphContext(clips, tracks, rootClipId)?.ownerClip.id ?? rootClipId : null;
  const setSource = useCallback((nodeClipId: string | null) => useDockStore.getState().updatePanelData(panelId, { nodeClipId }), [panelId]);
  const [controllers, setControllers] = useState<ReadonlyMap<string, ClipWorkspaceControllerValue>>(new Map());
  const register = useCallback((id: string, value: ClipWorkspaceControllerValue | null) => setControllers(previous => {
    if (!value && !previous.has(id)) return previous;
    const next = new Map(previous); if (value) next.set(id, value); else next.delete(id); return next;
  }), []);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ graphId: string; ids: string[] } | null>(null);
  const [message, setMessage] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [compositionMenu, setCompositionMenu] = useState<{ x: number; y: number } | null>(null);
  const [focusGroup, setFocusGroup] = useState<{ id: string; nonce: number }>();
  const requestGroupFocus = (id: string) => setFocusGroup(previous => ({ id, nonce: (previous?.nonce ?? 0) + 1 }));
  const expandedIds = useMemo(() => rootOwner ? [rootOwner] : clips.filter(clip => collapsed?.[workspaceClipGroup(clip.id)] === false).map(clip => clip.id), [rootOwner, clips, collapsed]);
  const projections = useMemo(() => collectOpenClipProjections(expandedIds, id => controllers.get(id)?.projection), [expandedIds, controllers]);
  // Slice → Speed → Place opens per clip through its fold state (view state only, like any group).
  const expandedTimeChains = useMemo(() => new Set(clips.filter(clip => collapsed?.[compositionGroupId.timeChain(clip.id)] === false)
    .map(clip => clip.id)), [clips, collapsed]);
  const composition = useCompositionGraphSubject(compositionId, expandedTimeChains, undefined, !rootOwner);
  const selectedCompositionNodes = useMemo(() => new Set(selection?.graphId === composition.graph.id ? selection.ids : []), [selection, composition.graph.id]);
  // What the overview shows is decided by explicit picks (timeline clip/transition, strip segment),
  // never by grabbing or selecting nodes inside the graph.
  const [revealedClips, setRevealedClips] = useState<ReadonlySet<string>>(() => new Set());
  const [revealedNodes, setRevealedNodes] = useState<ReadonlySet<string>>(() => new Set());
  const stripGraph = useMemo(() => compositionTrackStripView(composition.graph, { selectedNodeIds: selectedCompositionNodes,
    selectedClipIds: selectedClips, revealedClipIds: expandedTimeChains.size ? new Set([...revealedClips, ...expandedTimeChains]) : revealedClips,
    revealedNodeIds: revealedNodes, expandedClipIds: new Set(expandedIds), collapsed, nodeHeight: getNodeHeight }),
    [composition.graph, selectedCompositionNodes, selectedClips, revealedClips, revealedNodes, expandedIds, collapsed, expandedTimeChains]);
  const previousGraph = useRef<ReturnType<typeof embedWorkspaceGraph> | undefined>(undefined);
  const graph = useMemo(() => {
    const next = rootOwner && projections.has(rootOwner) ? workspaceClipRoot(rootOwner, projections.get(rootOwner)!)
    : layoutWorkspaceExpansion(embedWorkspaceGraph(stripGraph, projections), stripGraph);
    const shared = shareProjectedGraph(previousGraph.current, next);
    previousGraph.current = shared;
    return shared;
  }, [rootOwner, projections, stripGraph]);
  const lastTimelineSelection = useRef(selectedClips);
  // Set while the node editor itself changes the clip selection: such picks never move the camera.
  const selectionFromGraph = useRef(false);
  useEffect(() => {
    if (lastTimelineSelection.current === selectedClips) return;
    lastTimelineSelection.current = selectedClips;
    const fromGraph = selectionFromGraph.current; selectionFromGraph.current = false;
    if (rootOwner) return;
    // A timeline pick decides which clip cards are shown; picks inside the graph keep them as they are.
    if (!fromGraph && selectedClips.size) { setRevealedClips(new Set(selectedClips)); setRevealedNodes(new Set()); }
    const ids = composition.graph.nodes.filter(node => node.binding?.kind === 'composition-clip'
      && (selectedClips.has(node.binding.clipId) || (!!node.binding.linkedClipId && selectedClips.has(node.binding.linkedClipId))))
      .map(node => graph.nodes.find(candidate => candidate.workspaceOwner?.clipId === clipOf(node) && candidate.binding?.kind === 'clip-source')?.id ?? node.id);
    const previousOwners = selection?.ids.map(workspaceClipOwner).filter(Boolean) ?? [];
    if (previousOwners.length && previousOwners.every(owner => selectedClips.has(owner!.clipId))) return;
    setSelection({ graphId: composition.graph.id, ids });
    setActiveClip(workspaceClipOwner(ids.at(-1) ?? '')?.clipId ?? null);
    // A clip picked in the timeline is brought into view; picks inside the node editor are not.
    if (!fromGraph && ids.length) requestGroupFocus(ids.at(-1)!);
  }, [selectedClips, rootOwner, composition.graph, graph, selection]);
  // A transition picked in the timeline shows the transition view: its node with both clips,
  // framed in the composition graph. Opening the body stays an explicit action (no materializing).
  const transitionSelection = useTimelineStore(state => state.propertiesSelection?.kind === 'transition' ? state.propertiesSelection.transitionId : null);
  useEffect(() => {
    if (!transitionSelection || rootOwner) return;
    const node = composition.graph.nodes.find(node => node.binding?.kind === 'composition-transition' && node.binding.transitionId === transitionSelection);
    if (!node) return;
    setSelection({ graphId: composition.graph.id, ids: [node.id] });
    setRevealedNodes(new Set([node.id])); setRevealedClips(new Set());
    requestGroupFocus(node.id);
    // Only a new transition pick refocuses; graph updates must not steal the user's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitionSelection, rootOwner]);
  const rootController = rootOwner ? controllers.get(rootOwner) : undefined;
  const currentController = rootController ?? (activeClip ? controllers.get(activeClip) : undefined);
  const selectedIdsFromWorkspace = selection?.graphId === graph.id ? selection.ids : rootController
    ? [workspaceClipId(rootOwner!, rootController.canvasProps.selectedNodeId ?? rootController.projection.graph.nodes[0]?.id ?? '')]
    : graph.nodes.filter(node => clipOf(node) && selectedClips.has(clipOf(node)!)).map(node => node.id);
  const controllerOwnsSelection = !!rootOwner || (activeClip && selection?.graphId === graph.id
    && selection.ids.length > 0 && selection.ids.every(id => workspaceClipOwner(id)?.clipId === activeClip));
  const selectedIds = controllerOwnsSelection && currentController
    ? (currentController.canvasProps.selectedNodeIds ?? [currentController.canvasProps.selectedNodeId].filter((id): id is string => !!id))
      .map(id => workspaceClipId(currentController.subject.id, id))
    : selectedIdsFromWorkspace;
  // Folded clips stay in the projection: the inspector still describes a clip picked on a strip.
  const selectedNode = graph.nodes.find(node => node.id === selectedIds.at(-1))
    ?? (rootOwner ? undefined : composition.graph.nodes.find(node => node.id === selectedIds.at(-1))) ?? null;
  const embeddedSelection = !!selectedNode?.workspaceOwner || !!rootOwner;
  const fold = (states: Record<string, boolean>) => useTimelineStore.getState().updateCompositionGraph(current => ({
    ...current, version: 1, layout: { nodes: current.layout?.nodes ?? {}, collapsed: { ...current.layout?.collapsed, ...states } },
  }), { historyLabel: 'Fold workspace nodes' });
  const toggle = (id: string) => {
    const nextCollapsed = !graph.groups?.find(group => group.id === id)?.collapsed;
    fold({ [id]: nextCollapsed });
    if (!nextCollapsed) requestGroupFocus(id);
  };
  const openTransition = useTransitionCompositionOpen();
  const open = (node: NodeGraphNode) => {
    const binding = node.binding;
    if (binding?.kind === 'composition-transition') { openTransition(binding.outgoingClipId, binding.transitionId); setSource(TIMELINE_NODE_SOURCE); }
    else if (binding?.kind === 'composition-clip') { toggle(workspaceClipGroup(binding.clipId)); }
    else { const group = graph.groups?.find(group => group.proxyId === node.id); if (group) routes.onToggleGroup?.(group.id); }
  };
  const connect = (value: NodeGraphConnectionRequest) => {
    const from = graph.nodes.find(node => node.id === value.fromNodeId), to = graph.nodes.find(node => node.id === value.toNodeId);
    const output = from?.outputs.find(port => port.id === value.fromPortId), input = to?.inputs.find(port => port.id === value.toPortId);
    const clipId = output?.metadata?.targetClipId ?? clipOf(from);
    if (!clipId || to?.binding?.kind !== 'composition-track' || !output || !input || output.metadata?.readOnly || input.metadata?.readOnly
      || output.type !== input.type) { setMessage('Only compatible clip output ? track assignments can cross a clip boundary.'); return; }
    const clip = useTimelineStore.getState().clips.find(clip => clip.id === clipId);
    if (clip) { try { setMessage(moveCompositionClip(clip.id, clip.startTime, to.binding.trackId)); } catch (error) { setMessage(String(error)); } }
  };
  const routes = workspaceRouting(graph, controllers, selectedIds, setActiveClip, { connect, toggle, message: setMessage, openMenu: setCompositionMenu });
  const select = (ids: string[], segmentClipId?: string, additive = false) => {
    setSelection({ graphId: graph.id, ids }); setMessage('');
    const owners = new Map<string, string[]>();
    const timelineIds = new Set<string>();
    for (const id of ids) {
      const owner = routes.owner(id), node = graph.nodes.find(node => node.id === id) ?? composition.graph.nodes.find(node => node.id === id);
      if (owner) { owners.set(owner.clipId, [...owners.get(owner.clipId) ?? [], owner.localId]); timelineIds.add(owner.clipId); }
      else if (clipOf(node)) timelineIds.add(clipOf(node)!);
    }
    const lastOwner = routes.owner(ids.at(-1) ?? '');
    setActiveClip(lastOwner?.clipId ?? null);
    for (const [id, nodes] of owners) controllers.get(id)?.canvasProps.onSelectNodes?.(nodes);
    if (!rootOwner) {
      const state = useTimelineStore.getState();
      // selectClip is the normal linked-pair selection; selectClips preserves explicit multi-selection.
      selectionFromGraph.current = true;
      if (segmentClipId || timelineIds.size === 1) state.selectClip(segmentClipId ?? [...timelineIds][0], additive);
      else if (timelineIds.size) state.selectClips([...timelineIds], { revealProperties: false });
    }
  };
  const onTimeline = () => {
    if (rootOwner && useMediaStore.getState().activeCompositionId === compositionId) { fold({ [workspaceClipGroup(rootOwner)]: false }); requestGroupFocus(workspaceClipGroup(rootOwner)); }
    setSource(TIMELINE_NODE_SOURCE);
  };
  const request = useNodeWorkspaceNavigation(state => state.request);
  const handled = useNodeWorkspaceNavigation(state => state.handledNonce);
  useEffect(() => {
    if (!request || request.nonce <= handled) return;
    if (request.panelId ? request.panelId !== panelId : source && source !== request.clipId) return;
    if (!rootOwner || (request.panelId && rootOwner !== request.clipId)) setSource(request.clipId);
  }, [request, handled, panelId, source, rootOwner, setSource]);
  return <div className="node-workspace-context">
    <CompositionBreadcrumb context={rootOwner ? { kind: 'clip', clipId: rootOwner } : { kind: 'composition', compositionId }} onTimeline={onTimeline} />
    {expandedIds.map(id => <ClipWorkspaceController key={`${compositionId}:${id}`} clipId={id} panelId={panelId} inline={!rootOwner} onChange={register} />)}
    <div className="node-workspace-panel" ref={currentController?.panelRef}>
      <div className="node-workspace-main">
        <div className="node-workspace-view-bar"><NodeViewLockButton locked={locked}
          onChange={lock => setSource(lock ? rootOwner ?? TIMELINE_NODE_SOURCE : ACTIVE_NODE_SOURCE)} />
          <NodeWorkspaceSourceSelect clipId={source} onChange={setSource} />
          {!embeddedSelection && <><span className="node-workspace-view-context">Composition</span><button type="button" className="node-workspace-toolbar-button"
            onClick={event => { if (event.detail > 0) event.currentTarget.blur(); setCatalogOpen(value => !value); }}>Catalog</button></>}
        </div>
        {embeddedSelection && currentController?.toolbar}
        {message && <div className="node-workspace-graph-message" role="status">{message}</div>}
        {rootOwner && !rootController ? <div className="node-workspace-empty-state">{clips.some(clip => clip.id === rootOwner) ? 'Loading clip graph?' : 'Assigned clip is not in the active composition.'}</div>
          : <NodeGraphCanvas {...routes} graph={graph} focusGroupRequest={focusGroup} followGraphGrowth={!!rootOwner} selectedNodeId={selectedNode?.id ?? null} selectedNodeIds={selectedIds}
            onSelectNode={id => select([id])} onSelectNodes={select}
            onToggleNodeSelection={id => select(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])}
            onOpenNode={id => { const node = graph.nodes.find(node => node.id === id) ?? composition.graph.nodes.find(node => node.id === id); if (node) open(node); }}
            selectedSegmentClipIds={selectedClips} onSelectSummarySegment={(id, segmentId, additive) => {
              const segment = graph.nodes.find(node => node.id === id)?.summary?.segments?.find(segment => segment.id === segmentId);
              if (!segment) return;
              if (segment.transitionId && segment.nodeId) {
                setRevealedNodes(new Set([segment.nodeId])); select([segment.nodeId]); requestGroupFocus(segment.nodeId); return;
              }
              const reference = composition.graph.nodes.find(node => node.binding?.kind === 'composition-clip'
                && (node.binding.clipId === segment.clipId || node.binding.linkedClipId === segment.clipId));
              const target = graph.nodes.find(node => node.workspaceOwner?.clipId === (reference ? clipOf(reference) : segment.clipId) && node.binding?.kind === 'clip-source') ?? reference;
              if (target) {
                // A segment pick shows that clip's card (Shift adds it), without moving the camera.
                setRevealedClips(current => additive ? new Set([...current, segment.clipId]) : new Set([segment.clipId]));
                // A plain pick replaces the shown set, closing an open transition view; Shift only adds.
                if (!additive) setRevealedNodes(new Set());
                const ids = additive ? selectedIds.includes(target.id) ? selectedIds.filter(value => value !== target.id) : [...selectedIds, target.id] : [target.id];
                select(ids, segment.clipId, additive);
              }
            }}
            onSetAllGroupsCollapsed={value => {
              try {
                const ids = rootOwner ? [rootOwner] : composition.graph.nodes.flatMap(node => clipOf(node) ? [clipOf(node)!] : []);
                clipWorkspaceBatch(value ? 'Collapse all groups' : 'Expand all groups', () => {
                  setWorkspaceClipGroupsCollapsed(ids, value, new Map([...projections].map(([id, projection]) => [id, projection.graph])));
                  if (!rootOwner) fold(Object.fromEntries((graph.groups ?? []).filter(group => !workspaceClipOwner(group.id)).map(group => [group.id, value])));
                });
              } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            }} />}
      </div>
      {embeddedSelection && currentController ? currentController.inspector : <>
        <button type="button" className="node-workspace-inspector-handle" aria-expanded={inspectorOpen} aria-label={inspectorOpen ? 'Hide node inspector' : 'Show node inspector'}
          onClick={event => { if (event.detail > 0) event.currentTarget.blur(); setInspectorOpen(value => !value); }}>{inspectorOpen ? '?' : '?'}</button>
        {inspectorOpen && (catalogOpen ? <NodeCatalog width={300} /> : <CompositionNodeInspector node={selectedNode} clipIds={[...selectedClips]} onOpen={open} />)}
      </>}
      <WorkspaceControllerMenus controllers={controllers} />
      {compositionMenu && <WorkspaceContextMenu {...compositionMenu} ownerName={`Composition: ${composition.graph.owner.name}`}
        targetNode={null} canDeleteTarget={false} onDeleteNode={() => {}} onClose={() => setCompositionMenu(null)}
        entries={[
          { kind: 'item', id: 'expand-selected', label: 'Expand selected clips', disabled: !selectedClips.size, onSelect: () => {
            fold(Object.fromEntries(composition.graph.nodes.flatMap(node => clipOf(node) && selectedClips.has(clipOf(node)!) ? [[workspaceClipGroup(clipOf(node)!), false]] : [])));
            setCompositionMenu(null);
          } },
          { kind: 'item', id: 'collapse-clips', label: 'Collapse clip graphs', onSelect: () => {
            fold(Object.fromEntries(composition.graph.nodes.flatMap(node => clipOf(node) ? [[workspaceClipGroup(clipOf(node)!), true]] : [])));
            setCompositionMenu(null);
          } },
          { kind: 'item', id: 'expand-media', label: 'Expand Media', onSelect: () => { fold({ 'comp:media': false }); setCompositionMenu(null); } },
        ]} /> }
    </div>
  </div>;
}
