// 'captions' sheet (root scope): speech to text and dynamic captions on the phone, on the editor's own
// caption clips (a Text clip with transcript-bound caption settings, identical to the desktop).
// Generate: provider and account state, transcribe each speech clip, add captions for one clip or
// the whole timeline. Words: every caption, correct or cut a word, delete the captions. Style:
// presets and the main look. Timing: grouping, hold, lines and source. Timeline edits stay in ONE
// phone edit session: Done = one undo step, Cancel = exact rollback (word corrections included).

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer, PhoneUnavailableList, type PhoneUnavailableItem } from '../audio/PhoneAudioControls';
import { openPhonePropertiesPanel } from '../audiofx/phonePropertiesPanel';
import { formatPhoneCaptionTime, listPhoneCaptionClips } from './phoneCaptionModel';
import { usePhoneCaptionCommands } from './phoneCaptionCommands';
import type { PhoneCaptionUpdate } from './phoneCaptionStyles';
import { PhoneCaptionsGenerate } from './PhoneCaptionsGenerate';
import { PhoneCaptionsWords } from './PhoneCaptionsWords';
import { PhoneCaptionsStyle, PhoneCaptionsTiming } from './PhoneCaptionsStyle';
import { PHONE_CAPTIONS_TEST_IDS as IDS } from './phoneCaptionsTestIds';
import '../audio/PhoneAudioSheets.css';
import './PhoneCaptions.css';

type Section = 'generate' | 'words' | 'style' | 'timing';

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'words', label: 'Words' },
  { id: 'style', label: 'Style' },
  { id: 'timing', label: 'Timing' },
];

const MORE: readonly PhoneUnavailableItem[] = [
  { id: 'word-timing', label: 'Move a word in time', reason: 'Word times come from the speech recognition (and its word alignment) and stay when you correct a word. The editor has no control to shift a single word, on the desktop either; re-run the transcription to retime the words.' },
  { id: 'preview-edit', label: 'Edit a word in the picture', reason: 'Double-clicking a caption word in the picture is a feature of the desktop preview; the phone preview has no word editor. Tap the word under Words instead: it changes the same word. The full editor has it (tap the project name, then Full editor).' },
  { id: 'subtitle-file', label: 'Subtitle file (SRT)', reason: 'The editor does not export subtitle files yet; captions are burned into the video on export.' },
];

function initialCaptionClipId(): string | null {
  const state = useTimelineStore.getState();
  const selected = [...state.selectedClipIds].find((id) => state.clips.find((clip) => clip.id === id)?.captionProperties);
  return selected ?? listPhoneCaptionClips(state.clips)[0]?.id ?? null;
}

export const PhoneCaptionsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const commands = usePhoneCaptionCommands();
  const [captionClipId, setCaptionClipId] = useState<string | null>(initialCaptionClipId);
  const [section, setSection] = useState<Section>(() => (captionClipId ? 'words' : 'generate'));
  const [busy, setBusy] = useState(false);
  const clips = useTimelineStore((state) => state.clips);
  const captionClips = listPhoneCaptionClips(clips);
  const captionClip = captionClips.find((clip) => clip.id === captionClipId) ?? null;
  const changed = () => commands.session.changed || commands.corrected;

  const selectSection = (next: Section) => {
    if (next !== 'generate' && !captionClip) {
      showUnavailable({ actionId: `captions-${next}`, label: SECTIONS.find((item) => item.id === next)?.label ?? next, reason: 'There are no captions on this timeline yet. Add them under Generate first.' });
      return;
    }
    setSection(next);
  };

  const create = async (input: { sourceClipId: string | null; startTime?: number; duration?: number }) => {
    const result = await commands.create(input);
    if (!result.ok) { showToast(result.message, 'error'); return; }
    if (result.clipId) setCaptionClipId(result.clipId);
    setSection('words');
  };

  const apply = (update: PhoneCaptionUpdate) => {
    if (!captionClip) return;
    void commands.update(captionClip.id, update).then((result) => {
      if (!result.ok) showToast(result.message, 'error');
    });
  };

  const leaveTo = async (open: () => void) => {
    if (busy) return;
    setBusy(true);
    if (changed()) {
      const result = await commands.commit();
      if (!result.ok) showToast(result.message, 'error');
    } else {
      commands.cancel();
    }
    open();
  };

  const done = async () => {
    if (busy) return;
    if (!changed()) { commands.cancel(); closeSheet(); return; }
    setBusy(true);
    const result = await commands.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    commands.cancel();
    closeSheet();
  };

  const status = captionClip
    ? `Captions ${formatPhoneCaptionTime(captionClip.startTime)} to ${formatPhoneCaptionTime(captionClip.startTime + captionClip.duration)}`
    : 'No captions on this timeline yet.';

  return (
    <PhoneSheet title="Captions" height="tall" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-audio-sheet phone-captions">
        <p className="phone-audio-sheet__target" data-testid={IDS.status} data-caption-clip-id={captionClip?.id ?? ''}>{status}</p>
        {captionClips.length > 1 ? (
          <div className="phone-captions__chips" role="radiogroup" aria-label="Caption clips">
            {captionClips.map((clip, index) => (
              <button key={clip.id} type="button" role="radio" className="phone-captions__chip" aria-checked={clip.id === captionClip?.id}
                aria-pressed={clip.id === captionClip?.id} data-testid={IDS.captionChip} data-clip-id={clip.id}
                onPointerUp={blurAfterPointer} onClick={() => setCaptionClipId(clip.id)}>
                {`${index + 1} · ${formatPhoneCaptionTime(clip.startTime)}`}
              </button>
            ))}
          </div>
        ) : null}

        <div className="phone-audio-tabs" role="tablist" aria-label="Caption tools">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" className="phone-audio-tabs__tab" aria-selected={section === item.id}
              aria-disabled={(item.id !== 'generate' && !captionClip) || undefined} data-testid={`${IDS.sectionPrefix}${item.id}`}
              onPointerUp={blurAfterPointer} onClick={() => selectSection(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {section === 'generate' || !captionClip ? (
          <PhoneCaptionsGenerate onCreate={create} onSettings={() => { void leaveTo(() => openSheet('settings')); }} />
        ) : null}
        {section === 'words' && captionClip ? (
          <PhoneCaptionsWords captionClip={captionClip} commands={commands} onDeleted={() => { setCaptionClipId(null); setSection('generate'); }} />
        ) : null}
        {section === 'style' && captionClip ? (
          <PhoneCaptionsStyle clip={captionClip} apply={apply}
            onAllStyle={() => { void leaveTo(() => openPhonePropertiesPanel({ clipId: captionClip.id, tab: 'captions', title: 'Captions · all settings' })); }} />
        ) : null}
        {section === 'timing' && captionClip ? <PhoneCaptionsTiming clip={captionClip} apply={apply} /> : null}

        <PhoneUnavailableList items={MORE} testIdPrefix={IDS.unavailablePrefix} heading="Not on the phone yet" />
      </div>
    </PhoneSheet>
  );
};
