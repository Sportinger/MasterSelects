import { startProjectAutosaveTimer } from '../../services/project/projectAutosaveTimer';
import { createProjectSaveInteractionGate } from '../../services/project/projectSaveInteractionGate';
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
import { useEngineStore } from '../../stores/engineStore';
import { SettingsDialog } from './SettingsDialog';
import { SavedToast } from './SavedToast';
import { ToolbarSaveStatus } from './toolbar/ToolbarSaveStatus';
import { DevChatDialog } from './DevChatDialog';
import { LeaveNoteDialog } from './LeaveNoteDialog';
import { LegalDialog } from './LegalDialog';
import type { LegalPage } from './LegalDialog';
import {
  ProjectNameDialog,
  type ProjectNameDialogRequest,
} from './ProjectNameDialog';
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
import { useDevChatNotification } from './toolbar/useDevChatNotification';
import { screenCaptureService } from '../../services/capture/ScreenCaptureService';
import { ToolbarLiveStatus } from './toolbar/ToolbarLiveStatus';
import { CreditBurnMeter } from './CreditBurnMeter';
import { runToolbarProjectBootRestore } from './toolbar/toolbarProjectStartup';
import { restoreAndroidProjectAutomatically } from '../../services/project/androidProjectAutoRestore';

const log = Logger.create('Toolbar');

interface ToolbarProps {
  onProjectBootResolved?: (isProjectOpen: boolean) => void;
}

