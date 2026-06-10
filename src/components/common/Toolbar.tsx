// Toolbar component - After Effects style menu bar

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './Toolbar.css';
import { useShallow } from 'zustand/react/shallow';
import { Logger } from '../../services/logger';
import { useEngine } from '../../hooks/useEngine';
import {
  CAN_EDIT_FACTORY_DOCK_LAYOUTS,
  useDockStore,
} from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useAccountStore } from '../../stores/accountStore';
import { SettingsDialog } from './SettingsDialog';
import { SavedToast } from './SavedToast';
import { InfoDialog } from './InfoDialog';
import { LegalDialog } from './LegalDialog';
import type { LegalPage } from './LegalDialog';
import { NativeHelperStatus } from './NativeHelperStatus';
import {
  RECENT_PROJECTS_CHANGED_EVENT,
  projectFileService,
  type RecentProjectEntry,
} from '../../services/projectFileService';
import { useMediaStore } from '../../stores/mediaStore';
import {
  loadProjectToStores,
  saveCurrentProject,
  setProjectLoadProgress,
  setupAutoSync,
} from '../../services/projectSync';
import { openOutputManager } from '../outputManager/OutputManagerBoot';
import { EditMenu } from './toolbar/EditMenu';
import { FileMenu } from './toolbar/FileMenu';
import { InfoMenu } from './toolbar/InfoMenu';
import { OutputMenu } from './toolbar/OutputMenu';
import { ViewMenu } from './toolbar/ViewMenu';
import { getToolbarShortcutLabels } from './toolbar/shortcutLabels';
import type { MenuId } from './toolbar/menuTypes';
import { useToolbarEditActions } from './toolbar/useToolbarEditActions';
import { useToolbarProjectActions } from './toolbar/useToolbarProjectActions';
import { useToolbarProjectShortcuts } from './toolbar/useToolbarProjectShortcuts';
import { useToolbarViewActions } from './toolbar/useToolbarViewActions';

const log = Logger.create('Toolbar');

interface ToolbarProps {
  onOpenChangelog?: () => void;
  onOpenSplash?: () => void;
}

