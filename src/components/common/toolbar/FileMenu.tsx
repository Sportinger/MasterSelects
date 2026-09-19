import type { AutosaveInterval } from '../../../stores/settingsStore';
import type { RecentProjectEntry } from '../../../services/projectFileService';
import { clearAllCacheAndReload } from './cacheActions';
import type { ToolbarMenuController, ToolbarShortcutLabels } from './menuTypes';

const AUTOSAVE_INTERVALS: { value: AutosaveInterval; label: string }[] = [
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
];

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
  autosaveEnabled: boolean;
  autosaveInterval: AutosaveInterval;
  isLoading: boolean;
  isProjectOpen: boolean;
  recentProjects: RecentProjectEntry[];
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveInterval: (interval: AutosaveInterval) => void;
  shortcutLabels: ToolbarShortcutLabels;
  hasUnsavedChanges: () => boolean;
  onClearRecentProjects: () => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (projectId: string) => void;
  onRename: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

export function FileMenu({
  autosaveEnabled,
  autosaveInterval,
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
  openMenu,
  recentProjects,
  setAutosaveEnabled,
  setAutosaveInterval,
  shortcutLabels,
}: FileMenuProps) {
  return (
    <div className="menu-item">
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
                          {project.backend === 'native' ? 'Native' : 'Browser'}
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
          <button className="menu-option" onClick={() => onSave()} disabled={isLoading || !isProjectOpen}>
            <span>Save</span>
            <span className="shortcut">{shortcutLabels.save}</span>
          </button>
          <button className="menu-option" onClick={onSaveAs} disabled={isLoading}>
            <span>Save As...</span>
            <span className="shortcut">{shortcutLabels.saveAs}</span>
          </button>
          <button className="menu-option" onClick={onRename} disabled={isLoading || !isProjectOpen}>
            <span>Rename Project...</span>
          </button>
          {isProjectOpen && (
            <>
              <div className="menu-separator" />
              <div className="menu-submenu">
                <span className="menu-label">Project Info</span>
                <span className="menu-info">
                  {hasUnsavedChanges() ? '\u25cf Unsaved changes' : '\u2713 All changes saved'}
                </span>
              </div>
            </>
          )}
          <div className="menu-separator" />
          <div className="menu-item-with-submenu">
            <button className="menu-option">
              <span>Autosave</span>
            </button>
            <div className="menu-nested-submenu">
              <button
                className={`menu-option ${autosaveEnabled ? 'checked' : ''}`}
                onClick={() => { setAutosaveEnabled(!autosaveEnabled); }}
              >
                <span>{autosaveEnabled ? '\u2713 ' : '   '}Enable Autosave</span>
              </button>
              <div className="menu-separator" />
              <span className="menu-sublabel">Interval</span>
              {AUTOSAVE_INTERVALS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`menu-option ${autosaveInterval === value ? 'checked' : ''}`}
                  onClick={() => { setAutosaveInterval(value); }}
                  disabled={!autosaveEnabled}
                >
                  <span>{autosaveInterval === value ? '\u2713 ' : '   '}{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="menu-separator" />
          <button className="menu-option" onClick={clearAllCacheAndReload}>
            <span>Clear All Cache & Reload</span>
          </button>
        </div>
      )}
    </div>
  );
}
