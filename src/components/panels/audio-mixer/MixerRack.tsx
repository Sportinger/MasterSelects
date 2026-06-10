import type { AudioEffectInstance, AudioSendState } from '../../../types/audio';
import { formatDbLong } from './audioMixerMath';
import { getEffectName, getEffectRackLabel } from './audioMixerEffects';

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function MixerRack({
  effects,
  sends,
  onOpenEffect,
  onAddSend,
  onToggleSend,
}: {
  effects: readonly AudioEffectInstance[];
  sends: readonly AudioSendState[];
  onOpenEffect: (effectId?: string) => void;
  onAddSend?: () => void;
  onToggleSend?: (send: AudioSendState) => void;
}) {
  return (
    <div className="audio-mixer-rack" onPointerDown={stopPropagation}>
      <div className="audio-mixer-rack-group inserts">
        {effects.length === 0 ? (
          <button type="button" className="audio-mixer-rack-slot empty" onClick={() => onOpenEffect()}>
            FX
          </button>
        ) : (
          effects.slice(0, 6).map((effect) => (
            <button
              type="button"
              key={effect.id}
              className={`audio-mixer-rack-slot ${effect.enabled === false ? 'bypassed' : ''}`}
              onClick={() => onOpenEffect(effect.id)}
              title={getEffectName(effect)}
            >
              <i />
              <span>{getEffectRackLabel(effect)}</span>
            </button>
          ))
        )}
        {effects.length > 6 && (
          <button type="button" className="audio-mixer-rack-slot more" onClick={() => onOpenEffect()}>
            +{effects.length - 6} FX
          </button>
        )}
      </div>

      <div className="audio-mixer-rack-group sends">
        {sends.slice(0, 3).map((send) => (
          <button
            type="button"
            key={send.id}
            className={`audio-mixer-rack-slot send ${send.enabled === false ? 'bypassed' : ''}`}
            onClick={() => onToggleSend?.(send)}
            title={`${send.targetBusId} ${formatDbLong(send.gainDb)} ${send.preFader ? 'pre' : 'post'}`}
          >
            <i />
            <span>{send.targetBusId || 'bus'}</span>
          </button>
        ))}
        {onAddSend && (
          <button type="button" className="audio-mixer-rack-slot send-add" onClick={onAddSend}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export { stopPropagation };
