// 'audioFx' sheet (clip scope): the editor's audio effects on the selected clip's sound (an audio
// clip, or the linked sound of a video): add from the registry by category, switch on/off, move,
// remove, one main value per effect, and "All parameters" in the desktop Properties panel. Clean up
// (normalize, silence removal, repair suggestions) and AI (stems, speech/music/sounds) sit in
// their own sections. Effect curves open the landscape Curves editor on the clip, Track and master
// effects open the Mixer (both keep this sheet's changes first). Everything that edits is live inside
// ONE phone edit session: Done = one undo step, Cancel = exact rollback.

import { useState } from 'react';

import { isAudioClip } from '../../../stores/timeline/audioEdit/audioEditHelpers';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { resolvePhoneAudioTargets } from '../audio/phoneAudioLevels';
import { blurAfterPointer, PhoneUnavailableList, type PhoneUnavailableItem } from '../audio/PhoneAudioControls';
import { phoneAudioFxGroups, phoneAudioFxName, phoneAudioFxStartingPoint } from './phoneAudioFxCatalog';
import { usePhoneAudioFxCommands } from './phoneAudioFxCommands';
import { PhoneAudioFxStack } from './PhoneAudioFxStack';
import { PhoneAudioFxAi, PhoneAudioFxCleanup } from './PhoneAudioFxTools';
import { openPhoneEditor } from './phoneOpenEditor';
import { openPhonePropertiesPanel } from './phonePropertiesPanel';
import { PHONE_AUDIO_FX_TEST_IDS as IDS } from './phoneAudioFxTestIds';
import '../audio/PhoneAudioSheets.css';
import './PhoneAudioFx.css';

type Section = 'effects' | 'cleanup' | 'ai';

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'effects', label: 'Effects' },
  { id: 'cleanup', label: 'Clean up' },
  { id: 'ai', label: 'AI' },
];

const MORE: readonly PhoneUnavailableItem[] = [
  { id: 'spectral', label: 'Spectral editing', reason: 'Painting in the spectrogram needs the timeline\'s spectral view with a precise pointer; the phone has no spectral view. The full editor has it (tap the project name, then Full editor). Image layers painted there can be switched or removed here under Clean up, Repair.' },
];

function initialTarget() {
  const state = useTimelineStore.getState();
  const targets = resolvePhoneAudioTargets([...state.selectedClipIds], state.clips, state.tracks);
  const clipId = targets.clipIds[0] ?? null;
  const clip = clipId ? state.clips.find((candidate) => candidate.id === clipId) : undefined;
  const reason = clipId ? null
    : targets.locked.length > 0 ? 'The sound of this clip is on a locked track. Unlock the track first (Tracks).'
      : 'This clip has no sound. Select an audio clip or a video clip with sound.';
  const extra = targets.clipIds.length > 1 ? `Effects go to ${clip?.name ?? 'the first clip'}; select one clip at a time to change another.` : null;
  return { clipId, name: clip?.name ?? '', isAudioFile: clip ? isAudioClip(clip) : false, reason, extra };
}

