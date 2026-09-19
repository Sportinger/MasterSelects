import { useDockPinchFullscreen } from './useDockPinchFullscreen';
import { useTouchContextMenu } from './useTouchContextMenu';
import './editorTouchGestures.css';

export { isSyntheticTouchContextMenuEvent } from './useTouchContextMenu';

/** Installs editor-wide touch gestures that must arbitrate before panel controls. */
export function useEditorTouchGestures(): void {
  useTouchContextMenu();
  useDockPinchFullscreen();
}
