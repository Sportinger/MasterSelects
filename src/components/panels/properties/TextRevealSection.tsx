import { useContext } from 'react';
import { TextSelectionContext } from './TextSelectionContext';
import { editTextSelection } from './textSelectionEditing';
import type { TextClipProperties, TextRevealMode } from '../../../types/text';
import { useTimelineStore } from '../../../stores/timeline';
import { normalizeTextRevealMode, TEXT_REVEAL_MODE_LABELS, TEXT_REVEAL_MODES } from '../../../services/text/textReveal';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { TextAnimatedNumberRow } from './TextAnimatedNumberRow';

/** Per-character reveal controls (typewriter, decode, fade, rise). Reveal is keyframeable as text.reveal. */
export function TextRevealSection({ clipId, textProperties, disabled, animatable }: {
  clipId: string; textProperties: TextClipProperties; disabled: boolean; animatable: boolean;
}) {
  const selection = useContext(TextSelectionContext);
  const mode = normalizeTextRevealMode(textProperties.revealMode);
  const hasRevealKeys = useTimelineStore(state => (state.clipKeyframes.get(clipId) ?? []).some(key => key.property === 'text.reveal'));
  const active = hasRevealKeys || (textProperties.reveal ?? 1) < 1;
  const update = (updates: Partial<TextClipProperties>) => {
    if (!disabled) editTextSelection(useTimelineStore.getState(), clipId, selection, clip => {
      useTimelineStore.getState().updateTextProperties(clip.id, updates);
    });
  };
  const usesCursor = mode === 'typewriter' || mode === 'decode';
  return (
    <ResolveInspectorSection defaultOpen={active} indicator="none" title="Reveal">
      <ResolveInspectorRow label="Mode">
        <InspectorSelect
          ariaLabel="Reveal mode"
          onChange={value => update({ revealMode: value as TextRevealMode })}
          onReset={() => update({ revealMode: 'typewriter' })}
          options={TEXT_REVEAL_MODES.map(item => ({ label: TEXT_REVEAL_MODE_LABELS[item], value: item }))}
          value={mode}
        />
      </ResolveInspectorRow>
      <TextAnimatedNumberRow clipId={clipId} parameter="reveal" baseValue={textProperties.reveal ?? 1}
        defaultValue={1} disabled={disabled} animatable={animatable} />
      {mode !== 'typewriter' && <TextAnimatedNumberRow clipId={clipId} parameter="revealSpread"
        baseValue={textProperties.revealSpread ?? 3} defaultValue={3} disabled={disabled} animatable={animatable} />}
      {usesCursor && <ResolveInspectorRow label="Cursor">
        <InspectorSelect
          ariaLabel="Reveal cursor"
          onChange={value => update({ revealCursor: value === 'block' })}
          onReset={() => update({ revealCursor: false })}
          options={[{ label: 'Off', value: 'off' }, { label: 'Block', value: 'block' }]}
          value={textProperties.revealCursor ? 'block' : 'off'}
        />
      </ResolveInspectorRow>}
    </ResolveInspectorSection>
  );
}
