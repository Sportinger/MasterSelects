// 'mask' sheet: one shape mask on the selected clip (Linear, Mirror, Circle, Rectangle, Star,
// Heart, or none), with position, size, rotation, soft edge and invert. It writes an ordinary
// editor mask through the timeline store (the desktop mask panel shows and edits the same mask).
// Changes show live inside one owned transaction: Done is one undo step, Cancel restores the
// clip exactly. Pen paths, edited paths and animated masks stay untouched and say so.

import { useMemo, useRef, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  PhoneChipGroup, PhoneSheetNote, PhoneSliderRow, PhoneToggleChip, type PhoneChipOption, type PhoneUnavailable,
} from '../crop/phoneDesignControls';
import { resolvePhoneClipTarget } from '../crop/phoneClipTarget';
import { readPhoneMaskInventory, writePhoneMaskDraft, type PhoneMaskDraft } from './phoneMaskCommands';
import {
  defaultPhoneMaskParams, PHONE_MASK_SHAPE_PARAMS, PHONE_MASK_SHAPES, type PhoneMaskParams, type PhoneMaskShape,
} from './phoneMaskGeometry';
import { PHONE_MASK_TEST_IDS as IDS } from './phoneMaskTestIds';

type ShapeChoice = PhoneMaskShape | 'none' | 'pen';

const PEN_REASON = 'Drawing a free path needs the pen tool of the full editor. A path drawn there stays on the clip unchanged.';
const NO_SHAPE: PhoneUnavailable = { reason: 'Pick a shape first.' };

