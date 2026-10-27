// 'allTools' sheet: a searchable list of everything the phone can reach - every toolbar action, the
// pro sheets, the fullscreen preview and every desktop panel. Available entries open their tool;
// the rest stay listed, greyed, and say why on tap (owner rule: nearly everything reachable, grey
// out, never hide).

import { useMemo, useRef, useState, type PointerEvent } from 'react';

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import type { PanelType } from '../../../types/dock';
import type { PhoneActionContext, PhoneSheetComponent, PhoneSheetId } from '../contracts';
import { PHONE_ACTIONS, resolvePhoneActionState } from '../actions/phoneActionCatalog';
import { openPhoneAssistantWithPrompt } from '../assistant/phoneAssistantPrefill';
import { usePhonePreviewModeStore } from '../preview/phonePreviewMode';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  buildPhoneAllToolsEntries, filterPhoneAllTools, groupPhoneAllTools, phoneAllToolsBadge, PHONE_ALL_TOOLS_BADGE_TEST_ID, type PhoneAllToolsEntry,
} from './phoneAllToolsCatalog';
import { getPhonePanel } from './phonePanelCatalog';
import { PHONE_PANELS_TEST_IDS as IDS } from './phonePanelsTestIds';
import './PhoneAllTools.css';

const log = Logger.create('PhoneAllTools');

function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  event.currentTarget.blur();
}

function liveContext(base: Omit<PhoneActionContext, 'selectedClipIds' | 'playheadTime'>): PhoneActionContext {
  const timeline = useTimelineStore.getState();
  return { ...base, selectedClipIds: [...timeline.selectedClipIds], playheadTime: timeline.playheadPosition };
}

export const PhoneAllToolsSheet: PhoneSheetComponent = () => {
  const { status } = usePhoneRuntime();
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const selected = useTimelineStore((state) => state.selectedClipIds);
  const playheadTime = useTimelineStore((state) => state.playheadPosition);
  const clips = useTimelineStore((state) => state.clips);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const base = useMemo(() => ({ projectOpen: status.projectOpen, engineReady: status.engineReady }), [status.projectOpen, status.engineReady]);
  const entries = useMemo(
    () => buildPhoneAllToolsEntries({ ...base, selectedClipIds: [...selected], playheadTime }),
    // clips: action availability (Split) reads clip spans from the timeline store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, selected, playheadTime, clips],
  );
  const visible = useMemo(() => filterPhoneAllTools(entries, query), [entries, query]);
  const groups = useMemo(() => groupPhoneAllTools(visible), [visible]);

  const runAction = async (actionId: string) => {
    const action = PHONE_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action?.run) {
      showToast(`${action?.label ?? actionId} has no handler.`, 'error');
      return;
    }
    const context = liveContext(base);
    const state = resolvePhoneActionState(action, context);
    if (state.kind === 'unavailable') {
      showUnavailable({ actionId: action.id, label: action.label, reason: state.reason });
      return;
    }
    // Close first: an action that opens its own sheet replaces this one, a message shows over the editor.
    closeSheet();
    try {
      const result = await action.run(context);
      if (!result.ok) showToast(result.message, 'error');
      else if (result.message) showToast(result.message, 'info');
    } catch (error) {
      log.error(`Action ${action.id} threw`, error);
      showToast(`${action.label} failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const open = (entry: PhoneAllToolsEntry) => {
    // Re-resolve at tap time: the selection may have changed since the list rendered.
    const fresh = buildPhoneAllToolsEntries(liveContext(base)).find((candidate) => candidate.id === entry.id) ?? entry;
    if (fresh.state.kind === 'unavailable') {
      showUnavailable({ actionId: fresh.id, label: fresh.label, reason: fresh.state.reason });
      return;
    }
    const [, target] = fresh.id.split(/:(.+)/);
    switch (fresh.kind) {
      case 'action':
        void runAction(target);
        return;
      case 'sheet':
        usePhoneUiStore.getState().openSheet(target as PhoneSheetId);
        return;
      case 'panel': {
        const panel = getPhonePanel(target as PanelType);
        if (panel?.workspace) usePhoneUiStore.getState().openWorkspace(panel.workspace);
        else usePhoneUiStore.getState().openPanelSheet(target as PanelType, panel?.title ?? fresh.label);
        return;
      }
      case 'view':
        closeSheet();
        usePhonePreviewModeStore.getState().enterFullscreen();
        return;
      case 'assistant':
        // Replaces this sheet with the assistant, the task typed in and not sent.
        if (!fresh.prompt) {
          showToast(`${fresh.label} has no request text.`, 'error');
          return;
        }
        openPhoneAssistantWithPrompt(fresh.prompt);
        return;
    }
  };

  const available = visible.filter((entry) => entry.state.kind === 'available').length;

  return (
    <PhoneSheet title="All tools" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-alltools">
        <div className="phone-alltools__search">
          <input
            ref={searchRef}
            type="search"
            className="phone-alltools__input"
            placeholder="Search tools, panels and assistant tasks"
            aria-label="Search tools and panels"
            enterKeyHint="search"
            autoComplete="off"
            data-testid={IDS.allToolsSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="phone-alltools__clear"
              aria-label="Clear search"
              data-testid={IDS.allToolsClear}
              onPointerUp={blurAfterPointer}
              onClick={() => { setQuery(''); searchRef.current?.focus({ preventScroll: true }); }}
            >
              ×
            </button>
          ) : null}
        </div>
        <p className="phone-alltools__count" data-testid={IDS.allToolsCount} aria-live="polite">
          {visible.length} tools · {available} ready now
        </p>
        {groups.length === 0 ? (
          <p className="phone-alltools__empty" data-testid={IDS.allToolsEmpty}>
            Nothing matches “{query}”. Try a shorter word, or open the full editor from the project name.
          </p>
        ) : groups.map(({ group, entries: list }) => (
          <section key={group} className="phone-alltools__group" data-testid={IDS.allToolsGroup} data-group={group} aria-label={group}>
            <h3 className="phone-alltools__group-title">{group}</h3>
            <ul className="phone-alltools__list">
              {list.map((entry) => {
                const disabled = entry.state.kind === 'unavailable';
                const badge = phoneAllToolsBadge(entry.state);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="phone-alltools__entry"
                      aria-disabled={disabled}
                      data-testid={IDS.allToolsEntry}
                      data-entry-id={entry.id}
                      data-kind={entry.kind}
                      data-milestone={entry.milestone}
                      onPointerUp={blurAfterPointer}
                      onClick={() => open(entry)}
                    >
                      <span className="phone-alltools__label">{entry.label}</span>
                      <span className="phone-alltools__detail">{entry.detail}</span>
                      {badge ? <span className="phone-alltools__badge" data-testid={PHONE_ALL_TOOLS_BADGE_TEST_ID}>{badge}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PhoneSheet>
  );
};
