// A touch list of clips to pick several of (paste targets, titles to style together). Each row is a
// 48 px checkbox button; a clip that cannot be picked stays visible, greyed, and explains why on tap.
// "All" picks every pickable clip. Pointer focus is dropped after a tap; keyboard focus stays styled.

import type { TimelineClip } from '../../../types/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from '../text/phoneControls';
import { PHONE_CLIPBOARD_TEST_IDS as IDS } from './phoneClipboardTestIds';
import './PhoneClipboard.css';

export interface PhonePickEntry {
  clip: Pick<TimelineClip, 'id' | 'name' | 'startTime'>;
  reason: string | null;
  /** Small text after the name (e.g. "copied from"). */
  detail?: string;
}

export interface PhoneClipPickListProps {
  label: string;
  entries: readonly PhonePickEntry[];
  picked: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

const time = (seconds: number) => `${seconds.toFixed(1)} s`;

export function PhoneClipPickList({ label, entries, picked, onChange }: PhoneClipPickListProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const pickable = entries.filter((entry) => entry.reason === null);
  const allPicked = pickable.length > 0 && pickable.every((entry) => picked.has(entry.clip.id));
  const toggle = (entry: PhonePickEntry) => {
    if (entry.reason) {
      showUnavailable({ actionId: `pick-${entry.clip.id}`, label: entry.clip.name, reason: entry.reason });
      return;
    }
    const next = new Set(picked);
    if (next.has(entry.clip.id)) next.delete(entry.clip.id);
    else next.add(entry.clip.id);
    onChange(next);
  };
  return (
    <div className="phone-pick" role="group" aria-label={label}>
      <div className="phone-pick__head">
        <span className="phone-pick__label">{label}</span>
        <button
          type="button"
          className="phone-design-chip"
          aria-pressed={allPicked}
          aria-disabled={pickable.length === 0 || undefined}
          data-testid={IDS.pickAll}
          onPointerUp={blurAfterPointer}
          onClick={() => onChange(allPicked ? new Set() : new Set(pickable.map((entry) => entry.clip.id)))}
        >
          {allPicked ? 'None' : 'All'}
        </button>
      </div>
      <ul className="phone-pick__list">
        {entries.map((entry) => (
          <li key={entry.clip.id}>
            <button
              type="button"
              role="checkbox"
              className="phone-pick__row"
              aria-checked={picked.has(entry.clip.id)}
              aria-disabled={entry.reason ? 'true' : undefined}
              data-testid={IDS.pickRow}
              data-clip-id={entry.clip.id}
              onPointerUp={blurAfterPointer}
              onClick={() => toggle(entry)}
            >
              <span className="phone-pick__box" aria-hidden="true">{picked.has(entry.clip.id) ? '✓' : ''}</span>
              <span className="phone-pick__name">{entry.clip.name}</span>
              <span className="phone-pick__detail">{entry.reason ? 'locked' : entry.detail ?? time(entry.clip.startTime)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
