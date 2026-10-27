// 'clipboard' sheet (Copy & paste): copy the selected clip's effects, colour grade and animation,
// pick any number of target clips and paste. Copying never changes the project. Pastes show live
// inside one owned edit session (phoneEditSession): Done keeps every paste of this visit as ONE
// undo step, Cancel takes them all back. Opened from the clip toolbar, or from Effects / Adjust,
// which focus the sheet on their group.

import { useEffect, useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChip, blurAfterPointer } from '../text/phoneControls';
import { PhoneClipPickList } from './PhoneClipPickList';
import {
  PHONE_ATTRIBUTE_GROUPS, PHONE_ATTRIBUTE_LABELS, copyPhoneAttributes, pastePhoneAttributes, phoneClipboardSource,
  phonePastableGroups, phonePasteCandidates, summarizePhoneAttributes, usePhoneClipboardStore,
  type PhoneAttributeGroup, type PhoneAttributeSummary,
} from './phoneClipboardCommands';
import { PHONE_CLIPBOARD_TEST_IDS as IDS } from './phoneClipboardTestIds';
import './PhoneClipboard.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function copyDetail(group: PhoneAttributeGroup, summary: PhoneAttributeSummary): string {
  if (group === 'effects') return `${plural(summary.effects, 'effect')}${summary.effectKeys ? `, ${plural(summary.effectKeys, 'key')}` : ''}`;
  if (group === 'colour') return summary.colourGraded ? `graded${summary.colourKeys ? `, ${plural(summary.colourKeys, 'key')}` : ''}` : 'default grade';
  return plural(summary.animationKeys, 'key');
}

function emptyReason(group: PhoneAttributeGroup, summary: PhoneAttributeSummary): string | undefined {
  if (group === 'effects' && summary.effects === 0) return 'This clip has no effects to copy. Add one in Effects first.';
  if (group === 'animation' && summary.animationKeys === 0) return 'This clip has no animation to copy. Move the playhead and tap the diamond to key it first.';
  return undefined;
}

