import { useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react';
import { PHONE_TEST_IDS, type PhoneIconName } from '../contracts';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { requestPhoneHome } from './phoneHomeRequests';
import { PhoneStorageStatus } from '../project/PhoneStorageStatus';
import { leavePhoneNestedComposition } from '../compositions/phoneCompositionCommands';
import { phoneCompositionBackStep, usePhoneCompositionTrail } from '../compositions/phoneCompositionTrail';
import { PHONE_COMPOSITIONS_TEST_IDS } from '../compositions/phoneCompositionsTestIds';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneIcon } from './phoneIcons';
import { PhoneUpdateButton } from './PhoneUpdateButton';
import { scrollChildIntoStrip, usePhoneScrollEdges } from './usePhoneScrollEdges';
import './PhoneTopBar.css';

const log = Logger.create('PhoneTopBar');

/** Pointer-focus hygiene: a tapped button lets go of focus a frame later; keyboard focus stays. */
function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  const target = event.currentTarget;
  window.requestAnimationFrame(() => { if (document.activeElement === target) target.blur(); });
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

  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const trail = usePhoneCompositionTrail((state) => state.trail);
  const back = phoneCompositionBackStep(trail, activeId);
  const backName = back ? compositions.find((comp) => comp.id === back.parentId)?.name : undefined;
  const activeName = compositions.find((comp) => comp.id === activeId)?.name ?? 'No composition';

  const tabs = useMemo(
    () =>
      openIds.flatMap((id) => {
        const comp = compositions.find((candidate) => candidate.id === id);
        return comp ? [{ id, name: comp.name }] : [];
      }),
    [compositions, openIds],
  );

  // The active tab is always in view (also after switching from the list or opening a nested comp);
  // hidden tabs beyond an edge show as a fade there.
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabKey = tabs.map((tab) => `${tab.id}:${tab.name}`).join('|');
  usePhoneScrollEdges(tabsRef, [tabKey]);
  useLayoutEffect(() => {
    const strip = tabsRef.current;
    const active = strip?.querySelector<HTMLElement>('[data-active="true"]');
    if (strip && active) scrollChildIntoStrip(strip, active);
  }, [activeId, tabKey]);

  const activate = async (id: string) => {
    if (id === activeId) return;
    try {
      await useMediaStore.getState().openCompositionTab(id, { skipAnimation: true });
    } catch (error) {
      log.error('Composition switch failed', error);
      showToast(`Could not open the composition: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const goBack = async () => {
    if (!back) return;
    const result = await leavePhoneNestedComposition(back.parentId);
    if (!result.ok) showToast(result.message, 'error');
  };

  return (
    <div className="phone-comp-strip">
      <button
        type="button"
        className="phone-comp-strip__button"
        aria-label={`Compositions: ${activeName} is open. Open the composition list`}
        data-testid={PHONE_COMPOSITIONS_TEST_IDS.topBarButton}
        data-active-composition={activeId ?? ''}
        onPointerUp={blurAfterPointer}
        onClick={() => openSheet('compositions')}
      >
        <PhoneIcon name="compositions" size={18} />
      </button>
      {back && backName !== undefined ? (
        <button
          type="button"
          className="phone-comp-strip__back"
          aria-label={`Back to ${backName}`}
          data-testid={PHONE_COMPOSITIONS_TEST_IDS.topBarBack}
          onPointerUp={blurAfterPointer}
          onClick={() => void goBack()}
        >
          ‹ {backName}
        </button>
      ) : null}
    <div ref={tabsRef} className="phone-comp-tabs phone-scroll-edges" role="tablist" aria-label="Compositions" data-testid={PHONE_TEST_IDS.compositionTabs}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="phone-comp-tab"
          aria-selected={tab.id === activeId}
          data-active={tab.id === activeId ? 'true' : 'false'}
          data-composition-id={tab.id}
          title={tab.name}
          onPointerUp={blurAfterPointer}
          onClick={() => void activate(tab.id)}
        >
          {tab.name}
        </button>
      ))}
    </div>
    </div>
  );
}

/** `inert`: out of the focus order and the a11y tree while an open sheet covers it (PhoneShell). */
export function PhoneTopBar({ inert = false }: { inert?: boolean } = {}) {
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
    <header className="phone-top-bar" data-testid={PHONE_TEST_IDS.topBar} inert={inert || undefined}>
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
        <PhoneUpdateButton />
        <PhoneStorageStatus />
        <TopBarButton
          actionId="assistant"
          label="Assistant"
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
