// Placement mode cards of the source monitor: the seven edit types of the editor, a line that says
// where the chosen one puts the source (the editor's own placement preview) and, for the modes that
// replace a clip, the target clip with a one-tap "use the clip under the playhead".
import { usePhoneUiStore } from '../state/phoneUiStore';
import type { PhoneActionResult } from '../contracts';
import { selectPhoneSourceTargetUnderPlayhead } from './phoneSourceCommands';
import { PHONE_SOURCE_MODES, PHONE_SOURCE_TARGET_REASON, type PhoneSourceMode } from './phoneSourceModel';
import type { usePhoneSourcePlan } from './usePhoneSourcePlan';
import { PHONE_SOURCE_TEST_IDS as IDS } from './phoneSourceTestIds';

export interface PhoneSourceModesProps {
  mode: PhoneSourceMode;
  trackType: 'video' | 'audio';
  onMode: (mode: PhoneSourceMode) => void;
  plan: ReturnType<typeof usePhoneSourcePlan>;
  report: (result: PhoneActionResult) => PhoneActionResult;
}

export function PhoneSourceModes({ mode, trackType, onMode, plan, report }: PhoneSourceModesProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const hasTarget = plan.target !== null;
  return (
    <>
      <h3 className="phone-lib__section">Place</h3>
      <div className="phone-source__modes" role="radiogroup" aria-label="Placement mode">
        {PHONE_SOURCE_MODES.map((entry) => {
          const blocked = entry.needsTarget && !hasTarget;
          return (
            <button key={entry.id} type="button" role="radio" className="phone-source__mode" data-testid={IDS.mode} data-mode={entry.id}
              aria-checked={mode === entry.id} aria-disabled={blocked || undefined}
              onClick={() => {
                if (blocked) {
                  showUnavailable({ actionId: `source-${entry.id}`, label: entry.label, reason: PHONE_SOURCE_TARGET_REASON });
                  return;
                }
                onMode(entry.id);
              }}>
              <span className="phone-source__mode-label">{entry.label}</span>
              <small>{entry.detail}</small>
            </button>
          );
        })}
      </div>
      <p className="phone-source__target" data-testid={IDS.target}>
        {plan.target ? `Target clip: ${plan.target.name}` : 'No target clip selected.'}
      </p>
      <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.useClipUnderPlayhead}
        onClick={() => report(selectPhoneSourceTargetUnderPlayhead(trackType))}>
        Use the clip under the playhead
      </button>
      <p className="phone-lib__status" data-tone={plan.ok ? 'info' : 'error'} data-testid={IDS.preview} data-ok={plan.ok}>{plan.text}</p>
    </>
  );
}
