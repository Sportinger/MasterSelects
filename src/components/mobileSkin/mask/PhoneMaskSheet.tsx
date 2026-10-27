// 'mask' sheet: one mask on the selected clip: a shape (Linear, Mirror, Circle, Rectangle, Star,
// Heart) with position, size, rotation, soft edge and invert, or a free Pen path drawn by touch on the
// preview (PhoneMaskPenOverlay). Both are ordinary editor masks written through the timeline store
// (the desktop mask panel shows and edits the same data). Changes show live inside one owned
// transaction: Done is one undo step, Cancel restores the clip exactly. Animated masks and paths the
// phone could not keep exactly stay untouched and say so.

import { useEffect, useMemo, useRef, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  PhoneActionButton, PhoneChipGroup, PhoneSheetNote, PhoneSliderRow, PhoneToggleChip, type PhoneChipOption, type PhoneUnavailable,
} from '../crop/phoneDesignControls';
import { PhoneShapeGlyph } from '../crop/phoneChoiceGlyphs';
import { resolvePhoneClipTarget } from '../crop/phoneClipTarget';
import { readPhoneMaskInventory, writePhoneMaskDraft, writePhonePenDraft, type PhoneMaskDraft } from './phoneMaskCommands';
import {
  defaultPhoneMaskParams, PHONE_MASK_SHAPE_PARAMS, PHONE_MASK_SHAPES, type PhoneMaskParams, type PhoneMaskShape,
} from './phoneMaskGeometry';
import {
  canClosePhonePenPath, closePhonePenPath, describePhonePenPath, EMPTY_PHONE_PEN_PATH, PHONE_PEN_MIN_POINTS, undoPhonePenPoint,
  type PhonePenPath,
} from './phonePenModel';
import { usePhonePenStore } from './phonePenStore';
import { PHONE_PEN_CONSTRAINT_OPTIONS, PHONE_POINT_SHAPES, phoneShapeToPenPath } from './phoneMaskConstraints';
import { PHONE_MASK_TEST_IDS as IDS } from './phoneMaskTestIds';

type ShapeChoice = PhoneMaskShape | 'none' | 'pen';

