import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import type { RecentProjectEntry } from '../../../services/projectFileService';
import { clearAllCacheAndReload } from './cacheActions';
import type { ToolbarMenuController, ToolbarShortcutLabels } from './menuTypes';

function formatRecentProjectDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface FileMenuProps extends ToolbarMenuController {
  isLoading: boolean;
  isProjectOpen: boolean;
  recentProjects: RecentProjectEntry[];
  shortcutLabels: ToolbarShortcutLabels;
  hasUnsavedChanges: () => boolean;
  onClearRecentProjects: () => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (projectId: string) => void;
  onRename: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportArchive: () => void;
}

export function FileMenu({
  hasUnsavedChanges,
  isLoading,
  isProjectOpen,
  onClearRecentProjects,
  onMenuClick,
  onMenuHover,
  onNew,
  onOpen,
  onOpenRecent,
  onRename,
  onSave,
  onSaveAs,
  onExportArchive,
  openMenu,
  recentProjects,
  shortcutLabels,
}: FileMenuProps) {
  const readonly = getActiveRepositorySession()?.opening.writable === false;
  return (
    <div className="menu-item" onPointerUp={event => { if (event.target instanceof HTMLElement) event.target.blur(); }}>
      <button
        className={`menu-trigger ${openMenu === 'file' ? 'active' : ''}`}
        onClick={() => onMenuClick('file')}
        onMouseEnter={() => onMenuHover('file')}
      >
        File
      </button>
      {openMenu === 'file' && (
        <div className="menu-dropdown">
          <button className="menu-option" onClick={onNew} disabled={isLoading}>
            <span>New Project...</span>
            <span className="shortcut">{shortcutLabels.new}</span>
          </button>
          <button className="menu-option" onClick={onOpen} disabled={isLoading}>
            <span>Open Project...</span>
            <span className="shortcut">{shortcutLabels.open}</span>
          </button>
          <div className="menu-item-with-submenu">
            <button className="menu-option" disabled={isLoading}>
              <span>Open Recent</span>
            </button>
            <div className="menu-nested-submenu menu-nested-submenu-recent">
              {recentProjects.length === 0 ? (
                <span className="menu-empty">No recent projects</span>
              ) : (
                <>
                  {recentProjects.map((project) => {
                    const meta = formatRecentProjectDate(project.lastOpenedAt);
                    const title = project.path || project.name;
                    return (
                      <button
                        key={project.id}
                        className="menu-option menu-option-recent"
                        onClick={() => onOpenRecent(project.id)}
                        disabled={isLoading}
                        title={title}
                      >
                        <span className="menu-recent-text">
                          <span className="menu-recent-name">{project.name}</span>
                          <span className="menu-recent-meta">{meta}</span>
                        </span>
                        <span className="menu-recent-kind">
                          {project.backend === 'native' ? 'Native' : project.backend === 'opfs' ? 'Browser local' : 'Folder'}
                        </span>
                      </button>
                    );
                  })}
                  <div className="menu-separator" />
                  <button className="menu-option" onClick={onClearRecentProjects}>
                    <span>Clear Recent Projects</span>
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="menu-separator" />
          <button className="menu-option" onClick={() => onSave()} disabled={isLoading || !isProjectOpen || readonly}>
            <span>Save now</span>
            <span className="shortcut">{shortcutLabels.save}</span>
          </button>
          <button className="menu-option" onClick={onSaveAs} disabled={isLoading}>
            <span>Duplicate project...</span>
            <span className="shortcut">{shortcutLabels.saveAs}</span>
          </button>
          <button className="menu-option" onClick={onExportArchive} disabled={isLoading || !isProjectOpen}><span>Export .msproj archive...</span></button>
          <button className="menu-option" onClick={onRename} disabled={isLoading || !isProjectOpen || readonly}>
            <span>Rename Project...</span>
          </button>
          {isProjectOpen && (
            <>
              <div className="menu-separator" />
              <div className="menu-submenu">
                <span className="menu-label">Project Info</span>
                <span className="menu-info">
                  {readonly ? 'Read-only browsing' : hasUnsavedChanges() ? '\u25cf Saving accepted changes' : '\u2713 Content confirmed'}
                </span>
              </div>
            </>
          )}
          <div className="menu-separator" />
          <button className="menu-option" onClick={clearAllCacheAndReload}>
            <span>Clear All Cache & Reload</span>
          </button>
        </div>
      )}
    </div>
  );
}
