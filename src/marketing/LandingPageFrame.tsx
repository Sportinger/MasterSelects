import {
  IconArrowRight,
  IconFolderOpen,
  IconUpload,
  IconVideo,
} from '@tabler/icons-react';

import { useAccountStore } from '../stores/accountStore';
import type { RecentProjectEntry } from '../services/projectFileService';
import {
  LandingProjectMediaStrip,
  type LandingProjectMediaItem,
} from './LandingProjectMediaStrip';
import { LandingProjectPicker } from './LandingProjectPicker';

interface LandingTopActionsProps {
  isOpeningEditor: boolean;
  onOpenEditor?: () => void;
  onShowProjectPicker?: () => void;
  openingProjectId: string | null;
  projectPickerCanClose: boolean;
  projectSelectionPending: boolean;
}

export function LandingTopActions({
  isOpeningEditor,
  onOpenEditor,
  onShowProjectPicker,
  openingProjectId,
  projectPickerCanClose,
  projectSelectionPending,
}: LandingTopActionsProps) {
  const accountSession = useAccountStore((state) => state.session);
  const accountUser = useAccountStore((state) => state.user);
  const openAccountDialog = useAccountStore((state) => state.openAccountDialog);
  const openAuthDialog = useAccountStore((state) => state.openAuthDialog);
  const accountLabel = accountSession?.authenticated
    ? accountUser?.displayName?.trim()
      || accountUser?.email?.split('@')[0]
      || 'Account'
    : 'Login';

  return (
    <div className="landing-top-actions">
      <button
        className="landing-account-button"
        type="button"
        aria-label={accountSession?.authenticated ? `Open account for ${accountLabel}` : 'Login'}
        onClick={() => (accountSession?.authenticated ? openAccountDialog() : openAuthDialog())}
      >
        {accountLabel}
      </button>
      {onShowProjectPicker && projectSelectionPending && projectPickerCanClose && (
        <button
          aria-pressed={projectPickerCanClose}
          className="landing-open-project"
          type="button"
          aria-label={projectPickerCanClose ? 'Hide project choices' : 'Show project choices'}
          disabled={isOpeningEditor || openingProjectId !== null}
          onClick={onShowProjectPicker}
        >
          <IconFolderOpen aria-hidden="true" />
          <span>Project</span>
        </button>
      )}
      {onOpenEditor && (
        <button
          className="landing-open-editor"
          type="button"
          aria-label="Open MasterSelects editor"
          disabled={isOpeningEditor}
          onClick={onOpenEditor}
        >
          <span>{isOpeningEditor ? 'Opening' : 'Editor'}</span>
          <IconArrowRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface LandingProjectOverviewProps {
  disabled: boolean;
  entering: boolean;
  exiting: boolean;
  items: LandingProjectMediaItem[];
  mounted: boolean;
  onChooseNewProject?: () => Promise<void> | void;
  onOpenProject?: () => Promise<void> | void;
  onOpenRecentProject?: (projectId: string) => Promise<void> | void;
  onRemoveItem?: (item: LandingProjectMediaItem) => void;
  onShowProjects?: () => void;
  onToggleSourceItem: (item: LandingProjectMediaItem) => void;
  openingProjectId: string | null;
  recentProjects: RecentProjectEntry[];
  removingItemId: string | null;
  selectedProjectId?: string | null;
  selectedSourceItemIds: Set<string>;
  showPicker: boolean;
  sourceSelectionMode: boolean;
}

export function LandingProjectOverview({
  disabled,
  entering,
  exiting,
  items,
  mounted,
  onChooseNewProject,
  onOpenProject,
  onOpenRecentProject,
  onRemoveItem,
  onShowProjects,
  onToggleSourceItem,
  openingProjectId,
  recentProjects,
  removingItemId,
  selectedProjectId,
  selectedSourceItemIds,
  showPicker,
  sourceSelectionMode,
}: LandingProjectOverviewProps) {
  return (
    <>
      {showPicker && (
        <LandingProjectPicker
          entering={entering}
          exiting={exiting}
          mounted={mounted}
          onChooseNewProject={onChooseNewProject}
          onOpenProject={onOpenProject}
          onOpenRecentProject={onOpenRecentProject}
          openingProjectId={openingProjectId}
          recentProjects={recentProjects}
          selectedProjectId={selectedProjectId}
        />
      )}
      <LandingProjectMediaStrip
        disabled={disabled}
        items={items}
        onRemoveItem={onRemoveItem}
        onShowProjects={onShowProjects}
        onToggleSourceItem={onToggleSourceItem}
        removingItemId={removingItemId}
        selectedSourceItemIds={selectedSourceItemIds}
        sourceSelectionMode={sourceSelectionMode}
      />
    </>
  );
}

export function LandingFinalOutput({ output }: { output: LandingProjectMediaItem }) {
  return (
    <section className="landing-final-output" aria-label="Finished video">
      <div className="landing-final-output-heading">
        <p className="landing-eyebrow">Finished video</p>
        <span>{output.name}</span>
      </div>
      <div className="landing-final-player">
        {output.mediaUrl ? (
          <video
            controls
            playsInline
            poster={output.previewUrl}
            preload="metadata"
            src={output.mediaUrl}
          />
        ) : (
          <span className="landing-file-placeholder" aria-hidden="true">
            <IconVideo />
          </span>
        )}
      </div>
    </section>
  );
}

export function LandingDropOverlay({ isImporting }: { isImporting: boolean }) {
  return (
    <div className="landing-drop-overlay" aria-live="polite" role="status">
      <span className="landing-drop-overlay-icon" aria-hidden="true">
        <IconUpload />
      </span>
      <strong>{isImporting ? 'Adding media...' : 'Drop files anywhere'}</strong>
      <span>{isImporting ? 'The project is being updated.' : 'Videos, images, audio, TXT, Markdown and PDF are supported.'}</span>
    </div>
  );
}
