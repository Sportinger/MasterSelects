import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { describeNodePort, describePortText } from '../../../../services/nodeGraph/nodePortPresentation';
import { canConnectPortReferences, createPortReference, type ConnectionDraft } from './canvasGeometry';
import { NodePortDetails } from './NodePortDetails';
import { placePortTooltip } from './portTooltipPlacement';
import './NodeGraphPorts.css';

export function NodeGraphPortView({ node, port, connectionDraft, onStartConnectionDrag, onDisconnectPortEdges }: {
  node: NodeGraphNode; port: NodeGraphPort; connectionDraft: ConnectionDraft | null;
  onStartConnectionDrag: (event: ReactPointerEvent<HTMLDivElement>, node: NodeGraphNode, port: NodeGraphPort) => void;
  onDisconnectPortEdges: (node: NodeGraphNode, port: NodeGraphPort) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null), tooltip = useRef<HTMLDivElement>(null), id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchCleanup = useRef<(() => void) | undefined>(undefined);
  const info = describeNodePort(port), isDraftStart = connectionDraft?.nodeId === node.id && connectionDraft.portId === port.id;
  const reference = createPortReference(node.id, port);
  const adaptiveTarget = connectionDraft?.target?.nodeId === node.id && connectionDraft.target.portId === port.id;
  const connectable = connectionDraft && (canConnectPortReferences(connectionDraft, reference) || adaptiveTarget);
  const keepOpen = () => { clearTimeout(closeTimer.current); };
  const show = () => {
    keepOpen(); const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
    const card = anchor.current?.closest('.node-workspace-node')?.getBoundingClientRect() ?? rect;
    setPosition(placePortTooltip(rect, card, Math.min(240, window.innerWidth - 16), 90, { width: window.innerWidth, height: window.innerHeight }, port.direction));
  };
  const hideSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPosition(null), 120); };
  useEffect(() => () => { clearTimeout(closeTimer.current); touchCleanup.current?.(); }, []);
  useLayoutEffect(() => {
    if (!position || !tooltip.current || !anchor.current) return;
    const size = tooltip.current.getBoundingClientRect(), rect = anchor.current.getBoundingClientRect();
    const card = anchor.current.closest('.node-workspace-node')?.getBoundingClientRect() ?? rect;
    const next = placePortTooltip(rect, card, size.width, size.height, { width: window.innerWidth, height: window.innerHeight }, port.direction);
    if (next.left !== position.left || next.top !== position.top) setPosition(next);
  }, [position, port.direction]);
  useEffect(() => {
    if (!position) return;
    const hide = () => setPosition(null);
    const wheel = (e: WheelEvent) => { if (!tooltip.current?.contains(e.target as Node)) hide(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const outside = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node) && !tooltip.current?.contains(e.target as Node)) hide(); };
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', hide); window.addEventListener('wheel', wheel, true);
    return () => {
      window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', hide); window.removeEventListener('wheel', wheel, true);
    };
  }, [position]);
  return <>
    <div ref={anchor} role="button" tabIndex={0}
      aria-label={`${port.direction === 'input' ? 'Input' : 'Output'} ${port.label}: ${info.typeLabel}`}
      aria-description={describePortText(port)} aria-describedby={position ? id : undefined}
      className={['node-workspace-port', `node-workspace-port-${port.direction}`, port.metadata?.required ? 'required' : '', connectable ? 'connectable' : '', isDraftStart ? 'connecting' : ''].filter(Boolean).join(' ')}
      style={{ '--port-color': info.color } as CSSProperties}
      data-node-id={node.id} data-port-id={port.id} data-direction={port.direction}
      onPointerEnter={e => { if (e.pointerType !== 'touch' && !connectionDraft) show(); }} onPointerLeave={hideSoon}
      onFocus={show} onBlur={() => setPosition(null)}
      onPointerDown={event => {
        keepOpen(); touchCleanup.current?.();
        if (event.pointerType === 'touch') {
          const { pointerId, clientX, clientY } = event;
          // The canvas captures connection drags, so pointerup may target the canvas, not this port.
          const cleanupTouch = () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
          const end = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            cleanupTouch();
            if (e.type === 'pointerup' && Math.hypot(e.clientX - clientX, e.clientY - clientY) < 6) { anchor.current?.blur(); show(); }
          };
          touchCleanup.current = cleanupTouch;
          window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
        }
        setPosition(null); onStartConnectionDrag(event, node, port);
      }}
      onClick={event => {
        event.stopPropagation();
        if (event.detail > 0) event.currentTarget.blur();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); }
        if (event.key === 'Escape') { event.preventDefault(); setPosition(null); }
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setPosition(null); onDisconnectPortEdges(node, port); }}>
      <span className="node-workspace-port-dot" />
      <span className="node-workspace-port-copy"><span className="node-workspace-port-label">{port.label}</span><span className="node-workspace-port-type">{info.typeLabel}</span></span>
    </div>
    {position && createPortal(<div ref={tooltip} id={id} role="tooltip" className="node-port-tooltip" style={{ ...position, '--port-color': info.color } as CSSProperties}
      onPointerEnter={keepOpen} onPointerLeave={hideSoon}><NodePortDetails port={port} compact /></div>, document.body)}
  </>;
}
