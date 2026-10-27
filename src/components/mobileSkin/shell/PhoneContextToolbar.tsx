import { useMemo } from 'react';
import { PHONE_TEST_IDS, phoneActionTestId, type PhoneActionContext, type PhoneActionDefinition } from '../contracts';
import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { getPhoneActionsForScope, resolvePhoneActionState } from '../actions/phoneActionCatalog';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneIcon } from './phoneIcons';

const log = Logger.create('PhoneToolbar');

export function PhoneContextToolbar() {
  const { status } = usePhoneRuntime();
  const selected = useTimelineStore((state) => state.selectedClipIds);
  const playheadTime = useTimelineStore((state) => state.playheadPosition);
  // Subscribing to clips re-resolves Split when edits move clip edges under the playhead.
  const clips = useTimelineStore((state) => state.clips);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const showToast = usePhoneUiStore((state) => state.showToast);

  const scope = selected.size > 0 ? 'clip' : 'root';
  const context = useMemo<PhoneActionContext>(
    () => ({
      selectedClipIds: [...selected],
      playheadTime,
      projectOpen: status.projectOpen,
      engineReady: status.engineReady,
    }),
    [selected, playheadTime, status.projectOpen, status.engineReady],
  );
  const actions = useMemo(() => getPhoneActionsForScope(scope), [scope]);
  const states = useMemo(
    () => actions.map((action) => resolvePhoneActionState(action, context)),
    // clips: resolvePhoneActionState reads clip spans from the timeline store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, context, clips],
  );

  const onTap = async (action: PhoneActionDefinition) => {
    // Re-resolve at tap time: the playhead or selection may have moved since the last render.
    const live = useTimelineStore.getState();
    const liveContext: PhoneActionContext = {
      ...context,
      selectedClipIds: [...live.selectedClipIds],
      playheadTime: live.playheadPosition,
    };
    const state = resolvePhoneActionState(action, liveContext);
    if (state.kind === 'unavailable') {
      showUnavailable({ actionId: action.id, label: action.label, reason: state.reason });
      return;
    }
    if (!action.run) {
      showUnavailable({ actionId: action.id, label: action.label, reason: `${action.label} has no handler yet.` });
      return;
    }
    try {
      const result = await action.run(liveContext);
      if (!result.ok) showToast(result.message, 'error');
      else if (result.message) showToast(result.message, 'info');
    } catch (error) {
      log.error(`Action ${action.id} threw`, error);
      showToast(`${action.label} failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <nav className="phone-toolbar" aria-label="Tools" data-testid={PHONE_TEST_IDS.toolbar} data-scope={scope}>
      {scope === 'clip' ? (
        <button
          type="button"
          className="phone-tool phone-tool--back"
          aria-label="Back to main tools"
          data-testid="phone-toolbar-back"
          onClick={() => useTimelineStore.getState().selectClip(null)}
        >
          <PhoneIcon name="back" size={24} />
        </button>
      ) : null}
      <div className="phone-toolbar__scroller">
        {actions.map((action, index) => {
          const state = states[index];
          const disabled = state.kind === 'unavailable';
          return (
            <button
              key={action.id}
              type="button"
              className="phone-tool"
              aria-disabled={disabled}
              data-testid={phoneActionTestId(action.id)}
              data-milestone={action.milestone}
              onClick={() => void onTap(action)}
            >
              <PhoneIcon name={action.icon} size={26} />
              <span className="phone-tool__label">{action.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
