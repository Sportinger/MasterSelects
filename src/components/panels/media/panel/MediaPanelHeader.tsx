import { MediaAddItemsMenu, type MediaAddItemsMenuProps } from '../import/MediaAddItemsMenu';
import { MediaPanelSearch } from './MediaPanelSearch';
import { MediaViewModeControls } from './MediaViewModeControls';
import type { MediaPanelViewMode } from './types';

type MediaPanelAddItemHandlers = Omit<MediaAddItemsMenuProps, 'variant' | 'onClose'>;

export interface MediaPanelHeaderProps extends MediaPanelAddItemHandlers {
  query: string;
  onQueryChange: (value: string) => void;
  isSearchActive: boolean;
  searchResultCount: number;
  totalItems: number;
  filesNeedReload: boolean;
  filesNeedReloadCount: number;
  onOpenRelinkDialog: () => void;
  viewMode: MediaPanelViewMode;
  onViewModeChange: (mode: MediaPanelViewMode) => void;
  onImport: () => void;
  addDropdownOpen: boolean;
  onAddDropdownOpenChange: (open: boolean) => void;
}

export function MediaPanelHeader({
  query,
  onQueryChange,
  isSearchActive,
  searchResultCount,
  totalItems,
  filesNeedReload,
  filesNeedReloadCount,
  onOpenRelinkDialog,
  viewMode,
  onViewModeChange,
  onImport,
  addDropdownOpen,
  onAddDropdownOpenChange,
  onNewComposition,
  onNewFolder,
  onNewText,
  onNewSolid,
  onNewMesh,
  onNewText3D,
  onNewCamera,
  onNewSplatEffector,
  onImportGaussianSplat,
  onNewMathScene,
  onNewMotionShape,
}: MediaPanelHeaderProps) {
  const countLabel = isSearchActive
    ? `${searchResultCount} of ${totalItems} items`
    : `${totalItems} items`;

  return (
    <div className="media-panel-header">
      <MediaPanelSearch
        query={query}
        onQueryChange={onQueryChange}
      />
      <span className="media-panel-count">{countLabel}</span>
      <div className="media-panel-actions">
        {filesNeedReload && (
          <button
            className="btn btn-sm btn-reload-all"
            onClick={onOpenRelinkDialog}
            title={`Restore access to ${filesNeedReloadCount} file${filesNeedReloadCount > 1 ? 's' : ''}`}
          >
            Relink ({filesNeedReloadCount})
          </button>
        )}
        <MediaViewModeControls
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
        <button className="btn btn-sm media-panel-import-button" onClick={onImport} title="Import Media">
          Import
        </button>
        <div className="add-dropdown-container">
          <button
            className={`btn btn-sm add-dropdown-trigger ${addDropdownOpen ? 'active' : ''}`}
            onClick={() => onAddDropdownOpenChange(!addDropdownOpen)}
            title="Add New Item"
          >
            + Add &#9662;
          </button>
          {addDropdownOpen && (
            <div className="add-dropdown-menu">
              <MediaAddItemsMenu
                variant="dropdown"
                onClose={() => onAddDropdownOpenChange(false)}
                onNewComposition={onNewComposition}
                onNewFolder={onNewFolder}
                onNewText={onNewText}
                onNewSolid={onNewSolid}
                onNewMesh={onNewMesh}
                onNewText3D={onNewText3D}
                onNewCamera={onNewCamera}
                onNewSplatEffector={onNewSplatEffector}
                onImportGaussianSplat={onImportGaussianSplat}
                onNewMathScene={onNewMathScene}
                onNewMotionShape={onNewMotionShape}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
