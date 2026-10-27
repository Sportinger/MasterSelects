// "Save as look" row of the Effects sheet: a name field and Save. The saved Look shows up under
// Filters → Saved on this phone and in the full editor of this browser. What a Look leaves out
// (animation, edited graphs, linked resources) is named before saving (phoneLookSave.ts).

import { useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';
import { planPhoneLookSave, savePhoneLook } from './phoneLookSave';

export function PhoneLookSaveRow({ clip }: { clip: TimelineClip }) {
  const showToast = usePhoneUiStore((state) => state.showToast);
  const keys = useTimelineStore((state) => state.clipKeyframes.get(clip.id));
  const plan = useMemo(() => planPhoneLookSave(clip.effects, keys ?? []), [clip.effects, keys]);
  const [name, setName] = useState('');
  if (plan.stack.length === 0) return null;
  const save = () => {
    const result = savePhoneLook(name, clip.effects);
    if (!result.ok) { showToast(result.message, 'error'); return; }
    setName('');
    showToast(`Saved “${result.look.name}”. Find it under Filters → Saved.`, 'info');
  };
  return (
    <form className="phone-fx__save-look" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <input
        className="phone-fx__search"
        type="text"
        enterKeyHint="done"
        placeholder="Name this effect stack"
        aria-label="Look name"
        data-testid={IDS.effectsSaveLookName}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        type="submit"
        className="phone-fx__chip"
        aria-disabled={!name.trim() || undefined}
        data-testid={IDS.effectsSaveLook}
        onPointerUp={(event) => event.currentTarget.blur()}
      >
        Save as look
      </button>
      {plan.notes.length > 0 && (
        <p className="phone-fx__note" data-testid={IDS.effectsSaveLookNote}>A look does not keep {plan.notes.join('; ')}.</p>
      )}
    </form>
  );
}
