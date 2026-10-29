import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { setNodeInspectorOpen, useNodeInspectorOpen } from './nodeInspectorVisibility';
import { canSlideNodeInspector, slideNodeInspector } from './nodeInspectorSlide';

/**
 * The inspector sidebar of a Nodes view and the handle on its edge. Selection never opens it (see
 * nodeInspectorVisibility); `children` describe the current selection and are mounted while the
 * sidebar is open or still sliding out. Renders a fragment so the handle and the inspector stay
 * direct children of `.node-workspace-panel`.
 */
export function NodeInspectorDrawer({ panelId, children }: { panelId: string; children: ReactNode }) {
  const open = useNodeInspectorOpen(panelId);
  const handle = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  // Derived during render: a close keeps the inspector mounted for its slide, so it never blinks out first.
  if (shown !== open) { setShown(open); setClosing(!open && canSlideNodeInspector()); }
  const settled = useRef(open);
  const slide = useRef<{ cancel: () => void } | null>(null);
  useLayoutEffect(() => {
    if (settled.current === open || !handle.current) return;
    settled.current = open;
    slide.current = slideNodeInspector(handle.current, open, () => { if (!open) flushSync(() => setClosing(false)); });
  }, [open]);
  useLayoutEffect(() => () => slide.current?.cancel(), []);
  return <>
    <button ref={handle} type="button" className="node-workspace-inspector-handle" aria-expanded={open}
      aria-label={open ? 'Hide node inspector' : 'Show node inspector'} title={open ? 'Hide inspector' : 'Show inspector'}
      onClick={event => { if (event.detail > 0) event.currentTarget.blur(); setNodeInspectorOpen(panelId, !open); }}>
      {open ? '›' : '‹'}
    </button>
    {(open || closing) && children}
  </>;
}

/**
 * A toolbar command whose content shows in the sidebar (Catalog, Effect presets): it opens the
 * sidebar when needed and reads as pressed only while its content is visible. It subscribes to the
 * sidebar state itself, so showing or hiding the sidebar never re-renders the graph.
 */
export function NodeInspectorCommand({ panelId, active, onShow, onHide, className, children }: {
  panelId: string; active: boolean; onShow: () => void; onHide: () => void; className: string; children: ReactNode;
}) {
  const open = useNodeInspectorOpen(panelId);
  return <button type="button" className={className} aria-pressed={active && open} onClick={event => {
    if (event.detail > 0) event.currentTarget.blur();
    if (active && open) { onHide(); return; }
    onShow();
    setNodeInspectorOpen(panelId, true);
  }}>{children}</button>;
}