export function Toolbar({ onOpenChangelog, onOpenSplash }: ToolbarProps) {
  const { isEngineReady, createOutputWindow } = useEngine();
  const targets = useRenderTargetStore((s) => s.targets);
  const outputTargets = useMemo(() => {
    const result: { id: string; name: string }[] = [];
    for (const t of targets.values()) {
      if (t.destinationType === 'window') result.push({ id: t.id, name: t.name });
    }
    return result;
  }, [targets]);

  const {
    resetLayout,
    isPanelTypeVisible,
    activatePanelType,
    hidePanelType,
    saveLayoutAsDefault,
    saveNamedLayout,
    saveCurrentNamedLayout,
    loadSavedLayout,
    savedLayouts,
    defaultSavedLayoutId,
    activeSavedLayoutId,
    setDefaultSavedLayout,
    toggleFavoriteSavedLayout,
  } = useDockStore(useShallow(s => ({
    resetLayout: s.resetLayout,
    isPanelTypeVisible: s.isPanelTypeVisible,
    activatePanelType: s.activatePanelType,
    hidePanelType: s.hidePanelType,
    saveLayoutAsDefault: s.saveLayoutAsDefault,
    saveNamedLayout: s.saveNamedLayout,
    saveCurrentNamedLayout: s.saveCurrentNamedLayout,
    loadSavedLayout: s.loadSavedLayout,
    savedLayouts: s.savedLayouts,
    defaultSavedLayoutId: s.defaultSavedLayoutId,
    activeSavedLayoutId: s.activeSavedLayoutId,
    setDefaultSavedLayout: s.setDefaultSavedLayout,
    toggleFavoriteSavedLayout: s.toggleFavoriteSavedLayout,
  })));

  const accountCredits = useAccountStore((s) => s.creditBalance);
  const accountSession = useAccountStore((s) => s.session);
  const accountUser = useAccountStore((s) => s.user);
  const openAccountDialog = useAccountStore((s) => s.openAccountDialog);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const {
    isSettingsOpen, openSettings, closeSettings,
    saveMode,
    autosaveEnabled, setAutosaveEnabled,
    autosaveInterval, setAutosaveInterval,
  } = useSettingsStore(useShallow(s => ({
    isSettingsOpen: s.isSettingsOpen,
    openSettings: s.openSettings,
    closeSettings: s.closeSettings,
    saveMode: s.saveMode,
    autosaveEnabled: s.autosaveEnabled,
    setAutosaveEnabled: s.setAutosaveEnabled,
    autosaveInterval: s.autosaveInterval,
    setAutosaveInterval: s.setAutosaveInterval,
  })));

  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [editName, setEditName] = useState(projectName);
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [pendingProjectName, setPendingProjectName] = useState<string | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [showLegalDialog, setShowLegalDialog] = useState<LegalPage | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRenamingRef = useRef(false);

  useEffect(() => {
    const updateProjectState = () => {
      const data = projectFileService.getProjectData();
      if (data) {
        setProjectName(data.name);
        setIsProjectOpen(true);
        setNeedsPermission(false);
      } else {
        setProjectName('No Project Open');
        setIsProjectOpen(false);
      }
    };

    updateProjectState();
    const interval = setInterval(updateProjectState, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const refreshRecentProjects = () => {
      setRecentProjects(projectFileService.getRecentProjects());
    };

    refreshRecentProjects();
    window.addEventListener(RECENT_PROJECTS_CHANGED_EVENT, refreshRecentProjects);
    window.addEventListener('storage', refreshRecentProjects);
    return () => {
      window.removeEventListener(RECENT_PROJECTS_CHANGED_EVENT, refreshRecentProjects);
      window.removeEventListener('storage', refreshRecentProjects);
    };
  }, []);

  useEffect(() => {
    const restoreProject = async () => {
      setIsLoading(true);
      setProjectLoadProgress({
        phase: 'opening',
        percent: 3,
        message: 'Restoring last project',
        blocking: true,
      });
      const restored = await projectFileService.restoreLastProject();
      if (restored) {
        await loadProjectToStores();
        const data = projectFileService.getProjectData();
        if (data) {
          setProjectName(data.name);
          setIsProjectOpen(true);
        }
      } else if (projectFileService.needsPermission()) {
        setNeedsPermission(true);
        setPendingProjectName(projectFileService.getPendingProjectName());
        setProjectLoadProgress(null);
      } else {
        setProjectLoadProgress(null);
      }
      setIsLoading(false);
      setupAutoSync();
    };
    restoreProject();
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearInterval(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (saveMode === 'interval' && autosaveEnabled && isProjectOpen) {
      const intervalMs = autosaveInterval * 60 * 1000;
      log.info(`Interval save enabled with ${autosaveInterval} minute interval`);

      autosaveTimerRef.current = setInterval(async () => {
        if (projectFileService.isProjectOpen() && projectFileService.hasUnsavedChanges()) {
          log.info('Interval save: Creating backup and saving project...');
          await projectFileService.createBackup();
          await saveCurrentProject();
          setShowSavedToast(true);
        }
      }, intervalMs);
    } else if (saveMode === 'continuous' && isProjectOpen) {
      log.info('Continuous save active \u2014 project saves automatically on every change');
    }

    return () => {
      if (autosaveTimerRef.current) {
        clearInterval(autosaveTimerRef.current);
      }
    };
  }, [saveMode, autosaveEnabled, autosaveInterval, isProjectOpen]);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const handleMenuClick = useCallback((menuId: MenuId) => {
    setOpenMenu((currentMenu) => (currentMenu === menuId ? null : menuId));
  }, []);

  const handleMenuHover = useCallback((menuId: MenuId) => {
    setOpenMenu((currentMenu) => (currentMenu !== null ? menuId : currentMenu));
  }, []);

  const resetMediaProject = useCallback((name: string) => {
    useMediaStore.getState().newProject();
    useMediaStore.getState().setProjectName(name);
  }, []);

  const projectActions = useToolbarProjectActions({
    closeMenu,
    editName,
    isRenamingRef,
    projectName,
    resetMediaProject,
    setEditName,
    setIsEditingName,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
    setRecentProjects,
    setRenameError,
    setShowSavedToast,
  });

  useToolbarProjectShortcuts({
    handleNew: projectActions.handleNew,
    handleOpen: projectActions.handleOpen,
    projectName,
    setIsProjectOpen,
    setProjectName,
    setShowSavedToast,
  });

  const editActions = useToolbarEditActions(openSettings, closeMenu);
  const viewActions = useToolbarViewActions({
    activeSavedLayoutId,
    activatePanelType,
    closeMenu,
    defaultSavedLayoutId,
    hidePanelType,
    isPanelTypeVisible,
    loadSavedLayout,
    resetLayout,
    saveCurrentNamedLayout,
    saveLayoutAsDefault,
    saveNamedLayout,
    savedLayouts,
    setDefaultSavedLayout,
    toggleFavoriteSavedLayout,
  });

  const shortcutLabels = useMemo(() => getToolbarShortcutLabels(), []);

  const handleNewOutput = useCallback(() => {
    const output = createOutputWindow(`Output ${Date.now()}`);
    if (output) {
      log.info('Created output window', { id: output.id });
    }
    closeMenu();
  }, [closeMenu, createOutputWindow]);

  const handleOpenOutputManager = useCallback(() => {
    openOutputManager();
    closeMenu();
  }, [closeMenu]);

  return (
    <div className="toolbar">
      <div className="toolbar-project">
        {needsPermission ? (
          <button
            className="restore-permission-btn"
            onClick={projectActions.handleRestorePermission}
            disabled={isLoading}
            title={`Click to restore access to ${pendingProjectName}`}
          >
            {isLoading ? 'Restoring...' : `Restore "${pendingProjectName}"`}
          </button>
        ) : isEditingName ? (
          <input
            type="text"
            className="project-name-input"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={projectActions.handleNameSubmit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') projectActions.handleNameSubmit();
              if (event.key === 'Escape') setIsEditingName(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className={`project-name ${!isProjectOpen ? 'no-project' : ''}`}
            onClick={() => {
              if (isProjectOpen) {
                setEditName(projectName);
                setIsEditingName(true);
              }
            }}
            title={isProjectOpen ? 'Click to rename project' : 'No project open'}
          >
            {projectName}
            {projectFileService.hasUnsavedChanges() && ' \u2022'}
          </span>
        )}
      </div>

      <div className="menu-bar" ref={menuBarRef}>
        <FileMenu
          autosaveEnabled={autosaveEnabled}
          autosaveInterval={autosaveInterval}
          hasUnsavedChanges={projectFileService.hasUnsavedChanges.bind(projectFileService)}
          isLoading={isLoading}
          isProjectOpen={isProjectOpen}
          onClearRecentProjects={projectActions.handleClearRecentProjects}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onNew={projectActions.handleNew}
          onOpen={projectActions.handleOpen}
          onOpenRecent={projectActions.handleOpenRecent}
          onSave={projectActions.handleSave}
          onSaveAs={projectActions.handleSaveAs}
          openMenu={openMenu}
          recentProjects={recentProjects}
          setAutosaveEnabled={setAutosaveEnabled}
          setAutosaveInterval={setAutosaveInterval}
          shortcutLabels={shortcutLabels}
        />

        <EditMenu
          onCopy={editActions.handleCopy}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onOpenSettings={editActions.handleOpenSettings}
          onPaste={editActions.handlePaste}
          openMenu={openMenu}
          shortcutLabels={shortcutLabels}
        />

        <ViewMenu
          activeSavedLayout={viewActions.activeSavedLayout}
          activeSavedLayoutId={activeSavedLayoutId}
          activeSavedLayoutProtected={viewActions.activeSavedLayoutProtected}
          canEditFactoryDockLayouts={CAN_EDIT_FACTORY_DOCK_LAYOUTS}
          defaultSavedLayoutId={defaultSavedLayoutId}
          isPanelTypeVisible={isPanelTypeVisible}
          onLoadDefaultLayout={viewActions.handleResetLayout}
          onLoadSavedLayout={viewActions.handleLoadSavedLayout}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onSaveCurrentLayout={viewActions.handleSaveLayoutAsDefault}
          onSaveCurrentNamedLayout={viewActions.handleSaveCurrentNamedLayout}
          onSaveNamedLayout={viewActions.handleSaveNamedLayout}
          onSetDefaultSavedLayout={viewActions.handleSetDefaultSavedLayout}
          onToggleFavoriteSavedLayout={viewActions.handleToggleFavoriteSavedLayout}
          onToggleViewPanelType={viewActions.handleToggleViewPanelType}
          openMenu={openMenu}
          sortedSavedLayouts={viewActions.sortedSavedLayouts}
        />

        <OutputMenu
          isEngineReady={isEngineReady}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onNewOutput={handleNewOutput}
          onOpenOutputManager={handleOpenOutputManager}
          openMenu={openMenu}
          outputTargets={outputTargets}
        />

        <InfoMenu
          closeMenu={closeMenu}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onOpenChangelog={onOpenChangelog}
          onOpenSplash={onOpenSplash}
          openMenu={openMenu}
          setShowLegalDialog={setShowLegalDialog}
        />
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-center">
        {viewActions.favoriteSavedLayouts.length > 0 && (
          <div className="toolbar-layout-switcher" aria-label="Favorite layouts">
            {viewActions.favoriteSavedLayouts.map((savedLayout) => (
              <button
                key={savedLayout.id}
                className={`toolbar-layout-switch ${savedLayout.id === activeSavedLayoutId ? 'active' : ''}`}
                onClick={() => loadSavedLayout(savedLayout.id)}
                title={`Load ${savedLayout.name}`}
                type="button"
              >
                {savedLayout.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-section toolbar-right">
        {accountSession?.authenticated && (
          <button
            className="toolbar-credit-pill"
            onClick={openAccountDialog}
            title={`${accountCredits} credits available`}
            type="button"
          >
            <span className="toolbar-credit-pill-label">Credits</span>
            <strong className="toolbar-credit-pill-value">{accountCredits}</strong>
          </button>
        )}
        <button
          className="menu-trigger"
          onClick={() => (accountSession?.authenticated ? openAccountDialog() : openAuthDialog())}
          type="button"
        >
          {accountSession?.authenticated ? (accountUser?.email?.split('@')[0] || 'Account') : 'Sign in'}
        </button>
        <NativeHelperStatus />

        {!isEngineReady && (
          <span className="status loading">{'\u25cb Loading...'}</span>
        )}
      </div>

      {isSettingsOpen && <SettingsDialog onClose={closeSettings} />}
      <SavedToast visible={showSavedToast} onHide={() => setShowSavedToast(false)} />

      {renameError && (
        <div style={{
          position: 'fixed',
          top: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#dc3545',
          color: '#fff',
          padding: '8px 16px',
          borderRadius: 6,
          fontSize: 12,
          zIndex: 9999,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {renameError}
        </div>
      )}

      {showInfoDialog && <InfoDialog onClose={() => setShowInfoDialog(false)} />}
      {showLegalDialog && <LegalDialog initialPage={showLegalDialog} onClose={() => setShowLegalDialog(null)} />}
    </div>
  );
}