export const PhoneClipboardSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Paste attributes');
  const copied = usePhoneClipboardStore((state) => state.copied);
  // The focus is read in the initializer (React may run it twice) and cleared once mounted.
  const [opened] = useState(() => ({ sourceId: phoneClipboardSource()?.id ?? null, focus: usePhoneClipboardStore.getState().focus }));
  useEffect(() => { usePhoneClipboardStore.getState().setFocus(null); }, []);
  const source = useTimelineStore((state) => (opened.sourceId ? state.clips.find((clip) => clip.id === opened.sourceId) ?? null : null));
  const sourceKeys = useTimelineStore((state) => (opened.sourceId ? state.clipKeyframes.get(opened.sourceId) : undefined));
  const clips = useTimelineStore((state) => state.clips);
  const clipboardEffects = useTimelineStore((state) => state.clipboardEffects);
  const clipboardColor = useTimelineStore((state) => state.clipboardColor);
  const clipboardKeyframes = useTimelineStore((state) => state.clipboardKeyframes);
  const summary = useMemo(() => (source ? summarizePhoneAttributes(source, sourceKeys ?? []) : null), [source, sourceKeys]);

  const [copyGroups, setCopyGroups] = useState<Set<PhoneAttributeGroup>>(() => {
    if (!summary) return new Set();
    const wanted = opened.focus ? [opened.focus] : PHONE_ATTRIBUTE_GROUPS;
    return new Set(wanted.filter((group) => !emptyReason(group, summary)));
  });
  // Recomputed with the editor clipboard so a copy made elsewhere drops the groups it replaced.
  const pastable = useMemo(() => phonePastableGroups(copied, { clipboardEffects, clipboardColor, clipboardKeyframes }),
    [copied, clipboardEffects, clipboardColor, clipboardKeyframes]);
  const [pasteGroups, setPasteGroups] = useState<Set<PhoneAttributeGroup> | null>(null);
  const activePaste = pasteGroups ?? new Set(opened.focus ? pastable.filter((group) => group === opened.focus) : pastable);
  const tracks = useTimelineStore((state) => state.tracks);
  const candidates = useMemo(() => phonePasteCandidates(copied?.trackType ?? null, { clips, tracks }),
    [copied, clips, tracks]);
  const [targets, setTargets] = useState<Set<string>>(() => {
    const state = useTimelineStore.getState();
    return new Set([...state.selectedClipIds].filter((id) => id !== usePhoneClipboardStore.getState().copied?.sourceClipId));
  });
  const [pastedMessage, setPastedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<PhoneAttributeGroup>, group: PhoneAttributeGroup) => {
    const next = new Set(set);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  };

  const copy = () => {
    if (!source) {
      showUnavailable({ actionId: IDS.copy, label: 'Copy', reason: 'Select the clip to copy from first, then open Copy & paste.' });
      return;
    }
    const result = copyPhoneAttributes(source.id, PHONE_ATTRIBUTE_GROUPS.filter((group) => copyGroups.has(group)));
    showToast(result.message, result.ok ? 'info' : 'error');
    if (result.ok) {
      setPasteGroups(null);
      setTargets((current) => new Set([...current].filter((id) => id !== source.id)));
    }
  };

  const validTargets = [...targets].filter((id) => candidates.some((entry) => entry.clip.id === id && entry.reason === null));
  const paste = () => {
    if (!copied || pastable.length === 0) {
      showUnavailable({ actionId: IDS.paste, label: 'Paste', reason: 'Nothing to paste yet: copy effects, colour or animation from a clip first.' });
      return;
    }
    if (validTargets.length === 0 || activePaste.size === 0) {
      showUnavailable({ actionId: IDS.paste, label: 'Paste', reason: activePaste.size === 0 ? 'Pick what to paste: effects, colour grade or animation.' : 'Pick at least one clip to paste onto.' });
      return;
    }
    const groups = PHONE_ATTRIBUTE_GROUPS.filter((group) => activePaste.has(group));
    let result: ReturnType<typeof pastePhoneAttributes> | null = null;
    void session.apply(() => { result = pastePhoneAttributes(validTargets, groups); }).then(() => {
      const outcome = result as ReturnType<typeof pastePhoneAttributes> | null;
      if (!outcome) { showToast('The paste did not run.', 'error'); return; }
      if (outcome.ok) setPastedMessage(`${outcome.message}. Done keeps it as one undo step; Cancel takes it back.`);
      else showToast(outcome.message, 'error');
    });
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };
  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const replaces = activePaste.has('effects') || activePaste.has('colour');
  const status = source
    ? `Copy from ${source.name}`
    : 'No clip selected: select a clip to copy from it. You can still paste what you copied before.';

  return (
    <PhoneSheet title="Copy & paste" height="tall" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-clipboard">
        <p className="phone-clipboard__status" data-testid={IDS.status}>{status}</p>

        {source && summary && (
          <section className="phone-clipboard__section" aria-label="Copy">
            <h3 className="phone-clipboard__title">Copy</h3>
            <div className="phone-clipboard__chips" role="group" aria-label="What to copy">
              {PHONE_ATTRIBUTE_GROUPS.map((group) => (
                <PhoneChip
                  key={group}
                  label={`${PHONE_ATTRIBUTE_LABELS[group]} · ${copyDetail(group, summary)}`}
                  selected={copyGroups.has(group)}
                  testId={`${IDS.copyGroup}-${group}`}
                  unavailableReason={emptyReason(group, summary)}
                  onSelect={() => setCopyGroups((current) => toggle(current, group))}
                />
              ))}
            </div>
            <button type="button" className="phone-clipboard__button" data-testid={IDS.copy}
              aria-disabled={copyGroups.size === 0 || undefined} onPointerUp={blurAfterPointer} onClick={copy}>
              Copy
            </button>
          </section>
        )}

        <section className="phone-clipboard__section" aria-label="Paste">
          <h3 className="phone-clipboard__title">Paste</h3>
          {!copied || pastable.length === 0 ? (
            <p className="phone-clipboard__note" data-testid={IDS.empty}>Nothing copied yet. Copy from a clip above, then pick the clips to paste onto.</p>
          ) : (
            <>
              <p className="phone-clipboard__note">Copied from {copied.sourceName}.</p>
              <div className="phone-clipboard__chips" role="group" aria-label="What to paste">
                {pastable.map((group) => (
                  <PhoneChip
                    key={group}
                    label={PHONE_ATTRIBUTE_LABELS[group]}
                    selected={activePaste.has(group)}
                    testId={`${IDS.pasteGroup}-${group}`}
                    onSelect={() => setPasteGroups(toggle(activePaste, group))}
                  />
                ))}
              </div>
              {replaces && (
                <p className="phone-clipboard__note" data-testid={IDS.replaceNote}>
                  Pasting replaces {[activePaste.has('effects') ? 'the effects' : '', activePaste.has('colour') ? 'the colour grade' : ''].filter(Boolean).join(' and ')} of every picked clip, with their animation.
                  {activePaste.has('animation') ? ' Animation keys land at the same times as on the copied clip.' : ''}
                </p>
              )}
              <PhoneClipPickList
                label={`Paste onto (${validTargets.length} of ${candidates.filter((entry) => entry.reason === null).length})`}
                entries={candidates.map((entry) => ({ ...entry, detail: entry.clip.id === copied.sourceClipId ? 'copied from' : undefined }))}
                picked={targets}
                onChange={setTargets}
              />
              <button type="button" className="phone-clipboard__button" data-testid={IDS.paste}
                aria-disabled={validTargets.length === 0 || activePaste.size === 0 || undefined}
                onPointerUp={blurAfterPointer} onClick={paste}>
                Paste onto {plural(validTargets.length, 'clip')}
              </button>
            </>
          )}
          {pastedMessage && <p className="phone-clipboard__note" role="status" data-testid={IDS.pasted}>{pastedMessage}</p>}
        </section>
      </div>
    </PhoneSheet>
  );
};
