import type { MediaFolder } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextMoveFolderSubmenuProps {
  folders: readonly MediaFolder[];
  selectedIds: readonly string[];
  multiSelect: boolean;
  onMoveToFolder: (ids: readonly string[], folderId: string | null) => void;
  onClose: () => void;
}

export function MediaContextMoveFolderSubmenu({
  folders,
  selectedIds,
  multiSelect,
  onMoveToFolder,
  onClose,
}: MediaContextMoveFolderSubmenuProps) {
  if (folders.length === 0) return null;

  const moveSelection = (folderId: string | null) => {
    onMoveToFolder(selectedIds, folderId);
    onClose();
  };

  return (
    <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
      <span>Move to Folder{multiSelect ? ` (${selectedIds.length})` : ''}</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu">
        <div
          className="context-menu-item"
          onClick={() => moveSelection(null)}
        >
          Root (no folder)
        </div>
        <div className="context-menu-separator" />
        {folders.map((folder) => (
          <div
            key={folder.id}
            className="context-menu-item"
            onClick={() => moveSelection(folder.id)}
          >
            {folder.name}
          </div>
        ))}
      </div>
    </div>
  );
}
