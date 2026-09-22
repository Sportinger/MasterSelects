import { useState, type ComponentProps } from 'react';
import { useUiSettingsStore } from '../../../stores/uiSettingsStore';
import { EffectCard } from './EffectCard';

type CardId = 'volume' | 'speed';

/** Built-in sections change panel order; processing order remains defined by the audio engine. */
export function useAudioBuiltinCardOrder() {
  const firstIsSpeed = useUiSettingsStore(state => state.audioSpeedCardFirst);
  const setFirstIsSpeed = useUiSettingsStore(state => state.setAudioSpeedCardFirst);
  const [dragged, setDragged] = useState<CardId | null>(null);
  return (id: CardId): Partial<ComponentProps<typeof EffectCard>> => {
    const first = (id === 'speed') === firstIsSpeed;
    const swap = () => setFirstIsSpeed(!firstIsSpeed);
    return {
      style: { order: first ? 0 : 1 },
      onMoveEarlier: first ? undefined : swap,
      onMoveLater: first ? swap : undefined,
      dragHandleProps: { draggable: true, onDragStart: event => {
        setDragged(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id);
      } },
      onDragOver: event => { if (dragged && dragged !== id) event.preventDefault(); },
      onDrop: event => { event.preventDefault(); if (dragged && dragged !== id) swap(); setDragged(null); },
      onDragEnd: () => setDragged(null),
    };
  };
}
