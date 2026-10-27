import { useMemo } from 'react';
import { PHONE_TEST_IDS, type PhoneIconName } from '../contracts';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
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

  return (
    <header className="phone-top-bar" data-testid={PHONE_TEST_IDS.topBar}>
      <div className="phone-top-bar__row">
        <GreyedButton
          actionId="projects"
          label="Projects"
          icon="back"
          reason={`The project list on the phone arrives with milestone M1 of the phone editor. ${FULL_EDITOR_HINT}`}
        />
        <div className="phone-top-bar__title" data-testid={PHONE_TEST_IDS.projectName}>
          {projectName || 'Untitled Project'}
        </div>
        <GreyedButton
          actionId="assistant"
          label="Assistant"
          icon="assistant"
          reason={`The assistant arrives with milestone M5 of the phone editor. ${FULL_EDITOR_HINT}`}
        />
        <GreyedButton
          actionId="export"
          label="Export"
          icon="export"
          showLabel
          className="phone-icon-button--primary"
          reason={`Export arrives with milestone M1 of the phone editor. ${FULL_EDITOR_HINT}`}
        />
      </div>
      <CompositionTabs />
    </header>
  );
}