export const PhoneAudioFxSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const openPanelSheet = usePhoneUiStore((state) => state.openPanelSheet);
  const [target] = useState(initialTarget);
  const commands = usePhoneAudioFxCommands(target.clipId);
  const [section, setSection] = useState<Section>('effects');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const stack = useTimelineStore((state) => (target.clipId ? state.clips.find((clip) => clip.id === target.clipId)?.audioState?.effectStack : undefined)) ?? [];
  const groups = phoneAudioFxGroups();
  const cards = groupId === 'all' ? groups.flatMap((group) => group.effects) : groups.find((group) => group.id === groupId)?.effects ?? [];

  const explainBlocked = () => {
    if (target.reason) showUnavailable({ actionId: 'audiofx-blocked', label: 'Audio effects', reason: target.reason });
  };

  const add = async (descriptorId: string) => {
    if (!target.clipId) { explainBlocked(); return; }
    const id = await commands.add(descriptorId);
    if (id) {
      setFocusedId(id);
      if (phoneAudioFxStartingPoint(descriptorId)) showToast(`${phoneAudioFxName(descriptorId)} added with a gentle starting point.`);
    } else {
      showToast(`${phoneAudioFxName(descriptorId)} could not be added.`, 'error');
    }
  };

  /** Keeps this sheet's changes (one undo step) and opens another surface in its place. */
  const leaveTo = async (open: () => void) => {
    if (busy) return;
    setBusy(true);
    await commands.whenIdle();
    if (commands.session.changed) {
      const result = await commands.commit();
      if (!result.ok) showToast(result.message, 'error');
    } else {
      commands.cancel();
    }
    open();
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    // A running silence removal finishes into this session first, so Done keeps it.
    await commands.whenIdle();
    if (!commands.session.changed) { commands.cancel(); closeSheet(); return; }
    const result = await commands.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    commands.cancel();
    closeSheet();
  };

  return (
    <PhoneSheet title="Audio effects" height="tall" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-audio-sheet phone-audiofx">
        <p className="phone-audio-sheet__target" data-testid={IDS.target}>
          {target.clipId ? `Sound of ${target.name}` : target.reason}
        </p>
        {target.extra ? <p className="phone-audio-sheet__hint">{target.extra}</p> : null}

        <div className="phone-audio-tabs" role="tablist" aria-label="Audio effect tools">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" className="phone-audio-tabs__tab" aria-selected={section === item.id}
              data-testid={`${IDS.sectionPrefix}${item.id}`} onPointerUp={blurAfterPointer} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {section === 'effects' ? (
          <div className="phone-audio-section" role="tabpanel" aria-label="Effects">
            {target.clipId ? (
              <PhoneAudioFxStack clipId={target.clipId} stack={stack} focusedId={focusedId} onFocus={setFocusedId} commands={commands} />
            ) : null}
            <button type="button" className="phone-audio-toggle" data-testid={IDS.allParameters} aria-disabled={!target.clipId || undefined}
              onPointerUp={blurAfterPointer}
              onClick={() => {
                if (!target.clipId) { explainBlocked(); return; }
                void leaveTo(() => openPhonePropertiesPanel({ clipId: target.clipId, tab: 'effects', title: 'Audio effects · all parameters' }));
              }}>
              All parameters…
            </button>
            <div className="phone-audiofx__chips" role="group" aria-label="Effect groups">
              {[{ id: 'all', label: 'All' }, ...groups].map((group) => (
                <button key={group.id} type="button" className="phone-audiofx__chip" aria-pressed={groupId === group.id}
                  data-testid={IDS.category} data-group={group.id} onPointerUp={blurAfterPointer} onClick={() => setGroupId(group.id)}>
                  {group.label}
                </button>
              ))}
            </div>
            <div className="phone-audiofx__grid">
              {cards.map((effect) => (
                <button key={effect.id} type="button" className="phone-audiofx__card" aria-disabled={!target.clipId || undefined}
                  data-testid={IDS.card} data-descriptor={effect.id} onPointerUp={blurAfterPointer} onClick={() => { void add(effect.id); }}>
                  {effect.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {section === 'cleanup' ? (
          target.clipId ? (
            <PhoneAudioFxCleanup
              commands={commands}
              isAudioFile={target.isAudioFile}
              onNormalized={(id) => setFocusedId(id)}
              onRepair={() => { void leaveTo(() => openPhonePropertiesPanel({ clipId: target.clipId, tab: 'audio-edits', title: 'Audio repair and edits' })); }}
            />
          ) : <p className="phone-audio-sheet__blocked" role="note">{target.reason}</p>
        ) : null}

        {section === 'ai' ? (
          <PhoneAudioFxAi clipId={target.clipId} onAiStudio={() => { void leaveTo(() => openPanelSheet('ai-studio', 'AI Studio')); }} />
        ) : null}

        <div className="phone-audio-more" role="group" aria-label="Editors">
          <span className="phone-audio-more__heading">Editors</span>
          <div className="phone-audio-more__items">
            <button type="button" className="phone-audio-more__item phone-audiofx__editor" data-testid={IDS.effectCurves}
              aria-disabled={!target.clipId || undefined} onPointerUp={blurAfterPointer}
              onClick={() => {
                if (!target.clipId) { explainBlocked(); return; }
                void leaveTo(() => { openPhoneEditor('curves', { clipId: target.clipId }); });
              }}>
              Effect curves
            </button>
            <button type="button" className="phone-audio-more__item phone-audiofx__editor" data-testid={IDS.trackEffects}
              onPointerUp={blurAfterPointer} onClick={() => { void leaveTo(() => { openPhoneEditor('mixer'); }); }}>
              Track and master effects
            </button>
          </div>
        </div>
        <PhoneUnavailableList items={MORE} testIdPrefix={IDS.unavailablePrefix} heading="Not on the phone" />
      </div>
    </PhoneSheet>
  );
};
