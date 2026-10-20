import { useState, type DragEvent } from 'react';
import { IconEye, IconEyeOff, IconMask, IconSparkles } from '@tabler/icons-react';
import { getEffect } from '../../../effects';
import type { ClipMask, Effect } from '../../../types';

const EFFECT_DRAG_TYPE = 'application/x-masterselects-layer-effect';

interface LayerMaskRowProps {
  mask: ClipMask;
  onOpen: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}

/** A mask of a layer, shown under it like a Photoshop layer mask. */
export function LayerMaskRow({ mask, onOpen, onToggleEnabled }: LayerMaskRowProps) {
  return (
    <div className={`layers-child-row${mask.enabled ? '' : ' disabled'}`} onClick={onOpen} role="option" aria-selected={false}>
      <button
        aria-label={mask.enabled ? 'Disable mask' : 'Enable mask'}
        aria-pressed={mask.enabled}
        className="layers-icon-button"
        onClick={(event) => { event.stopPropagation(); onToggleEnabled(!mask.enabled); }}
        title={mask.enabled ? 'Disable mask' : 'Enable mask'}
        type="button"
      >
        {mask.enabled ? <IconEye aria-hidden="true" size={14} /> : <IconEyeOff aria-hidden="true" size={14} />}
      </button>
      <IconMask aria-hidden="true" className="layers-child-kind" size={14} />
      <span className="layers-child-name" title={mask.name}>{mask.name}</span>
      <small className="layers-child-meta">{mask.inverted ? `${mask.mode} · inverted` : mask.mode}</small>
    </div>
  );
}

interface LayerEffectRowsProps {
  effects: readonly Effect[];
  onOpen: () => void;
  onToggleEnabled: (effectId: string, enabled: boolean) => void;
  onReorder: (effectId: string, newIndex: number) => void;
}

/** The layer's effect stack in processing order; rows can be dragged to reorder it. */
export function LayerEffectRows({ effects, onOpen, onToggleEnabled, onReorder }: LayerEffectRowsProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (!event.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const effectId = event.dataTransfer.getData(EFFECT_DRAG_TYPE);
    const target = dropIndex;
    setDropIndex(null);
    if (!effectId || target === null) return;
    event.preventDefault();
    event.stopPropagation();
    const from = effects.findIndex((effect) => effect.id === effectId);
    if (from < 0) return;
    const newIndex = target > from ? target - 1 : target;
    if (newIndex !== from) onReorder(effectId, newIndex);
  };

  return (
    <div onDragLeave={() => setDropIndex(null)} onDrop={handleDrop}>
      {effects.map((effect, index) => (
        <div
          aria-selected={false}
          className={[
            'layers-child-row',
            effect.enabled ? '' : 'disabled',
            dropIndex === index ? 'drop-above' : '',
            dropIndex === index + 1 && index === effects.length - 1 ? 'drop-below' : '',
          ].filter(Boolean).join(' ')}
          draggable
          key={effect.id}
          onClick={onOpen}
          onDragOver={(event) => handleDragOver(event, index)}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData(EFFECT_DRAG_TYPE, effect.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          role="option"
        >
          <button
            aria-label={effect.enabled ? 'Disable effect' : 'Enable effect'}
            aria-pressed={effect.enabled}
            className="layers-icon-button"
            onClick={(event) => { event.stopPropagation(); onToggleEnabled(effect.id, !effect.enabled); }}
            title={effect.enabled ? 'Disable effect' : 'Enable effect'}
            type="button"
          >
            {effect.enabled ? <IconEye aria-hidden="true" size={14} /> : <IconEyeOff aria-hidden="true" size={14} />}
          </button>
          <IconSparkles aria-hidden="true" className="layers-child-kind" size={14} />
          <span className="layers-child-name" title={effect.name}>{getEffect(effect.type)?.name ?? effect.name}</span>
        </div>
      ))}
    </div>
  );
}