const NO_SHAPE: PhoneUnavailable = { reason: 'Pick a shape first.' };
const PEN_PLACED: PhoneUnavailable = { reason: 'A pen path sits where you drew it: drag its points on the preview to move or reshape it.' };

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
  const penRef = useRef<{ maskId: string | null }>({ maskId: inventory?.pen?.mask.id ?? null });
  const [shape, setShape] = useState<ShapeChoice>(inventory?.editable?.shape ?? (inventory?.pen ? 'pen' : 'none'));
  const [params, setParams] = useState<PhoneMaskParams>(() => {
    if (inventory?.editable) return inventory.editable.params;
    const base = defaultPhoneMaskParams('circle', aspect);
    return inventory?.pen ? { ...base, feather: inventory.pen.feather, inverted: inventory.pen.inverted } : base;
  });
  const [busy, setBusy] = useState(false);
  const [penNote, setPenNote] = useState<string | null>(null);
  const penPath = usePhonePenStore((state) => state.path);
  const penActive = usePhonePenStore((state) => state.active);

  const blocked: PhoneUnavailable | undefined = !target.ok
    ? { reason: target.reason }
    : inventory?.animated
      ? { reason: 'This clip’s mask is animated with keyframes. Edit it in the full editor, or remove its keyframes there first.' }
      : undefined;
  const isBlocked = Boolean(blocked);

  const shapeDraft = (nextShape: ShapeChoice, nextParams: PhoneMaskParams): PhoneMaskDraft =>
    nextShape === 'none' || nextShape === 'pen' ? { shape: 'none' } : { shape: nextShape, params: nextParams };

  /** The full mask state of the sheet: a shape mask or a pen path, never both from this sheet. */
  const writeAll = (nextShape: ShapeChoice, nextParams: PhoneMaskParams, path: PhonePenPath | null) => () => {
    if (!target.ok) return;
    writePhoneMaskDraft(target.clip.id, maskRef.current, shapeDraft(nextShape, nextParams), aspect);
    writePhonePenDraft(target.clip.id, penRef.current, nextShape === 'pen' ? path : null, { feather: nextParams.feather, inverted: nextParams.inverted });
  };

  // Pen mode: the preview overlay draws into the pen store; this sheet starts and ends it.
  const startPath = useRef<PhonePenPath>(inventory?.pen?.path ?? EMPTY_PHONE_PEN_PATH);
  useEffect(() => {
    if (shape !== 'pen' || !target.ok || isBlocked) return undefined;
    usePhonePenStore.getState().begin(target.clip.id, startPath.current);
    return () => {
      startPath.current = usePhonePenStore.getState().path;
      usePhonePenStore.getState().end();
    };
  }, [shape, target, isBlocked]);

  // Every path change from the overlay or the buttons is written live (absolute state).
  const lastWritten = useRef<PhonePenPath | null>(inventory?.pen?.path ?? null);
  useEffect(() => {
    if (shape !== 'pen' || !penActive || penPath === lastWritten.current) return;
    if (lastWritten.current === null && penPath.points.length === 0) return;
    lastWritten.current = penPath;
    setPenNote(null);
    void session.apply(writeAll('pen', params, penPath));
    // writeAll reads the latest params through this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penPath, penActive, shape]);

  const currentPen = (): PhonePenPath => (penActive ? usePhonePenStore.getState().path : startPath.current);

  const change = (nextShape: ShapeChoice, nextParams: PhoneMaskParams) => {
    if (blocked || busy) return;
    setShape(nextShape);
    setParams(nextParams);
    if (nextShape === 'pen') lastWritten.current = currentPen();
    void session.apply(writeAll(nextShape, nextParams, currentPen()));
  };

  const pickShape = (choice: ShapeChoice) => {
    if (choice === shape) return;
    if (choice === 'none' || choice === 'pen') {
      change(choice, params);
      return;
    }
    // A new shape starts from its own size but keeps where it sits, its angle, edge and invert.
    const defaults = defaultPhoneMaskParams(choice, aspect);
    change(choice, { ...defaults, centerX: params.centerX, centerY: params.centerY, rotation: params.rotation, feather: params.feather, inverted: params.inverted });
  };

  const set = (patch: Partial<PhoneMaskParams>) => change(shape, { ...params, ...patch });

  /** Rectangle, Circle, Star or Heart becomes a pen path exactly where it sits, so its points can be dragged. */
  const editAsPoints = () => {
    if (shape === 'none' || shape === 'pen' || blocked || busy) return;
    const path = phoneShapeToPenPath(shape, params, aspect);
    if (!path) return;
    startPath.current = path;
    change('pen', params);
  };

  const done = async () => {
    if (busy) return;
    let finalPath: PhonePenPath | null = null;
    if (shape === 'pen') {
      finalPath = currentPen();
      if (finalPath.points.length > 0 && finalPath.points.length < PHONE_PEN_MIN_POINTS) {
        setPenNote(`A pen mask needs at least ${PHONE_PEN_MIN_POINTS} points. Tap the preview to add ${PHONE_PEN_MIN_POINTS - finalPath.points.length} more, or Clear to keep no pen path.`);
        return;
      }
      if (!finalPath.closed && finalPath.points.length > 0) finalPath = closePhonePenPath(finalPath);
    }
    setBusy(true);
    const autoClosed = shape === 'pen' && finalPath !== null && finalPath !== currentPen();
    const result = session.changed || autoClosed
      ? await session.commit(writeAll(shape, params, finalPath))
      : await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
    else if (autoClosed) showToast('The pen path was closed to make the mask.');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const shapeOptions = useMemo<PhoneChipOption<ShapeChoice>[]>(() => [
    { value: 'none', label: 'None', icon: <PhoneShapeGlyph shape="none" /> },
    ...PHONE_MASK_SHAPES.map(({ value, label }) => ({ value, label, icon: <PhoneShapeGlyph shape={value} /> })),
    { value: 'pen', label: 'Pen', icon: <PhoneShapeGlyph shape="pen" /> },
  ], []);

  const pen = shape === 'pen';
  const uses = shape === 'none' || pen ? null : PHONE_MASK_SHAPE_PARAMS[shape];
  const paramBlock = (needed: boolean | undefined, what: string): PhoneUnavailable | undefined => {
    if (blocked) return blocked;
    if (pen) return PEN_PLACED;
    if (!uses) return NO_SHAPE;
    return needed ? undefined : { reason: `${PHONE_MASK_SHAPES.find((entry) => entry.value === shape)?.label} has no ${what}.` };
  };
  const shapeBlock = paramBlock(true, '');
  const lookBlock: PhoneUnavailable | undefined = blocked ?? (pen ? undefined : uses ? undefined : NO_SHAPE);
  const heightLabel = shape === 'mirror' ? 'Thickness' : 'Height';
  const updatePen = usePhonePenStore((state) => state.update);
  const constraints = usePhonePenStore((state) => state.constraints);
  const setConstraint = usePhonePenStore((state) => state.setConstraint);

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
            {inventory.editable || inventory.pen ? '.' : '; a mask you make here is added on top.'}
          </PhoneSheetNote>
        ) : null}
        <PhoneChipGroup<ShapeChoice> label="Mask shape" value={shape} options={shapeOptions} testId={IDS.shapes} onChange={pickShape} disabled={blocked} layout="tile-row" />
        {pen && !blocked ? (
          <>
            <PhoneSheetNote testId={IDS.penStatus} tone={penNote ? 'warn' : 'info'}>{penNote ?? describePhonePenPath(penPath)}</PhoneSheetNote>
            <div className="phone-design-row" role="group" aria-label="Point constraints">
              {PHONE_PEN_CONSTRAINT_OPTIONS.map((option) => (
                <PhoneToggleChip key={option.key} label={option.label} pressed={constraints[option.key]} testId={`${IDS.constraint}-${option.key}`}
                  onToggle={(on) => { setConstraint(option.key, on); if (on) setPenNote(option.hint); }} />
              ))}
            </div>
            <div className="phone-design-row">
              <PhoneActionButton label="Undo point" testId={IDS.penUndo}
                unavailable={penPath.points.length === 0 ? { reason: 'There is no point to take back yet.' } : undefined}
                onPress={() => updatePen(undoPhonePenPoint, Math.max(0, penPath.points.length - (penPath.closed ? 1 : 2)))} />
              <PhoneActionButton label="Close path" testId={IDS.penClose}
                unavailable={canClosePhonePenPath(penPath) ? undefined : { reason: penPath.closed ? 'The path is already closed.' : `Place at least ${PHONE_PEN_MIN_POINTS} points first.` }}
                onPress={() => updatePen(closePhonePenPath, null)} />
              <PhoneActionButton label="Clear" testId={IDS.penClear}
                unavailable={penPath.points.length === 0 ? { reason: 'The path is already empty.' } : undefined}
                onPress={() => updatePen(() => EMPTY_PHONE_PEN_PATH, null)} />
            </div>
          </>
        ) : null}
        {!pen ? (
          <div className="phone-design-row">
            <PhoneActionButton label="Edit as points" testId={IDS.editPoints}
              unavailable={blocked ?? (shape === 'none' ? NO_SHAPE : PHONE_POINT_SHAPES.has(shape)
                ? undefined
                : { reason: 'Linear and Mirror reach far past the picture; use Rectangle, Circle, Star or Heart to edit points.' })}
              onPress={editAsPoints} />
          </div>
        ) : null}
        <div className="phone-design-row">
          <PhoneToggleChip label="Invert" pressed={params.inverted} testId={IDS.invert} unavailable={lookBlock} onToggle={(inverted) => set({ inverted })} />
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
          resetValue={0} unavailable={lookBlock} onChange={(value) => set({ feather: value })} />
        <PhoneSheetNote>Extra masks, mask modes and mask animation are in the full editor.</PhoneSheetNote>
      </div>
    </PhoneSheet>
  );
};
