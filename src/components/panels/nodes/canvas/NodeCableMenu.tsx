import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CableMenuState } from './useNodeCableBranches';
import type { RoutedCable } from './cableBranches';
import './NodeGraphBranches.css';

interface Props {
  menu: CableMenuState & { cable: RoutedCable; trunk?: string };
  onClose: () => void;
  onAddBranch: (cableId: string, point: CableMenuState['point']) => void;
  onRemoveBranch: (id: string) => void;
  onDisconnect?: (edgeId: string) => void;
}

/** Cable context menu: branch the cable at the pointer, remove a branch point, or disconnect. */
export function NodeCableMenu({ menu, onClose, onAddBranch, onRemoveBranch, onDisconnect }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: Event) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', onClose);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const act = (action: () => void) => () => { action(); onClose(); };
  const edge = menu.cable.edge;
  // Portaled: transformed dock panels must not offset the fixed menu position.
  return createPortal(<div ref={ref} className="node-cable-menu" role="menu" style={{ left: menu.clientX, top: menu.clientY }}
    onContextMenu={event => event.preventDefault()}>
    {!edge?.readOnly && <button type="button" role="menuitem" onClick={act(() => onAddBranch(menu.cableId, menu.point))}>Add branch point here</button>}
    {menu.trunk && <button type="button" role="menuitem" onClick={act(() => onRemoveBranch(menu.trunk!))}>Remove branch point</button>}
    {edge && !edge.readOnly && onDisconnect && <button type="button" role="menuitem" onClick={act(() => onDisconnect(edge.id))}>Disconnect</button>}
  </div>, document.body);
}
