// 'compositions' sheet: every composition of the project, the open one marked. Tap a row to open it;
// "More" shows rename, duplicate, settings and delete (never the last one, always confirmed). New
// composition uses the home's format chips. With clips selected, "Nest" moves them into a new
// composition; composition clips on the timeline can be entered (the top bar then offers the way
// back). Settings also switch the 3D render engine; "Node graph" opens the landscape Nodes editor on
// the composition (opening it first). Every edit is ONE undo step through the editor's own store
// actions; opening a composition is navigation and stays out of the history. Close leaves the sheet;
// nothing is pending.

import { useMemo, useState } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import type { Composition } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneActionResult, PhoneSheetComponent } from '../contracts';
import { openPhoneEditor } from '../audiofx/phoneOpenEditor';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChoice, PhoneGreyedOption } from '../transition/phoneChoiceControls';
import { PhoneCompositionForm, type PhoneCompositionFormValues } from './PhoneCompositionForm';
import {
  applyPhoneCompositionSettings, createPhoneComposition, deletePhoneComposition, duplicatePhoneComposition,
  enterPhoneNestedComposition, nestPhoneSelection, nextPhoneCompositionName, openPhoneComposition, phoneFormatOf,
  phoneCompositionRenderEngine, phoneUserCompositions, planPhoneCompositionDelete, renamePhoneComposition,
  setPhoneCompositionRenderEngine,
} from './phoneCompositionCommands';
import { PHONE_COMPOSITIONS_TEST_IDS as IDS } from './phoneCompositionsTestIds';
import { ProButton, ProMessage, ProSection, ProTextField } from './phoneProControls';
import { blurAfterPointer } from './phoneProFocus';
import { ProGlyph } from './phoneProGlyphs';
import { phoneCompositionPosterUrl } from '../library/phoneLibraryModel';
import './PhoneCompositionsSheet.css';

/** Poster frame of a composition row at its own aspect (first picture clip), a glyph without one. */
function CompositionPoster({ url, width, height }: { url: string | undefined; width: number; height: number }) {
  const aspect = Math.min(16 / 9, Math.max(9 / 16, width / Math.max(1, height)));
  return (
    <span className="phone-compositions__poster" aria-hidden="true" style={{ aspectRatio: String(aspect) }}>
      {url ? <img src={url} alt="" draggable={false} /> : <ProGlyph name="variants" />}
    </span>
  );
}

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'rename'; id: string }
  | { kind: 'settings'; id: string }
  | { kind: 'delete'; id: string };

const BACKGROUND_REASON = 'Each composition stores a background colour, but the editor does not draw it yet, on the desktop either: empty areas stay black. Put a solid colour clip on the lowest video track instead.';

function metaOf(composition: Composition): string {
  return `${composition.width}×${composition.height} · ${composition.frameRate} fps · ${Math.round(composition.duration)} s`;
}

