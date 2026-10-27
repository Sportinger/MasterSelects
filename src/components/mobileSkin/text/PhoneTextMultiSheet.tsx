// 'textMulti' sheet (Style titles): pick several titles of the composition and style them together.
// Size changes every picked title by the same step (each keeps its own size); colour, bold, italic,
// alignment, outline and shadow become shared values. Every change shows live inside one owned edit
// session: Done keeps it as ONE undo step, Cancel puts every title back. Titles on locked tracks
// stay listed, greyed with the reason (phoneTextMulti.ts).

import { useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneClipPickList } from '../clipboard/PhoneClipPickList';
import '../clipboard/PhoneClipboard.css';
import { PhoneEmptyState } from '../transition/phoneSheetPrimitives';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChip, PhoneColorRow, PhoneSwitchRow, blurAfterPointer } from './phoneControls';
import {
  EMPTY_PHONE_TEXT_MULTI_DRAFT, applyPhoneTextMulti, capturePhoneTextOriginal, commonPhoneTextValue, listPhoneTextCandidates,
  type PhoneTextMultiDraft, type PhoneTextOriginal,
} from './phoneTextMulti';
import { PHONE_TEXT_MULTI_TEST_IDS as IDS } from './phoneTextMultiTestIds';
import type { EditableTextClip } from '../../panels/properties/textSelectionEditing';

const SIZE_STEP = 4;
const ALIGNS = [
  { id: 'left', label: 'Left' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right' },
] as const;

export const PhoneTextMultiSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Style titles');
  const [opened] = useState(() => {
    const state = useTimelineStore.getState();
    const candidates = listPhoneTextCandidates(state);
    const originals = new Map<string, PhoneTextOriginal>();
    for (const entry of candidates) {
      if (entry.reason === null) originals.set(entry.clip.id, capturePhoneTextOriginal(state, entry.clip as EditableTextClip));
    }
    const selected = candidates.filter((entry) => entry.reason === null && state.selectedClipIds.has(entry.clip.id)).map((entry) => entry.clip.id);
    return { candidates, originals, selected };
  });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(opened.selected));
  const [draft, setDraft] = useState<PhoneTextMultiDraft>(EMPTY_PHONE_TEXT_MULTI_DRAFT);
  const [nodeDriven, setNodeDriven] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Re-render when the titles change so the list shows renamed or removed titles.
  const clips = useTimelineStore((state) => state.clips);
  const entries = useMemo(
    () => opened.candidates.filter((entry) => clips.some((clip) => clip.id === entry.clip.id)),
    [clips, opened.candidates],
  );

  const write = (nextPicked: Set<string>, nextDraft: PhoneTextMultiDraft) => {
    let report: ReturnType<typeof applyPhoneTextMulti> | null = null;
    void session.apply(() => { report = applyPhoneTextMulti(opened.originals, nextPicked, nextDraft); }).then(() => {
      const outcome = report as ReturnType<typeof applyPhoneTextMulti> | null;
      setNodeDriven(outcome?.nodeDrivenSize ?? []);
    });
  };

  const changeDraft = (patch: Partial<PhoneTextMultiDraft>) => {
    if (picked.size === 0) {
      usePhoneUiStore.getState().showUnavailable({ actionId: 'text-multi-style', label: 'Style titles', reason: 'Pick the titles to style first: tap them in the list below.' });
      return;
    }
    const next = { ...draft, ...patch };
    setDraft(next);
    write(picked, next);
  };

  const changePicked = (next: Set<string>) => {
    setPicked(next);
    if (session.changed) write(next, draft);
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await session.commit(session.changed ? () => { applyPhoneTextMulti(opened.originals, picked, draft); } : undefined);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };
  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  if (opened.candidates.length === 0) {
    return (
      <PhoneSheet title="Style titles" onCancel={cancel} cancelLabel="Close">
        <PhoneEmptyState icon="text" testId={IDS.empty} title="No titles yet"
          body="Add a title, then style several together here."
          actionLabel="Add title" onAction={() => { session.cancel(); usePhoneUiStore.getState().openSheet('title'); }} />
      </PhoneSheet>
    );
  }

  const shownColor = draft.color ?? commonPhoneTextValue(opened.originals, picked, 'color') ?? '#ffffff';
  const shownBold = draft.bold ?? (commonPhoneTextValue(opened.originals, picked, 'fontWeight') ?? 400) >= 600;
  const shownItalic = draft.italic ?? commonPhoneTextValue(opened.originals, picked, 'fontStyle') === 'italic';
  const shownAlign = draft.textAlign ?? commonPhoneTextValue(opened.originals, picked, 'textAlign');
  const shownStroke = draft.strokeEnabled ?? commonPhoneTextValue(opened.originals, picked, 'strokeEnabled') === true;
  const shownShadow = draft.shadowEnabled ?? commonPhoneTextValue(opened.originals, picked, 'shadowEnabled') === true;
  const delta = draft.sizeDelta;

  return (
    <PhoneSheet title="Style titles" height="tall" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-clipboard">
        <p className="phone-clipboard__status" data-testid={IDS.status} role="status">
          {picked.size === 0 ? 'Pick the titles to style together.' : `${picked.size} title${picked.size === 1 ? '' : 's'} picked. Sizes change by the same step; each title keeps its own size.`}
        </p>
        <div className="phone-text-multi__row" role="group" aria-label="Size">
          <span className="phone-clipboard__title">Size</span>
          <button type="button" className="phone-design-chip" aria-label="Smaller" data-testid={IDS.sizeDown}
            onPointerUp={blurAfterPointer} onClick={() => changeDraft({ sizeDelta: delta - SIZE_STEP })}>−</button>
          <span className="phone-text-multi__value" data-testid={IDS.sizeDelta}>{delta > 0 ? `+${delta}` : delta} px</span>
          <button type="button" className="phone-design-chip" aria-label="Larger" data-testid={IDS.sizeUp}
            onPointerUp={blurAfterPointer} onClick={() => changeDraft({ sizeDelta: delta + SIZE_STEP })}>+</button>
        </div>
        {nodeDriven.length > 0 && (
          <p className="phone-clipboard__note" role="status">A node drives the size of {nodeDriven.join(', ')}: that size stays; the other values apply.</p>
        )}
        <div className="phone-clipboard__chips" role="group" aria-label="Font style">
          <PhoneChip label="Bold" selected={shownBold} testId={IDS.bold} onSelect={() => changeDraft({ bold: !shownBold })} />
          <PhoneChip label="Italic" selected={shownItalic} testId={IDS.italic} onSelect={() => changeDraft({ italic: !shownItalic })} />
          {ALIGNS.map((align) => (
            <PhoneChip key={align.id} label={align.label} selected={shownAlign === align.id} testId={`${IDS.align}-${align.id}`}
              onSelect={() => changeDraft({ textAlign: align.id })} />
          ))}
        </div>
        <PhoneColorRow label="Colour" value={shownColor} testId={IDS.color} onChange={(hex) => changeDraft({ color: hex })} />
        <PhoneSwitchRow label="Outline" checked={shownStroke} testId={IDS.stroke} onChange={(on) => changeDraft({ strokeEnabled: on })} />
        <PhoneSwitchRow label="Shadow" checked={shownShadow} testId={IDS.shadow} onChange={(on) => changeDraft({ shadowEnabled: on })} />
        <PhoneClipPickList label={`Titles (${picked.size} of ${opened.originals.size})`} entries={entries} picked={picked} onChange={changePicked} />
      </div>
    </PhoneSheet>
  );
};