export const PhoneMaskSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Mask');
  // The target and the starting mask are read once per sheet: the sheet edits that state.
  const [start] = useState(() => {
    const target = resolvePhoneClipTarget();
    if (!target.ok) return { target, inventory: null, aspect: 1 };
    const aspect = target.comp.width / target.comp.height;
    return { target, inventory: readPhoneMaskInventory(target.clip, aspect), aspect };
  });
  const { target, inventory, aspect } = start;
  const maskRef = useRef<{ maskId: string | null }>({ maskId: inventory?.editable?.mask.id ?? null });
  const [shape, setShape] = useState<PhoneMaskShape | 'none'>(inventory?.editable?.shape ?? 'none');
  const [params, setParams] = useState<PhoneMaskParams>(inventory?.editable?.params ?? defaultPhoneMaskParams('circle', aspect));
  const [busy, setBusy] = useState(false);

  const blocked: PhoneUnavailable | undefined = !target.ok
    ? { reason: target.reason }
    : inventory?.animated
      ? { reason: 'This clip’s mask is animated with keyframes. Edit it in the full editor, or remove its keyframes there first.' }
      : undefined;

  const draftOf = (nextShape: PhoneMaskShape | 'none', nextParams: PhoneMaskParams): PhoneMaskDraft =>
    nextShape === 'none' ? { shape: 'none' } : { shape: nextShape, params: nextParams };

  const write = (draft: PhoneMaskDraft) => () => {
    if (target.ok) writePhoneMaskDraft(target.clip.id, maskRef.current, draft, aspect);
  };

  const change = (nextShape: PhoneMaskShape | 'none', nextParams: PhoneMaskParams) => {
    if (blocked || busy) return;
    setShape(nextShape);
    setParams(nextParams);
    void session.apply(write(draftOf(nextShape, nextParams)));
  };

  const pickShape = (choice: ShapeChoice) => {
    if (choice === 'pen') return;
    if (choice === 'none' || choice === shape) {
      change(choice === shape ? shape : 'none', params);
      return;
    }
    // A new shape starts from its own size but keeps where it sits, its angle, edge and invert.
    const defaults = defaultPhoneMaskParams(choice, aspect);
    change(choice, { ...defaults, centerX: params.centerX, centerY: params.centerY, rotation: params.rotation, feather: params.feather, inverted: params.inverted });
  };

  const set = (patch: Partial<PhoneMaskParams>) => change(shape, { ...params, ...patch });

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = session.changed ? await session.commit(write(draftOf(shape, params))) : await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const shapeOptions = useMemo<PhoneChipOption<ShapeChoice>[]>(() => [
    { value: 'none', label: 'None' },
    ...PHONE_MASK_SHAPES.map(({ value, label }) => ({ value, label })),
    { value: 'pen', label: 'Pen', unavailable: { reason: PEN_REASON } },
  ], []);

  const uses = shape === 'none' ? null : PHONE_MASK_SHAPE_PARAMS[shape];
  const paramBlock = (needed: boolean | undefined, what: string): PhoneUnavailable | undefined => {
    if (blocked) return blocked;
    if (!uses) return NO_SHAPE;
    return needed ? undefined : { reason: `${PHONE_MASK_SHAPES.find((entry) => entry.value === shape)?.label} has no ${what}.` };
  };
  const shapeBlock = paramBlock(true, '');
  const heightLabel = shape === 'mirror' ? 'Thickness' : 'Height';

  return (
    <PhoneSheet title="Mask" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy || Boolean(blocked && !target.ok)}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <PhoneSheetNote testId={IDS.status} tone={blocked ? 'warn' : 'info'}>
          {blocked
            ? blocked.reason
            : `Mask on ${target.ok ? target.clip.name : ''}${target.ok && target.otherSelected > 0 ? ` (the ${target.otherSelected} other selected clip${target.otherSelected === 1 ? '' : 's'} stay unchanged)` : ''}.`}
        </PhoneSheetNote>
        {inventory && inventory.custom.length > 0 && !blocked ? (
          <PhoneSheetNote tone="warn">
            {inventory.custom.length === 1 ? 'One mask from the full editor stays' : `${inventory.custom.length} masks from the full editor stay`} as {inventory.custom.length === 1 ? 'it is' : 'they are'}
            {inventory.editable ? '.' : '; a shape you pick here is added on top.'}
          </PhoneSheetNote>
        ) : null}
        <PhoneChipGroup<ShapeChoice> label="Mask shape" value={shape} options={shapeOptions} testId={IDS.shapes} onChange={pickShape} disabled={blocked} />
        <div className="phone-design-row">
          <PhoneToggleChip label="Invert" pressed={params.inverted} testId={IDS.invert} unavailable={shapeBlock} onToggle={(inverted) => set({ inverted })} />
        </div>
        <PhoneSliderRow label="Position X" testId={IDS.centerX} unit="%" min={-50} max={50} value={(params.centerX - 0.5) * 100}
          resetValue={0} unavailable={shapeBlock} onChange={(value) => set({ centerX: 0.5 + value / 100 })} />
        <PhoneSliderRow label="Position Y" testId={IDS.centerY} unit="%" min={-50} max={50} value={(params.centerY - 0.5) * 100}
          resetValue={0} unavailable={shapeBlock} onChange={(value) => set({ centerY: 0.5 + value / 100 })} />
        <PhoneSliderRow label="Width" testId={IDS.width} unit="%" min={5} max={150} value={params.width * 100}
          unavailable={paramBlock(uses?.width, 'width; it is a straight edge across the picture')} onChange={(value) => set({ width: value / 100 })} />
        <PhoneSliderRow label={heightLabel} testId={IDS.height} unit="%" min={shape === 'mirror' ? 2 : 5} max={shape === 'mirror' ? 100 : 150} value={params.height * 100}
          unavailable={paramBlock(uses?.height, shape === 'star' || shape === 'heart' ? 'separate height; Width sizes it' : 'height; it is a straight edge across the picture')}
          onChange={(value) => set({ height: value / 100 })} />
        <PhoneSliderRow label="Rotation" testId={IDS.rotation} unit="°" min={-180} max={180} value={params.rotation}
          resetValue={0} unavailable={shapeBlock} onChange={(value) => set({ rotation: value })} />
        <PhoneSliderRow label="Soft edge" testId={IDS.feather} unit=" px" min={0} max={200} value={params.feather}
          resetValue={0} unavailable={shapeBlock} onChange={(value) => set({ feather: value })} />
        <PhoneSheetNote>Dragging the mask on the preview, extra masks and mask animation are in the full editor.</PhoneSheetNote>
      </div>
    </PhoneSheet>
  );
};
