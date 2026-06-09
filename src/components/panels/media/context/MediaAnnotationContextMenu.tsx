import type { CSSProperties } from 'react';

import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export type MediaAnnotationColorTarget = 'backgroundColor' | 'textColor';

export interface MediaAnnotationContextValue {
  id: string;
  backgroundColor: string;
  textColor: string;
}

export interface MediaAnnotationColorOption {
  label: string;
  value: string;
}

export interface MediaAnnotationContextMenuProps {
  annotation: MediaAnnotationContextValue;
  colorOptions: readonly MediaAnnotationColorOption[];
  onUpdateColor: (
    annotationId: string,
    target: MediaAnnotationColorTarget,
    value: string,
  ) => void;
  onClose: () => void;
}

function MediaAnnotationColorSubmenu({
  annotation,
  colorOptions,
  label,
  target,
  onUpdateColor,
  onClose,
}: MediaAnnotationContextMenuProps & {
  label: string;
  target: MediaAnnotationColorTarget;
}) {
  return (
    <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
      <span>{label}</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu media-board-annotation-color-submenu">
        {colorOptions.map((option) => {
          const selected = annotation[target] === option.value;
          return (
            <div
              key={`${target}-${option.value}`}
              className="context-menu-item media-board-annotation-color-item"
              onClick={() => {
                onUpdateColor(annotation.id, target, option.value);
                onClose();
              }}
            >
              <span
                className="media-board-annotation-color-swatch"
                style={{ '--swatch-color': option.value } as CSSProperties}
              />
              <span>{option.label}{selected ? ' (current)' : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MediaAnnotationContextMenu({
  annotation,
  colorOptions,
  onUpdateColor,
  onClose,
}: MediaAnnotationContextMenuProps) {
  return (
    <>
      <MediaAnnotationColorSubmenu
        annotation={annotation}
        colorOptions={colorOptions}
        label="Background"
        target="backgroundColor"
        onUpdateColor={onUpdateColor}
        onClose={onClose}
      />
      <MediaAnnotationColorSubmenu
        annotation={annotation}
        colorOptions={colorOptions}
        label="Text"
        target="textColor"
        onUpdateColor={onUpdateColor}
        onClose={onClose}
      />
    </>
  );
}
