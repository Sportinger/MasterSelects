// The keyframe diamond in the transport. With a picture clip selected and the playhead on it, a tap
// keys the clip's position, scale, rotation and opacity there (one undo step) or removes the keys
// that sit there; the diamond is filled while the playhead is on a keyframe of the clip. Without a
// usable clip it stays visible, aria-disabled, and explains why on tap (owner rule).

import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types/keyframes';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from '../text/phoneControls';
import { phoneDiamondState, resolvePhoneKeyframeTarget, togglePhoneKeyframeAtPlayhead } from './phoneKeyframeCommands';
import { PHONE_KEYFRAME_TEST_IDS } from './phoneKeyframeTestIds';
import './PhoneKeyframe.css';

const NO_KEYS: Keyframe[] = [];

function DiamondGlyph({ filled }: { filled: boolean }) {
  return (
    <svg className="phone-keyframe-diamond" width={22} height={22} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
      <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />
    </svg>
  );
}

export function PhoneKeyframeButton() {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const target = useTimelineStore((state) => {
    const result = resolvePhoneKeyframeTarget(state);
    return result.ok ? result.clip.id : result.reason;
  });
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === target));
  const keys = useTimelineStore((state) => (clip ? state.clipKeyframes.get(clip.id) ?? NO_KEYS : NO_KEYS));
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const diamond = clip ? phoneDiamondState(keys, clip, playhead) : 'outside';
  const reason = !clip ? target : diamond === 'outside' ? 'Move the playhead onto the selected clip to key it there.' : null;
  const filled = diamond === 'on';
  const label = reason ? 'Keyframe' : filled ? 'Remove keyframes at playhead' : 'Add keyframe at playhead';

  return (
    <button
      type="button"
      className="phone-icon-button phone-keyframe-button"
      aria-label={label}
      aria-disabled={reason ? 'true' : undefined}
      aria-pressed={reason ? undefined : filled}
      data-state={reason ? 'unavailable' : diamond}
      data-testid={PHONE_KEYFRAME_TEST_IDS.diamond}
      onPointerUp={blurAfterPointer}
      onClick={() => {
        if (reason) { showUnavailable({ actionId: 'keyframe', label: 'Keyframe', reason }); return; }
        const result = togglePhoneKeyframeAtPlayhead();
        if (!result.ok) showToast(result.message, 'error');
      }}
    >
      <DiamondGlyph filled={filled} />
    </button>
  );
}