export function Toolbar({
  onProjectBootResolved,
}: ToolbarProps) {
  const { isEngineReady, createOutputWindow } = useEngine();
  const engineInitFailed = useEngineStore((s) => s.engineInitFailed);
  const engineInitError = useEngineStore((s) => s.engineInitError);
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
    overLayoutBaseId,
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
    overLayoutBaseId: s.overLayoutBaseId,
    setDefaultSavedLayout: s.setDefaultSavedLayout,
    toggleFavoriteSavedLayout: s.toggleFavoriteSavedLayout,
  })));

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
  const [projectName, setProjectName] = useState('Untitled Project');
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [pendingProjectName, setPendingProjectName] = useState<string | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [showDevChatDialog, setShowDevChatDialog] = useState(false);
  const [showLeaveNoteDialog, setShowLeaveNoteDialog] = useState(false);
  const [showLegalDialog, setShowLegalDialog] = useState<LegalPage | null>(null);
  const [projectNameDialog, setProjectNameDialog] = useState<
    (ProjectNameDialogRequest & { restoreFocusTo: HTMLElement | null }) | null
  >(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [capturePhase, setCapturePhase] = useState(() => screenCaptureService.getSnapshot().phase);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<(() => void) | null>(null);
  const {
    markMessagesSeen: markDevChatMessagesSeen,
    unreadCount: devChatUnreadCount,
  } = useDevChatNotification({
    paused: showDevChatDialog,
  });

  const openDevChat = useCallback(() => {
    setShowDevChatDialog(true);
  }, []);

  useEffect(() => {
    return screenCaptureService.subscribe(snapshot => setCapturePhase(snapshot.phase));
  }, []);

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
      const restoreResult = await runToolbarProjectBootRestore({
        url: window.location.href,
        restoreLastProject: async () => (
          await restoreAndroidProjectAutomatically((handle) => projectFileService.loadProject(handle))
          || projectFileService.restoreLastProject()
        ),
        loadProjectToStores,
      });
      if (restoreResult === 'evidence-isolated') {
        log.info('Skipping automatic project restore for isolated Motion Design evidence session');
        setProjectLoadProgress(null);
        setIsLoading(false);
        onProjectBootResolved?.(projectFileService.isProjectOpen());
        return;
      }
      if (restoreResult === 'selection-deferred') {
        log.info('Deferring project restore until the entry project picker resolves');
        setProjectLoadProgress(null);
        setIsLoading(false);
        setupAutoSync();
        onProjectBootResolved?.(projectFileService.isProjectOpen());
        return;
      }
      if (restoreResult === 'restored') {
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
      onProjectBootResolved?.(projectFileService.isProjectOpen());
    };
    void restoreProject().catch((error) => {
      log.error('Failed to resolve project boot state', error);
      setProjectLoadProgress(null);
      setIsLoading(false);
      setupAutoSync();
      onProjectBootResolved?.(projectFileService.isProjectOpen());
    });
  }, [onProjectBootResolved]);

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
      autosaveTimerRef.current();
      autosaveTimerRef.current = null;
    }

    if (saveMode === 'interval' && autosaveEnabled && isProjectOpen) {
      const intervalMs = autosaveInterval * 60 * 1000;
      log.info(`Interval save enabled with ${autosaveInterval} minute interval`);

      const gestures = createProjectSaveInteractionGate(window, () => undefined);
      const stopTimer = startProjectAutosaveTimer({
        intervalMs,
        isBusy: () => gestures.isActive() || gestures.remainingQuietMs() > 0
          || Boolean(projectFileService.getProjectPackageSession?.()?.isBatchingWrites)
          || useMediaStore.getState().files.some(file => file.isImporting || file.audioProxyStatus === 'generating'),
        save: async () => {
        if (projectFileService.isProjectOpen() && projectFileService.hasUnsavedChanges()) {
          log.info('Interval save: Creating backup and saving project...');
          setShowSavedToast(false);
          try {
            await projectFileService.createBackup();
            const saved = await saveCurrentProject();
            if (saved) setShowSavedToast(true);
            else log.warn('Interval save did not complete; project remains unsaved');
          } catch (error) {
            log.error('Interval save failed', error);
          }
        }
        },
      });
      autosaveTimerRef.current = () => { stopTimer(); gestures.dispose(); };
    }

    return () => {
      if (autosaveTimerRef.current) {
        autosaveTimerRef.current();
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
    const mediaState = useMediaStore.getState();
    mediaState.newProject();
    mediaState.setProjectName(name);
  }, []);

  const openProjectNameDialog = useCallback((request: ProjectNameDialogRequest) => {
    const activeElement = document.activeElement as HTMLElement | null;
    const containingMenu = activeElement?.closest<HTMLElement>('.menu-item');
    const restoreFocusTo =
      containingMenu?.querySelector<HTMLElement>(':scope > .menu-trigger')
      ?? activeElement;
    setProjectNameDialog({ ...request, restoreFocusTo });
  }, []);

  const projectActions = useToolbarProjectActions({
    closeMenu,
    openProjectNameDialog,
    projectName,
    resetMediaProject,
    setIsLoading,
    setIsProjectOpen,
    setNeedsPermission,
    setPendingProjectName,
    setProjectName,
    setRecentProjects,
    setShowSavedToast,
  });

  useToolbarProjectShortcuts({
    handleNew: projectActions.handleNew,
    handleOpen: projectActions.handleOpen,
    handleSave: projectActions.handleSave,
    handleSaveAs: projectActions.handleSaveAs,
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
    overLayoutBaseId,
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
      {needsPermission && (
        <div className="toolbar-project">
          <button
            className="restore-permission-btn"
            onClick={projectActions.handleRestorePermission}
            disabled={isLoading}
            title={`Click to restore access to ${pendingProjectName}`}
          >
            {isLoading ? 'Restoring...' : `Restore "${pendingProjectName}"`}
          </button>
        </div>
      )}

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
          onRename={projectActions.handleRename}
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
          activeSavedLayoutId={viewActions.visibleActiveSavedLayoutId}
          activeSavedLayoutProtected={viewActions.activeSavedLayoutProtected}
          canEditFactoryDockLayouts={CAN_EDIT_FACTORY_DOCK_LAYOUTS}
          defaultSavedLayoutId={viewActions.visibleDefaultSavedLayoutId}
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
          devChatUnreadCount={devChatUnreadCount}
          onMenuClick={handleMenuClick}
          onMenuHover={handleMenuHover}
          onOpenDevChat={openDevChat}
          onOpenLeaveNote={() => setShowLeaveNoteDialog(true)}
          openMenu={openMenu}
          setShowLegalDialog={setShowLegalDialog}
        />
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-section toolbar-right">
        <ToolbarSaveStatus onSave={() => { void projectActions.handleSave(); }} />
        {(capturePhase === 'recording' || capturePhase === 'paused' || capturePhase === 'stopping') && (
          <button
            className={`toolbar-capture-rec${capturePhase === 'recording' ? ' recording' : ''}`}
            onClick={() => activatePanelType('capture')}
            title={capturePhase === 'paused' ? 'Screen capture paused' : 'Screen capture recording'}
            type="button"
          >
            <span aria-hidden="true" /> REC
          </button>
        )}
        <ToolbarLiveStatus onOpen={() => activatePanelType('go-live')} />
        {!isEngineReady && engineInitFailed && (
          <span className="status error" title={engineInitError ?? 'WebGPU initialization failed'}>
            {'\u2715 WebGPU failed'}
          </span>
        )}
        {!isEngineReady && !engineInitFailed && (
          <span className="status loading">{'\u25cb Loading...'}</span>
        )}
        <CreditBurnMeter />
      </div>

      {isSettingsOpen && <SettingsDialog onClose={closeSettings} />}
      {projectNameDialog && (
        <ProjectNameDialog
          {...projectNameDialog}
          onClose={() => setProjectNameDialog(null)}
          onSubmit={(name) => projectActions.handleProjectNameSubmit(projectNameDialog.mode, name)}
        />
      )}
      <SavedToast visible={showSavedToast} onHide={() => setShowSavedToast(false)} />

      {showDevChatDialog && (
        <DevChatDialog
          onClose={() => setShowDevChatDialog(false)}
          onMessagesSeen={markDevChatMessagesSeen}
        />
      )}
      {showLeaveNoteDialog && <LeaveNoteDialog onClose={() => setShowLeaveNoteDialog(false)} />}
      {showLegalDialog && <LegalDialog initialPage={showLegalDialog} onClose={() => setShowLegalDialog(null)} />}
    </div>
  );
}
