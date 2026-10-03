import { createPortal } from 'react-dom';
import './WorkspaceContextMenu.css';
import { useLayoutEffect, useRef, type ComponentProps, type MouseEvent } from 'react';
import { NodeContextMenu } from '../workspace/NodeContextMenu';

/** Keep the existing catalog/actions renderer, with workspace-owned focus and
 * dismissal. Selection changes must not dismiss or remount an open menu. */
export function WorkspaceContextMenu({ ownerName, ...props }: ComponentProps<typeof NodeContextMenu> & { ownerName: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
  }, [props.x, props.y]);
  const dismissBackdrop = (event: MouseEvent) => {
    if (!(event.target as Element).classList.contains('node-workspace-context-backdrop')) return;
    event.preventDefault(); event.stopPropagation(); props.onClose();
  };
  return createPortal(<div ref={host} className="workspace-screen-menu" role="group" aria-label={`Node menu for ${ownerName}`}
    onClickCapture={dismissBackdrop} onContextMenuCapture={dismissBackdrop}
    onKeyDownCapture={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose(); }
    }}
    onKeyDown={event => event.stopPropagation()}
    onKeyUp={event => event.stopPropagation()} onKeyPress={event => event.stopPropagation()}>
    <NodeContextMenu {...props} x={Math.min(props.x, window.innerWidth - 336)}
      entries={[{ kind: 'heading', id: 'workspace-menu-owner', label: ownerName }, ...props.entries]}
      onClose={() => { /* Ignore legacy idle/hover dismissal; the wrapper handles explicit dismissal. */ }} />
  </div>, document.body);
}
