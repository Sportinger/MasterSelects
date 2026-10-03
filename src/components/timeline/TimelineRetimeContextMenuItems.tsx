import type { TimelineClip } from '../../types/timeline';
import { useTimelineStore } from '../../stores/timeline';

function RetimeMenuItem({ checked, disabled, label, title, onActivate }: {
  checked: boolean;
  disabled: boolean;
  label: string;
  title?: string;
  onActivate: () => void;
}) {
  return (
    <div
      aria-checked={checked}
      aria-disabled={disabled}
      className={`context-menu-item ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}
      data-retime-menu-item
      onClick={event => {
        if (event.detail > 0) event.currentTarget.blur();
        if (!disabled) onActivate();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!disabled) event.currentTarget.click();
        }
      }}
      role="menuitemcheckbox"
      tabIndex={disabled ? -1 : 0}
      title={title}
    >
      {checked ? '\u2713 ' : ''}{label}
    </div>
  );
}

export function TimelineRetimeContextMenuItems({ clip, canModify, showReverse, onReverse, onDone }: {
  clip: TimelineClip;
  canModify: boolean;
  showReverse: boolean;
  onReverse: () => void;
  onDone: () => void;
}) {
  const kind = clip.timeRemap?.kind;
  const reverseIgnored = kind === 'freeze' || kind === 'warp';
  const toggle = (requested: 'freeze' | 'loop' | 'warp') => {
    const state = useTimelineStore.getState();
    const current = state.clips.find(candidate => candidate.id === clip.id);
    if (!canModify || !current) return;
    const changed = requested === 'warp' ? state.toggleClipWarp(clip.id)
      : current.timeRemap?.kind === requested ? state.setClipTimeRemap(clip.id, null)
      : requested === 'freeze' ? state.freezeClipAtPlayhead(clip.id)
      : state.setClipTimeRemap(clip.id, { kind: 'loop' });
    if (changed) onDone();
  };
  return (
    <>
      <style>{`[data-retime-menu-item]:focus { outline: none; }
        html:not(.pointer-focus) [data-retime-menu-item]:focus-visible {
          outline: 2px solid var(--accent); outline-offset: -2px;
          background: var(--surface-control-hover);
        }`}</style>
      {showReverse && <RetimeMenuItem checked={clip.reversed === true} disabled={!canModify}
        label="Reverse" onActivate={onReverse}
        title={reverseIgnored ? `Reverse is retained but ignored while ${kind === 'freeze' ? 'frozen' : 'warped'}.` : undefined} />}
      <RetimeMenuItem checked={kind === 'freeze'} disabled={!canModify}
        label={kind === 'freeze' ? 'Unfreeze clip' : 'Freeze frame at playhead'} onActivate={() => toggle('freeze')} />
      <RetimeMenuItem checked={kind === 'loop'} disabled={!canModify}
        label="Loop clip" onActivate={() => toggle('loop')} />
      <RetimeMenuItem checked={kind === 'warp'} disabled={!canModify}
        label="Warp clip" onActivate={() => toggle('warp')} />
    </>
  );
}
