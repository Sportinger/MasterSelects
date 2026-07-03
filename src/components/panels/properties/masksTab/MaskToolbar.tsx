import type { ClipMask } from "../../../../types/masks";
import type { ShortcutActionId } from '../../../../services/shortcutTypes';
import type { MaskEditMode } from '../../../../stores/timeline/storeTypes/toolTypes';
import { IconButton } from './IconButton';

interface MaskToolbarShortcutRegistry {
  getLabel: (command: ShortcutActionId) => string;
}

interface MaskToolbarProps {
  activeMask: ClipMask | null;
  maskEditMode: MaskEditMode;
  registry: MaskToolbarShortcutRegistry;
  canPasteMask: boolean;
  onCreateEllipse: () => void;
  onCreateRectangle: () => void;
  onCopyActiveMask: () => void;
  onExitMaskMode: () => void;
  onPasteMask: () => void;
  onStartDrawMode: (mode: 'drawingRect' | 'drawingEllipse' | 'drawingPen') => void;
}

export function MaskToolbar({
  activeMask,
  maskEditMode,
  registry,
  canPasteMask,
  onCreateEllipse,
  onCreateRectangle,
  onCopyActiveMask,
  onExitMaskMode,
  onPasteMask,
  onStartDrawMode,
}: MaskToolbarProps) {
  return (
    <div className="mask-toolbar">
      <div className="mask-toolbar-group">
        <IconButton
          icon="pen"
          title={`Pen Tool (${registry.getLabel('mask.pen')})`}
          active={maskEditMode === 'drawingPen'}
          guidedTarget="pen"
          onClick={() => onStartDrawMode('drawingPen')}
        />
        <IconButton
          icon="rect"
          title={`Draw Rectangle (${registry.getLabel('mask.rectangle')})`}
          active={maskEditMode === 'drawingRect'}
          guidedTarget="rectangle"
          onClick={() => onStartDrawMode('drawingRect')}
        />
        <IconButton
          icon="ellipse"
          title={`Draw Ellipse (${registry.getLabel('mask.ellipse')})`}
          active={maskEditMode === 'drawingEllipse'}
          guidedTarget="ellipse"
          onClick={() => onStartDrawMode('drawingEllipse')}
        />
      </div>
      <div className="mask-toolbar-group">
        <IconButton icon="rect" title="Add rectangle mask" onClick={onCreateRectangle} />
        <IconButton icon="ellipse" title="Add ellipse mask" onClick={onCreateEllipse} />
        <IconButton
          icon="copy"
          title={`Copy active mask (${registry.getLabel('edit.copy')})`}
          disabled={!activeMask}
          onClick={onCopyActiveMask}
        />
        <IconButton
          icon="paste"
          title={`Paste mask to selected clip (${registry.getLabel('edit.paste')})`}
          disabled={!canPasteMask}
          onClick={onPasteMask}
        />
        {maskEditMode !== 'none' && (
          <IconButton icon="close" title="Exit mask mode" className="cancel" onClick={onExitMaskMode} />
        )}
      </div>
    </div>
  );
}
