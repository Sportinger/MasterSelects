import type { MediaFile } from '../../../../stores/mediaStore';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { MediaSourceSelection } from '../../../../types/mediaMetadata';
import { selectMediaSource } from '../../../../services/project/linkedMediaSources';
import { requestRelinkDialog } from '../../../../services/project/relinkDialogRuntime';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

interface MediaContextSourceSubmenuProps {
  mediaFile: MediaFile;
  onClose: () => void;
}

export function MediaContextSourceSubmenu({ mediaFile, onClose }: MediaContextSourceSubmenuProps) {
  const proxyEnabled = useMediaStore((state) => state.proxyEnabled);
  const setProxyEnabled = useMediaStore((state) => state.setProxyEnabled);
  const selection = mediaFile.sourceSelection ?? { mode: 'auto' as const };

  const choose = async (next: MediaSourceSelection) => {
    const selected = await selectMediaSource(mediaFile.id, next);
    onClose();
    if (!selected && next.mode === 'linked') requestRelinkDialog();
  };

  return (
    <div
      className="context-menu-item has-submenu"
      onMouseEnter={handleSubmenuHover}
      onMouseLeave={handleSubmenuLeave}
    >
      <span>Media Source</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu">
        <div className="context-menu-item" onClick={() => { void choose({ mode: 'auto' }); }}>
          <span className={`view-check ${selection.mode === 'auto' ? 'checked' : ''}`}>✓</span>
          Auto
        </div>
        <div className="context-menu-item" onClick={() => { void choose({ mode: 'original' }); }}>
          <span className={`view-check ${selection.mode === 'original' ? 'checked' : ''}`}>✓</span>
          Original · {mediaFile.name}
        </div>
        {(mediaFile.linkedSources ?? []).map((source) => (
          <div
            key={source.id}
            className="context-menu-item"
            onClick={() => { void choose({ mode: 'linked', sourceId: source.id }); }}
          >
            <span className={`view-check ${selection.mode === 'linked' && selection.sourceId === source.id ? 'checked' : ''}`}>✓</span>
            {source.role === 'proxy' ? 'Linked Proxy' : 'Linked Source'} · {source.name}
          </div>
        ))}
        <div className="context-menu-separator" />
        <div
          className="context-menu-item"
          onClick={() => {
            void setProxyEnabled(!proxyEnabled);
            onClose();
          }}
        >
          <span className={`view-check ${proxyEnabled ? 'checked' : ''}`}>✓</span>
          Use MS Proxies
        </div>
      </div>
    </div>
  );
}