export const PhoneCompositionsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const allCompositions = useMediaStore((state) => state.compositions);
  const activeId = useMediaStore((state) => state.activeCompositionId);
  const mediaFiles = useMediaStore((state) => state.files);
  const clips = useTimelineStore((state) => state.clips);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const compositions = useMemo(() => phoneUserCompositions(allCompositions), [allCompositions]);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const selectedCount = clips.filter((clip) => selectedClipIds.has(clip.id)).length;
  const nested = useMemo(() => {
    const seen = new Set<string>();
    return clips.flatMap((clip) => {
      if (!clip.isComposition || !clip.compositionId || seen.has(clip.compositionId)) return [];
      seen.add(clip.compositionId);
      const composition = allCompositions.find((candidate) => candidate.id === clip.compositionId);
      return composition ? [composition] : [];
    });
  }, [allCompositions, clips]);

  const run = async (action: () => Promise<PhoneActionResult>, success?: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      setMessage(result.ok ? (success || result.message ? { text: result.message ?? success!, tone: 'info' } : null) : { text: result.message, tone: 'error' });
      if (result.ok) after?.();
    } finally {
      setBusy(false);
    }
  };

  const openNodeGraph = (id: string) => void run(() => openPhoneComposition(id), undefined, () => {
    openPhoneEditor('nodes', { clearSelection: true });
  });

  const byId = (id: string) => allCompositions.find((composition) => composition.id === id);
  const toList = () => setView({ kind: 'list' });

  if (view.kind === 'create') {
    const active = activeId ? byId(activeId) : undefined;
    const initial: PhoneCompositionFormValues = {
      name: nextPhoneCompositionName(compositions),
      format: (active && phoneFormatOf(active.width, active.height)) ?? '9:16',
      frameRate: active?.frameRate ?? 30,
      duration: 60,
    };
    return (
      <PhoneSheet title="New composition" height="tall" onCancel={closeSheet} cancelLabel="Close">
        <PhoneCompositionForm
          initial={initial}
          submitLabel="Create"
          showName
          busy={busy}
          onBack={toList}
          onSubmit={(values) => void run(
            () => createPhoneComposition({ ...values, format: values.format ?? '9:16' }),
            `Created and opened ${values.name.trim()}.`,
            toList,
          )}
        />
        <ProMessage text={message?.tone === 'error' ? message.text : null} tone="error" testId={IDS.message} />
      </PhoneSheet>
    );
  }

  if (view.kind === 'settings') {
    const composition = byId(view.id);
    if (!composition) { toList(); return null; }
    const format = phoneFormatOf(composition.width, composition.height);
    return (
      <PhoneSheet title={`${composition.name} settings`} height="tall" onCancel={closeSheet} cancelLabel="Close">
        <PhoneCompositionForm
          initial={{ name: composition.name, format, frameRate: composition.frameRate, duration: Math.round(composition.duration) }}
          otherSize={format ? null : { width: composition.width, height: composition.height }}
          submitLabel="Apply"
          showName={false}
          busy={busy}
          onBack={toList}
          onSubmit={(values) => void run(() => applyPhoneCompositionSettings(composition.id, values), 'Settings applied.', toList)}
        />
        <div className="phone-compositions__form">
          <ProSection title="3D render engine">
            <div className="phone-pro-chips" role="group" aria-label="3D render engine">
              <PhoneChoice label="Raster" selected={phoneCompositionRenderEngine(composition) === 'raster'} testId={`${IDS.renderEngine}-raster`}
                onSelect={() => void run(() => setPhoneCompositionRenderEngine(composition.id, 'raster'), 'The 3D scene renders with Raster.')} />
              <PhoneChoice label="Path traced" selected={phoneCompositionRenderEngine(composition) === 'path-traced'} testId={`${IDS.renderEngine}-path-traced`}
                onSelect={() => void run(() => setPhoneCompositionRenderEngine(composition.id, 'path-traced'), 'The 3D scene renders path traced: slower, with real light.')} />
            </div>
          </ProSection>
          <ProButton label="Node graph" testId={IDS.nodeGraph} onPress={() => openNodeGraph(composition.id)} />
          <ProMessage text={message?.text ?? null} tone={message?.tone ?? 'info'} testId={IDS.message} />
        </div>
        <PhoneGreyedOption label="Background colour" reason={BACKGROUND_REASON} testId={IDS.greyedAdvanced} />
      </PhoneSheet>
    );
  }

  if (view.kind === 'rename') {
    const composition = byId(view.id);
    if (!composition) { toList(); return null; }
    const submit = () => void run(() => renamePhoneComposition(composition.id, renameValue), undefined, toList);
    return (
      <PhoneSheet title="Rename composition" onCancel={closeSheet} cancelLabel="Close">
        <div className="phone-compositions__form">
          <ProTextField label="Name" value={renameValue} testId={IDS.nameInput} autoFocus onChange={setRenameValue} onSubmit={submit} />
          <div className="phone-compositions__form-actions">
            <ProButton label="Back" testId={IDS.formBack} onPress={toList} />
            <ProButton label="Rename" tone="primary" testId={IDS.formSubmit} unavailableReason={renameValue.trim() ? null : 'Give the composition a name first.'} onPress={submit} />
          </div>
          <ProMessage text={message?.tone === 'error' ? message.text : null} tone="error" testId={IDS.message} />
        </div>
      </PhoneSheet>
    );
  }

  if (view.kind === 'delete') {
    const composition = byId(view.id);
    const plan = planPhoneCompositionDelete(allCompositions, activeId, view.id);
    if (!composition || !plan.ok) { toList(); return null; }
    return (
      <PhoneSheet title="Delete composition" onCancel={closeSheet} cancelLabel="Close">
        <div className="phone-compositions__form">
          <p className="phone-compositions__confirm">
            Delete <strong>{composition.name}</strong> and its clips?
            {plan.switchTo ? ` It is open now; ${byId(plan.switchTo)?.name ?? 'another composition'} opens instead.` : ''}
            {plan.users.length > 0 ? ` It is used inside ${plan.users.join(', ')}; those clips lose their content.` : ''}
            {' '}Undo brings it back.
          </p>
          <div className="phone-compositions__form-actions">
            <ProButton label="Keep" testId={IDS.formBack} onPress={toList} />
            <ProButton
              label="Delete"
              tone="danger"
              testId={IDS.confirmDelete}
              onPress={() => void run(() => deletePhoneComposition(composition.id), `Deleted ${composition.name}.`, () => { setExpandedId(null); toList(); })}
            />
          </div>
        </div>
      </PhoneSheet>
    );
  }

  const nestReason = selectedCount === 0 ? 'Select clips on the timeline first: they move into a new composition that takes their place.' : null;
  return (
    <PhoneSheet title="Compositions" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-compositions">
        <div className="phone-compositions__top-actions">
          <ProButton label="New composition" tone="primary" testId={IDS.create} onPress={() => { setMessage(null); setView({ kind: 'create' }); }} />
          <ProButton
            label={selectedCount > 0 ? `Nest ${selectedCount} clip${selectedCount === 1 ? '' : 's'}` : 'Nest clips'}
            testId={IDS.nest}
            unavailableReason={nestReason}
            onPress={() => void run(nestPhoneSelection, 'Nested into a new composition. Undo restores the clips.')}
          />
        </div>
        <ProMessage text={message?.text ?? null} tone={message?.tone ?? 'info'} testId={IDS.message} />
        {nested.length > 0 ? (
          <ProSection title="Nested on this timeline">
            <div className="phone-pro-chips">
              {nested.map((composition) => (
                <ProButton
                  key={composition.id}
                  label={`Enter ${composition.name}`}
                  testId={IDS.nested}
                  data={{ 'composition-id': composition.id }}
                  onPress={() => void run(() => enterPhoneNestedComposition(composition.id), undefined, closeSheet)}
                />
              ))}
            </div>
          </ProSection>
        ) : null}
        <ProSection title={`All compositions (${compositions.length})`}>
          <ul className="phone-pro-list" data-testid={IDS.list}>
            {compositions.toReversed().map((composition) => {
              const active = composition.id === activeId;
              const expanded = expandedId === composition.id;
              const deletePlan = planPhoneCompositionDelete(allCompositions, activeId, composition.id);
              return (
                <li key={composition.id} className="phone-pro-row" data-testid={IDS.row} data-composition-id={composition.id} data-active={active ? 'true' : 'false'}>
                  <div className="phone-pro-row__main">
                    <CompositionPoster url={phoneCompositionPosterUrl(composition, mediaFiles)} width={composition.width} height={composition.height} />
                    <button
                      type="button"
                      className="phone-pro-row__title"
                      aria-current={active ? 'true' : undefined}
                      aria-label={active ? `${composition.name}, open now` : `Open ${composition.name}`}
                      data-testid={IDS.rowOpen}
                      onPointerUp={blurAfterPointer}
                      onClick={() => void run(() => openPhoneComposition(composition.id), undefined, active ? undefined : closeSheet)}
                    >
                      <span className="phone-pro-row__name">{composition.name}</span>
                      <span className="phone-pro-row__meta">{metaOf(composition)}</span>
                    </button>
                    {active ? <span className="phone-pro-row__badge">Open</span> : null}
                    <ProButton
                      compact
                      label="More"
                      ariaLabel={`More for ${composition.name}`}
                      pressed={expanded}
                      testId={IDS.rowMore}
                      onPress={() => setExpandedId(expanded ? null : composition.id)}
                    />
                  </div>
                  {expanded ? (
                    <div className="phone-pro-row__actions">
                      <ProButton compact label="Rename" testId={IDS.rename} onPress={() => { setMessage(null); setRenameValue(composition.name); setView({ kind: 'rename', id: composition.id }); }} />
                      <ProButton compact label="Duplicate" testId={IDS.duplicate} onPress={() => void run(() => duplicatePhoneComposition(composition.id), `Duplicated ${composition.name}.`)} />
                      <ProButton compact label="Settings" testId={IDS.settings} onPress={() => { setMessage(null); setView({ kind: 'settings', id: composition.id }); }} />
                      <ProButton
                        compact
                        label="Delete"
                        tone="danger"
                        testId={IDS.remove}
                        unavailableReason={deletePlan.ok ? null : deletePlan.reason}
                        onPress={() => setView({ kind: 'delete', id: composition.id })}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ProSection>
        {activeId ? (
          <ProButton label="Node graph of the open composition" testId={`${IDS.nodeGraph}-list`} onPress={() => openNodeGraph(activeId)} />
        ) : null}
        <PhoneGreyedOption label="Background colour" reason={BACKGROUND_REASON} testId={`${IDS.greyedAdvanced}-list`} />
      </div>
    </PhoneSheet>
  );
};
