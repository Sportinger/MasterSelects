// Transition Editor Popover
// Opened by clicking a placed transition on the timeline. Edits the transition's
// type-specific parameters, duration, and easing, or removes it.

import { useTimelineStore } from '../../../stores/timeline';
import { getTransition } from '../../../transitions';
import { TransitionControls } from '../../../transitions/TransitionControls';
import type { TimelineClip } from '../../../types';

interface TransitionEditorPopoverProps {
  // The clip that owns the transition on its `out` edge.
  clipA: TimelineClip;
  left: number;
  top: number;
  onClose: () => void;
}

export function TransitionEditorPopover({ clipA, left, top, onClose }: TransitionEditorPopoverProps) {
  const updateTransitionDuration = useTimelineStore((s) => s.updateTransitionDuration);
  const updateTransitionParams = useTimelineStore((s) => s.updateTransitionParams);
  const removeTransition = useTimelineStore((s) => s.removeTransition);

  const transition = clipA.transitionOut;
  if (!transition) return null;

  const def = getTransition(transition.type as Parameters<typeof getTransition>[0]);
  const minDuration = def?.minDuration ?? 0.1;
  const maxDuration = def?.maxDuration ?? 5.0;
  const params = transition.params ?? {};

  return (
    <div
      className="transition-editor-popover"
      style={{
        position: 'absolute',
        left,
        top,
        transform: 'translate(-50%, calc(-100% - 8px))',
        zIndex: 200,
        width: 220,
        background: '#1e1e22',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: 12,
        color: '#e6e6e6',
        fontSize: 12,
        pointerEvents: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{def?.name ?? transition.type}</span>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Duration */}
      <div className="transition-control-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ flex: '0 0 64px' }}>Duration</label>
        <input
          type="range"
          min={minDuration}
          max={maxDuration}
          step={0.05}
          value={transition.duration}
          style={{ flex: 1 }}
          onChange={(e) => updateTransitionDuration(clipA.id, 'out', parseFloat(e.target.value))}
        />
        <span style={{ flex: '0 0 32px', textAlign: 'right' }}>{transition.duration.toFixed(2)}s</span>
      </div>

      {/* Type-specific params (softness, color, easing, ...) */}
      <TransitionControls
        transitionType={transition.type}
        params={params}
        onChange={(key, value) => updateTransitionParams(clipA.id, 'out', { [key]: value })}
      />

      <button
        onClick={() => {
          removeTransition(clipA.id, 'out');
          onClose();
        }}
        style={{
          marginTop: 10,
          width: '100%',
          background: 'rgba(220, 60, 60, 0.18)',
          border: '1px solid rgba(220, 60, 60, 0.4)',
          color: '#ff9a9a',
          borderRadius: 4,
          padding: '5px 0',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Remove transition
      </button>
    </div>
  );
}

export default TransitionEditorPopover;
