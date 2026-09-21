import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { NodeConnectionDrop, NodeGraphConnectionRequest, NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { canConnectPortReferences, createPortReference, getPortCenter, type ConnectionDraft, type NodeGraphPoint } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import { resolveAdaptiveGraphConnection } from '../../../../services/nodeGraph/adaptiveGraphConnections';

interface Options {
  graphId: string;
  canvasRef: RefObject<HTMLDivElement | null>;
  nodesById: Map<string, NodeGraphNode>;
  edges: readonly NodeGraphEdge[];
  getGraphPoint: (x: number, y: number) => NodeGraphPoint;
  onConnectPorts?: (connection: NodeGraphConnectionRequest) => void;
  onReconnectPorts?: (edgeId: string, connection: NodeGraphConnectionRequest) => void;
  onDisconnectEdge?: (edgeId: string) => void;
  onDropConnection?: (drop: NodeConnectionDrop) => void;
}

export function useNodeConnectionDrag({ graphId, canvasRef, nodesById, edges, getGraphPoint, onConnectPorts, onReconnectPorts, onDisconnectEdge, onDropConnection }: Options) {
  const [connectionDraft, setDraft] = useState<ConnectionDraft | null>(null);
  const currentDraft = useRef(connectionDraft);
  const suppressContextUntil = useRef(0);
  const update = useCallback((draft: ConnectionDraft | null) => { currentDraft.current = draft; setDraft(draft); }, []);
  const cancel = useCallback(() => {
    const draft = currentDraft.current;
    update(null);
    if (draft && canvasRef.current?.hasPointerCapture(draft.pointerId)) canvasRef.current.releasePointerCapture(draft.pointerId);
  }, [canvasRef, update]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && currentDraft.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); cancel(); };
    // Cancel capture when switching graphs or unmounting, without mutating the graph.
  }, [cancel, graphId]);

  const start = useCallback((event: ReactPointerEvent, node: NodeGraphNode, port: NodeGraphPort, plug?: ConnectionPlug) => {
    if (port.metadata?.readOnly || plug?.edge.readOnly) { event.preventDefault(); event.stopPropagation(); return; }
    if ((event.button !== 0 && !(event.button === 2 && !plug && onDropConnection)) || currentDraft.current) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement | SVGElement).blur();
    canvasRef.current?.focus({ preventScroll: true });
    update({ ...createPortReference(node.id, port), pointerId: event.pointerId,
      start: getPortCenter(node, port.id, port.direction), end: getGraphPoint(event.clientX, event.clientY),
      originClient: { x: event.clientX, y: event.clientY }, moved: false,
      reconnectEdgeId: plug?.edge.id,
      createOnDrop: event.button === 2,
    });
    canvasRef.current?.setPointerCapture(event.pointerId);
  }, [canvasRef, getGraphPoint, update, onDropConnection]);
  const startConnectionDrag = useCallback((event: ReactPointerEvent, node: NodeGraphNode, port: NodeGraphPort) => {
    if (onConnectPorts) start(event, node, port);
  }, [onConnectPorts, start]);
  const startPlugDrag = (event: ReactPointerEvent, plug: ConnectionPlug) => {
    if (!onDisconnectEdge) return;
    const input = plug.port.direction === 'input';
    const node = nodesById.get(input ? plug.edge.fromNodeId : plug.edge.toNodeId);
    const port = (input ? node?.outputs : node?.inputs)?.find(p => p.id === (input ? plug.edge.fromPortId : plug.edge.toPortId));
    if (node && port) start(event, node, port, plug);
  };
  const portAt = (target: Element | null) => {
    const element = target?.closest<HTMLElement>('.node-workspace-port, .node-workspace-plug');
    const node = element && canvasRef.current?.contains(element) ? nodesById.get(element.dataset.nodeId ?? '') : undefined;
    const port = (element?.dataset.direction === 'input' ? node?.inputs : node?.outputs)?.find(p => p.id === element?.dataset.portId);
    return node && port ? createPortReference(node.id, port) : undefined;
  };
  const compatible = (a: ReturnType<typeof createPortReference>, b: ReturnType<typeof createPortReference>) => {
    if (canConnectPortReferences(a, b)) return true;
    if (a.readOnly || b.readOnly || a.nodeId === b.nodeId || a.direction === b.direction) return false;
    const output = a.direction === 'output' ? a : b, input = a.direction === 'input' ? a : b;
    return resolveAdaptiveGraphConnection({ nodes: [...nodesById.values()], edges }, {
      fromNodeId: output.nodeId, fromPortId: output.portId, toNodeId: input.nodeId, toPortId: input.portId,
    }, currentDraft.current?.reconnectEdgeId).ok;
  };
  const moveConnectionDrag = (event: ReactPointerEvent): boolean => {
    const draft = currentDraft.current;
    if (!draft || draft.pointerId !== event.pointerId) return false;
    const target = portAt(document.elementFromPoint(event.clientX, event.clientY));
    update({ ...draft, end: getGraphPoint(event.clientX, event.clientY),
      target: target && compatible(draft, target) ? target : undefined,
      moved: draft.moved || Math.hypot(event.clientX - draft.originClient!.x, event.clientY - draft.originClient!.y) >= 6 });
    return true;
  };
  const finishConnectionDrag = (event: ReactPointerEvent): boolean => {
    const draft = currentDraft.current;
    if (!draft || draft.pointerId !== event.pointerId) return false;
    event.preventDefault(); event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const port = portAt(target);
    if (draft.createOnDrop) suppressContextUntil.current = Date.now() + 800;
    cancel();
    if (draft.reconnectEdgeId && !draft.moved) return true;
    if (port && compatible(draft, port)) {
      const connection = draft.direction === 'output'
        ? { fromNodeId: draft.nodeId, fromPortId: draft.portId, toNodeId: port.nodeId, toPortId: port.portId }
        : { fromNodeId: port.nodeId, fromPortId: port.portId, toNodeId: draft.nodeId, toPortId: draft.portId };
      if (draft.reconnectEdgeId) onReconnectPorts?.(draft.reconnectEdgeId, connection);
      else onConnectPorts?.(connection);
    } else if (draft.createOnDrop && target && canvasRef.current?.contains(target)
      && ((!draft.moved && port?.nodeId === draft.nodeId && port.portId === draft.portId)
        || (draft.moved && !target.closest('.node-workspace-node, .node-workspace-plug, .node-workspace-edge-hit')))) {
      onDropConnection?.({ nodeId: draft.nodeId, portId: draft.portId, direction: draft.direction,
        x: event.clientX, y: event.clientY, layout: getGraphPoint(event.clientX, event.clientY) });
    } else if (draft.reconnectEdgeId && (!target || !target.closest('.node-workspace-node, .node-workspace-plug'))) {
      onDisconnectEdge?.(draft.reconnectEdgeId);
    }
    return true;
  };
  const cancelConnectionDrag = (event: ReactPointerEvent): boolean => {
    if (currentDraft.current?.pointerId !== event.pointerId) return false;
    cancel(); return true;
  };
  // Stable event entry points let cards/plugs skip renders during viewport motion,
  // while the gesture always reads the latest ports, callbacks and coordinates.
  const handlers = { startConnectionDrag, startPlugDrag, moveConnectionDrag, finishConnectionDrag, cancelConnectionDrag };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const stableHandlers = useMemo(() => ({
    startConnectionDrag: (...args: Parameters<typeof startConnectionDrag>) => handlersRef.current.startConnectionDrag(...args),
    startPlugDrag: (...args: Parameters<typeof startPlugDrag>) => handlersRef.current.startPlugDrag(...args),
    moveConnectionDrag: (...args: Parameters<typeof moveConnectionDrag>) => handlersRef.current.moveConnectionDrag(...args),
    finishConnectionDrag: (...args: Parameters<typeof finishConnectionDrag>) => handlersRef.current.finishConnectionDrag(...args),
    cancelConnectionDrag: (...args: Parameters<typeof cancelConnectionDrag>) => handlersRef.current.cancelConnectionDrag(...args),
  }), []);
  return { connectionDraft, ...stableHandlers,
    suppressConnectionContextMenu: () => !!currentDraft.current?.createOnDrop || Date.now() < suppressContextUntil.current };
}
