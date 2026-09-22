import { getAllAudioEffects } from '../../../engine/audio/AudioEffectRegistry';
import './AudioEffectsInspector.css';
import { EffectCatalogBrowser } from './EffectCatalogBrowser';

export function AudioEffectPicker({ onSelect, excludeDescriptorIds, allowAudioMath, title }: {
  onSelect: (id: string) => void;
  excludeDescriptorIds?: ReadonlySet<string>;
  allowAudioMath?: boolean;
  title?: string;
}) {
  const effects = getAllAudioEffects().filter(effect => !excludeDescriptorIds?.has(effect.id)
    && (effect.id !== 'audio-math' || allowAudioMath));
  return <EffectCatalogBrowser entries={effects} title={title} onSelect={onSelect}
    renderTile={(effect, apply) => <button type="button" className="audio-effect-catalog-tile"
      onClick={apply} title={`Add ${effect.name}`}>{effect.name}</button>} />;
}
