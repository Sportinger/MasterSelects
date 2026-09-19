import { Children, useRef, useState, type ReactNode } from 'react';

interface PreviewCompositionSourceGroupProps {
  label: string;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export function PreviewCompositionSourceGroup({ label, active, onSelect, children }: PreviewCompositionSourceGroupProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touchExpanded, setTouchExpanded] = useState(false);
  const pointerFocus = useRef(false);
  const expanded = hovered || focused || touchExpanded;
  const hasLayers = Children.count(children) > 0;

  return (
    <div
      className="preview-comp-source-group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setTouchExpanded(false); }}
      onFocusCapture={() => { if (!pointerFocus.current) setFocused(true); }}
      onBlurCapture={(event) => {
        pointerFocus.current = false;
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
      onKeyDownCapture={() => {
        pointerFocus.current = false;
        setFocused(true);
      }}
      onPointerDownCapture={(event) => {
        pointerFocus.current = true;
        if (event.pointerType === 'touch') setHovered(false);
      }}
      onPointerUpCapture={(event) => {
        if (event.target instanceof HTMLElement) event.target.closest('button')?.blur();
        pointerFocus.current = false;
      }}
      onPointerCancel={() => { pointerFocus.current = false; }}
    >
      <div className="preview-comp-source-heading">
        <button type="button" className={`preview-comp-option ${active ? 'active' : ''}`} onClick={onSelect}>
          {label}
        </button>
        {hasLayers && <button
          type="button"
          className="preview-comp-option preview-comp-layer-toggle"
          aria-label={`Show layers for ${label}`}
          aria-expanded={expanded}
          onClick={() => setTouchExpanded(value => !value)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>}
      </div>
      {expanded && children}
    </div>
  );
}
