import { useMemo } from 'react';
import { PHONE_TEST_IDS, type PhoneIconName } from '../contracts';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { requestPhoneHome } from '../project/PhoneProjectSheet';
import { PhoneStorageStatus } from '../project/PhoneStorageStatus';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneIcon } from './phoneIcons';

const log = Logger.create('PhoneTopBar');
const FULL_EDITOR_HINT = 'Use the full editor at /editor meanwhile.';

interface GreyedButtonProps {
  actionId: string;
  label: string;
  icon: PhoneIconName;
  reason: string;
  showLabel?: boolean;
  className?: string;
}

/** Visible, focusable, aria-disabled: tapping explains why it does not work yet. */
function GreyedButton({ actionId, label, icon, reason, showLabel, className }: GreyedButtonProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (
    <button
      type="button"
      className={`phone-icon-button ${className ?? ''}`.trim()}
      aria-label={label}
      aria-disabled="true"
      data-testid={`phone-topbar-${actionId}`}
      onClick={() => showUnavailable({ actionId, label, reason })}
    >
      <PhoneIcon name={icon} size={22} />
      {showLabel ? <span className="phone-icon-button__label">{label}</span> : null}
    </button>
  );
}

interface TopBarButtonProps {
  actionId: string;
  label: string;
  icon: PhoneIconName;
  onPress: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  className?: string;
}

/** A working top bar button; `disabled` greys it out but keeps it focusable (onPress explains why). */
function TopBarButton({ actionId, label, icon, onPress, disabled, showLabel, className }: TopBarButtonProps) {
  return (
    <button
      type="button"
      className={`phone-icon-button ${className ?? ''}`.trim()}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={`phone-topbar-${actionId}`}
      onClick={onPress}
    >
      <PhoneIcon name={icon} size={22} />
      {showLabel ? <span className="phone-icon-button__label">{label}</span> : null}
    </button>
  );
}

function CompositionTabs() {
  const compositions = useMediaStore((state) => state.compositions);
  const openIds = useMediaStore((state) => state.openCompositionIds);
  const activeId = useMediaStore((state) => state.activeCompositionId);
  const showToast = usePhoneUiStore((state) => state.showToast);

  const tabs = useMemo(
    () =>
      openIds.flatMap((id) => {
        const comp = compositions.find((candidate) => candidate.id === id);
        return comp ? [{ id, name: comp.name }] : [];
      }),
    [compositions, openIds],
  );

  const activate = async (id: string) => {
    if (id === activeId) return;
    try {
      await useMediaStore.getState().openCompositionTab(id, { skipAnimation: true });
    } catch (error) {
      log.error('Composition switch failed', error);
      showToast(`Could not open the composition: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className="phone-comp-tabs" role="tablist" aria-label="Compositions" data-testid={PHONE_TEST_IDS.compositionTabs}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="phone-comp-tab"
          aria-selected={tab.id === activeId}
          data-active={tab.id === activeId ? 'true' : 'false'}
          data-composition-id={tab.id}
          onClick={() => void activate(tab.id)}
        >
          {tab.name}
        </button>
      ))}
      <GreyedButton
        actionId="new-composition"
        label="New composition"
        icon="plus"
        className="phone-comp-tabs__add"
        reason={`Multiple compositions arrive in M3. ${FULL_EDITOR_HINT}`}
      />
    </div>
  );
}

export function PhoneTopBar() {
  const projectName = useMediaStore((state) => state.currentProjectName);
  const hasClips = useTimelineStore((state) => state.clips.length > 0);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);

  const exportProject = () => {
    // Re-read at tap time: a clip may have been added or removed since the last render.
    if (useTimelineStore.getState().clips.length === 0) {
      showToast('Add a clip first', 'info');
      return;
    }
    openSheet('export');
  };

  return (
    <header className="phone-top-bar" data-testid={PHONE_TEST_IDS.topBar}>
      <div className="phone-top-bar__row">
        <TopBarButton actionId="projects" label="Projects" icon="back" onPress={requestPhoneHome} />
        <button
          type="button"
          className="phone-top-bar__title"
          aria-label="Project: open the project list"
          data-testid={PHONE_TEST_IDS.projectName}
          onClick={() => openSheet('projects')}
        >
          {projectName || 'Untitled Project'}
        </button>
        <PhoneStorageStatus />
        <TopBarButton
          actionId="assistant"
          label="Assistant (beta)"
          icon="assistant"
          onPress={() => openSheet('assistant')}
        />
        <TopBarButton
          actionId="export"
          label="Export"
          icon="export"
          showLabel
          disabled={!hasClips}
          className="phone-icon-button--primary"
          onPress={exportProject}
        />
      </div>
      <CompositionTabs />
    </header>
  );
}
