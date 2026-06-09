import type { MediaFile } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextExplorerSubmenuProps {
  mediaFile: MediaFile;
  hasProxy: boolean;
  proxyFolderName: string | null | undefined;
  onShowRaw: (mediaFile: MediaFile) => Promise<void>;
  onShowProxy: (mediaFile: MediaFile) => Promise<void>;
  onClose: () => void;
}

export function MediaContextExplorerSubmenu({
  mediaFile,
  hasProxy,
  proxyFolderName,
  onShowRaw,
  onShowProxy,
  onClose,
}: MediaContextExplorerSubmenuProps) {
  return (
    <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
      <span>Show in Explorer</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu">
        <div
          className="context-menu-item"
          onClick={() => { void onShowRaw(mediaFile); }}
        >
          Raw {mediaFile.hasFileHandle && '(has path)'}
        </div>
        <div
          className={`context-menu-item ${!hasProxy ? 'disabled' : ''}`}
          onClick={() => {
            if (hasProxy) {
              void onShowProxy(mediaFile);
            } else {
              onClose();
            }
          }}
        >
          Proxy {!hasProxy ? '(not available)' : proxyFolderName ? `(${proxyFolderName})` : '(IndexedDB)'}
        </div>
      </div>
    </div>
  );
}
