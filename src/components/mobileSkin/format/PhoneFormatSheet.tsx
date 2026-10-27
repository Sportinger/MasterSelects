// 'format' sheet (nothing selected): the active composition's canvas. A preset (9:16, 16:9, 1:1,
// 4:5, 4:3, 21:9 at 1080 px on the short side) resizes the composition through the media store's
// updateComposition, live inside one owned transaction: Done is one undo step, Cancel restores the
// exact size and layout. Each tap restores the session-start snapshot and resizes from there once
// (phoneFormatSnapshot.ts), so stepping between presets never drifts. "Keep layout" (default)
// keeps every clip's share of the frame, so a fitted clip still fits; "Keep pixel size" is the
// desktop composition settings' behaviour. Clips, times and tracks never change. A background for empty areas is greyed out: the editor does not render
// a composition background yet.

import { useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneRatioGlyph } from '../crop/phoneChoiceGlyphs';
import { PhoneChipGroup, PhoneSheetNote, type PhoneUnavailable } from '../crop/phoneDesignControls';
import {
  PHONE_FORMAT_PRESETS, phoneAspectLabel, phoneFormatPresetFor, type PhoneFormatLayout, type PhoneFormatPresetId,
} from './phoneFormatPresets';
import { applyPhoneFormat, capturePhoneFormatSnapshot } from './phoneFormatSnapshot';
import { PHONE_FORMAT_TEST_IDS as IDS } from './phoneFormatTestIds';

const BACKGROUND_REASON = 'The editor does not draw a composition background yet, on the phone or in exports, so empty areas stay black. '
  + 'Use Fill in Crop & transform to cover the frame meanwhile.';

interface Size { width: number; height: number }

export const PhoneFormatSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Format');
  // What the canvas and clips looked like when the sheet opened: every tap resizes from here.
  const [start] = useState(capturePhoneFormatSnapshot);
  const [target, setTarget] = useState<Size | null>(start?.size ?? null);
  const [layout, setLayout] = useState<PhoneFormatLayout>('relative');
  const [busy, setBusy] = useState(false);

  const blocked: PhoneUnavailable | undefined = start ? undefined : { reason: 'No composition is open.' };

  // Restore the session-start snapshot, then one resize to the new size: every write is absolute,
  // so stepping between presets or layouts never accumulates.
  const resize = (size: Size, nextLayout: PhoneFormatLayout) => () => {
    if (start) applyPhoneFormat(start, size, nextLayout);
  };

  const change = (size: Size, nextLayout: PhoneFormatLayout) => {
    if (blocked || busy) return;
    setTarget(size);
    setLayout(nextLayout);
    void session.apply(resize(size, nextLayout));
  };

  const pickPreset = (id: PhoneFormatPresetId) => {
    const preset = PHONE_FORMAT_PRESETS.find((entry) => entry.id === id);
    if (preset) change({ width: preset.width, height: preset.height }, layout);
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = session.changed && target ? await session.commit(resize(target, layout)) : await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const preset = target ? phoneFormatPresetFor(target.width, target.height) : null;
  const custom = start && !phoneFormatPresetFor(start.size.width, start.size.height);

  return (
    <PhoneSheet title="Format" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy || !start}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <PhoneSheetNote testId={IDS.size} tone={blocked ? 'warn' : 'info'}>
          {blocked ? blocked.reason : target ? `Canvas ${target.width} × ${target.height} (${phoneAspectLabel(target.width, target.height)})` : ''}
          {custom ? ` · started as ${start.size.width} × ${start.size.height}` : ''}
        </PhoneSheetNote>
        <PhoneChipGroup<PhoneFormatPresetId> label="Canvas format" value={preset} testId={IDS.presets} disabled={blocked}
          options={PHONE_FORMAT_PRESETS.map(({ id, label, width, height }) => ({ value: id, label, icon: <PhoneRatioGlyph ratio={width / height} /> }))}
          onChange={pickPreset} layout="tile-row" />
        <section className="phone-design-section">
          <h3 className="phone-design-section__title">Clips</h3>
          <PhoneChipGroup<PhoneFormatLayout> label="How clips follow the new format" value={layout} testId={IDS.layout} disabled={blocked}
            options={[{ value: 'relative', label: 'Keep layout' }, { value: 'pixels', label: 'Keep pixel size' }]}
            onChange={(next) => { if (target) change(target, next); }} />
          <PhoneSheetNote>
            {layout === 'relative'
              ? 'Every clip keeps its share of the frame: a clip that filled the width still does.'
              : 'Every clip keeps its size in pixels; it may overflow or leave empty areas.'}
          </PhoneSheetNote>
        </section>
        <section className="phone-design-section">
          <h3 className="phone-design-section__title">Background</h3>
          <PhoneChipGroup<'black' | 'colour' | 'blur' | 'image'> label="Background for empty areas" value="black" testId={IDS.background}
            options={[
              { value: 'black', label: 'Black' },
              { value: 'colour', label: 'Colour', unavailable: { reason: BACKGROUND_REASON } },
              { value: 'blur', label: 'Blur', unavailable: { reason: BACKGROUND_REASON } },
              { value: 'image', label: 'Image', unavailable: { reason: BACKGROUND_REASON } },
            ]}
            onChange={() => {}} />
        </section>
        <PhoneSheetNote>Custom sizes, frame rate and duration are in the composition settings of the full editor.</PhoneSheetNote>
      </div>
    </PhoneSheet>
  );
};
