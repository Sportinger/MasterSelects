import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { NodeGraphConnectionRequest, NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { canConnectPortReferences, createPortReference, getPortCenter, type ConnectionDraft, type NodeGraphPoint } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';

interface Options {
  graphId: string;
  canvasRef: RefObject<HTMLDivElement | null>;
  nodesById: Map<string, NodeGraphNode>;
  getGraphPoint: (x: number, y: number) => NodeGraphPoint;
  onConnectPorts?: (connection: NodeGraphConnectionRequest) => void;
  onReconnectPorts?: (edgeId: string, connection: NodeGraphConnectionRequest) => void;
  onDisconnectEdge?: (edgeId: string) => void;
}

export function useNodeConnectionDrag({ graphId, canvasRef, nodesById, getGraphPoint, onConnectPorts, onReconnectPorts, onDisconnectEdge }: Options) {
  const [connectionDraft, setDraft] = useState<ConnectionDraft | null>(null);
  const currentDraft = useRef(connectionDraft);
  const update = (draft: ConnectionDraft | null) => { currentDraft.current = draft; setDraft(draft); };
  const cancel = () => {
    const draft = currentDraft.current;
    update(null);
    if (draft && canvasRef.current?.hasPointerCapture(draft.pointerId)) canvasRef.current.releasePointerCapture(draft.pointerId);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && currentDraft.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); cancel(); };
    // Cancel capture when switching graphs or unmounting, without mutating the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId]);

  const start = (event: ReactPointerEvent, node: NodeGraphNode, port: NodeGraphPort, plug?: ConnectionPlug) => {
    if (event.button !== 0 || currentDraft.current) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement | SVGElement).blur();
    canvasRef.current?.focus({ preventScroll: true });
    update({ ...createPortReference(node.id, port), pointerId: event.pointerId,
      start: getPortCenter(node, port.id, port.direction), end: getGraphPoint(event.clientX, event.clientY),
      originClient: { x: event.clientX, y: event.clientY }, moved: false,
      reconnectEdgeId: plug?.edge.id,
    });
    canvasRef.current?.setPointerCapture(event.pointerId);
  };
  const startConnectionDrag = (event: ReactPointerEvent, node: NodeGraphNode, port: NodeGraphPort) => {
    if (onConnectPorts) start(event, node, port);
  };
  const startPlugDrag = (event: ReactPointerEvent<SVGGElement>, plug: ConnectionPlug) => {
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
  const moveConnectionDrag = (event: ReactPointerEvent): boolean => {
    const draft = currentDraft.current;
    if (!draft || draft.pointerId !== event.pointerId) return false;
    const target = portAt(document.elementFromPoint(event.clientX, event.clientY));
    update({ ...draft, end: getGraphPoint(event.clientX, event.clientY),
      target: target && canConnectPortReferences(draft, target) ? target : undefined,
      moved: draft.moved || Math.hypot(event.clientX - draft.originClient!.x, event.clientY - draft.originClient!.y) >= 6 });
    return true;
  };
  const finishConnectionDrag = (event: ReactPointerEvent): boolean => {
    const draft = currentDraft.current;
    if (!draft || draft.pointerId !== event.pointerId) return false;
    event.preventDefault(); event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const port = portAt(target);
    cancel();
    if (draft.reconnectEdgeId && !draft.moved) return true;
    if (port && canConnectPortReferences(draft, port)) {
      const connection = draft.direction === 'output'
        ? { fromNodeId: draft.nodeId, fromPortId: draft.portId, toNodeId: port.nodeId, toPortId: port.portId }
        : { fromNodeId: port.nodeId, fromPortId: port.portId, toNodeId: draft.nodeId, toPortId: draft.portId };
      if (draft.reconnectEdgeId) onReconnectPorts?.(draft.reconnectEdgeId, connection);
      else onConnectPorts?.(connection);
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
  return { connectionDraft, ...stableHandlers };
}
