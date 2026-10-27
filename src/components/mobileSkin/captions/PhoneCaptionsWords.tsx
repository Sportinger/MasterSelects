// Words section of the Captions sheet: every caption of the chosen caption clip as the viewer sees
// it (word groups on the timeline), tap a caption's time to jump there, tap a word to correct it
// (one word per timing slot, timing kept) or to cut it out of the video. Delete removes the whole
// caption clip.

import { useMemo, useState } from 'react';

import { createCaptionTimelineTranscript, type CaptionTimelineWordEvent } from '../../../services/captions/captionTimelineTranscript';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { blurAfterPointer } from '../audio/PhoneAudioControls';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { formatPhoneCaptionTime, groupPhoneCaptionEvents } from './phoneCaptionModel';
import type { PhoneCaptionCommands } from './phoneCaptionCommands';
import { PHONE_CAPTIONS_TEST_IDS as IDS } from './phoneCaptionsTestIds';

export function PhoneCaptionsWords({ captionClip, commands, onDeleted }: {
  captionClip: TimelineClip;
  commands: PhoneCaptionCommands;
  onDeleted: () => void;
}) {
  const showToast = usePhoneUiStore((state) => state.showToast);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const [editing, setEditing] = useState<CaptionTimelineWordEvent | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const caption = captionClip.captionProperties!;
  const groups = useMemo(() => groupPhoneCaptionEvents(
    createCaptionTimelineTranscript({ captionClip, clips, tracks }), caption.wordsPerCaption, caption.gapThreshold,
  ), [captionClip, clips, tracks, caption.wordsPerCaption, caption.gapThreshold]);

  const seek = (time: number) => useTimelineStore.getState().setPlayheadPosition(time);

  const open = (word: CaptionTimelineWordEvent) => {
    setEditing(word);
    setDraft(word.text);
    setError(null);
    seek(word.timelineStart + Math.min(0.02, (word.timelineEnd - word.timelineStart) / 2));
  };

  const save = () => {
    if (!editing) return;
    const result = commands.correctWord(editing, draft);
    if (!result.ok) { setError(result.message); return; }
    setEditing(null);
  };

  const cut = async () => {
    if (!editing) return;
    const word = editing;
    const result = await commands.cutWord(captionClip.id, word);
    if (!result.ok) { setError(result.message); return; }
    setEditing(null);
    showToast(`Cut "${word.text}" from the video.`);
  };

  const remove = async () => {
    const result = await commands.remove(captionClip.id);
    if (result.ok) onDeleted();
    else showToast(result.message, 'error');
  };

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Caption words">
      {groups.length === 0 ? (
        <p className="phone-audio-sheet__hint" data-testid={IDS.empty}>
          No spoken words fall inside this caption clip. Transcribe its source (Generate) or move the clip over speech.
        </p>
      ) : (
        <ol className="phone-captions__groups" aria-label="Captions">
          {groups.map((group) => (
            <li key={group.key} className="phone-captions__caption" data-testid={IDS.group} data-start={group.start.toFixed(3)} data-end={group.end.toFixed(3)}>
              <button type="button" className="phone-captions__time" data-testid={IDS.groupJump} aria-label={`Jump to ${formatPhoneCaptionTime(group.start)}`}
                onPointerUp={blurAfterPointer} onClick={() => seek(group.start)}>
                {formatPhoneCaptionTime(group.start)}
              </button>
              <span className="phone-captions__words">
                {group.words.map((word) => (
                  <button key={word.key} type="button" className="phone-captions__word" aria-pressed={editing?.key === word.key}
                    data-testid={IDS.word} data-word-id={word.wordId} data-source-clip-id={word.sourceClipId}
                    onPointerUp={blurAfterPointer} onClick={() => open(word)}>
                    {word.text}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <div className="phone-captions__editor" role="group" aria-label={`Edit "${editing.text}"`}>
          <span className="phone-audio-list__meta">
            {formatPhoneCaptionTime(editing.timelineStart)} to {formatPhoneCaptionTime(editing.timelineEnd)} · the timing stays
          </span>
          <input
            className="phone-captions__input"
            type="text"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Word"
            data-testid={IDS.wordInput}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
          />
          {error ? <p className="phone-audio-sheet__error" role="alert" data-testid={IDS.wordError}>{error}</p> : null}
          <div className="phone-captions__row">
            <button type="button" className="phone-audio-toggle" data-testid={IDS.wordSave} onPointerUp={blurAfterPointer} onClick={save}>Save word</button>
            <button type="button" className="phone-audio-toggle" data-testid={IDS.wordCut} onPointerUp={blurAfterPointer} onClick={() => { void cut(); }}>Cut word</button>
            <button type="button" className="phone-audio-toggle" data-testid={IDS.wordClose} onPointerUp={blurAfterPointer} onClick={() => setEditing(null)}>Close</button>
          </div>
          <p className="phone-audio-sheet__hint">Save changes the word everywhere this recording is used. Cut word removes it from the video and sound.</p>
        </div>
      ) : null}

      <button type="button" className="phone-audio-toggle phone-captions__danger" data-testid={IDS.deleteCaptions} onPointerUp={blurAfterPointer}
        onClick={() => { void remove(); }}>
        Delete these captions
      </button>
    </div>
  );
}
