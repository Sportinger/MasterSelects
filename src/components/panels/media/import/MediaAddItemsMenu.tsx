import { FileTypeIcon } from '../FileTypeIcon';
import type { MediaImportAnchor } from '../panel/types';

type MediaAddItemsMenuVariant = 'dropdown' | 'context';

export interface MediaAddItemsMenuProps {
  variant: MediaAddItemsMenuVariant;
  onClose: () => void;
  onImport: (anchor?: MediaImportAnchor) => void;
  onNewComposition: () => void;
  onNewFolder: () => void;
  onNewLiveInput: () => void;
  onImportGaussianSplat: () => void;
}

export function MediaAddItemsMenu({
  variant,
  onClose,
  onImport,
  onNewComposition,
  onNewFolder,
  onNewLiveInput,
  onImportGaussianSplat,
}: MediaAddItemsMenuProps) {
  const itemClass = variant === 'dropdown' ? 'add-dropdown-item' : 'context-menu-item';
  const separatorClass = variant === 'dropdown' ? 'add-dropdown-separator' : 'context-menu-separator';
  const iconClass = variant === 'dropdown' ? 'add-dropdown-icon' : 'context-menu-icon';
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <>
      <div className={itemClass} onClick={() => run(onNewComposition)}>
        <span className={iconClass}><FileTypeIcon type="composition" /></span>
        <span>Composition</span>
      </div>
      <div className={itemClass} onClick={() => run(onNewFolder)}>
        <span className={iconClass}><span className="media-folder-icon">&#128193;</span></span>
        <span>Folder</span>
      </div>
      <div
        className={itemClass}
        onClick={(event) => {
          onImport({ x: event.clientX, y: event.clientY });
          onClose();
        }}
      >
        <span className={iconClass}><FileTypeIcon /></span>
        <span>Import files...</span>
      </div>
      <div className={separatorClass} />
      <div className={itemClass} onClick={() => run(onNewLiveInput)}>
        <span className={iconClass}><FileTypeIcon type="video" /></span>
        <span>Live Input...</span>
      </div>
      <div className={itemClass} onClick={() => run(onImportGaussianSplat)}>
        <span className={iconClass}><FileTypeIcon type="gaussian-splat" /></span>
        <span>Import Gaussian Splat...</span>
      </div>
    </>
  );
}
