// Right side of the phone output editor: the slice and mask stack of the selected output, in drawing
// order, and the selected item's details (name, typed corners of the active tab, reset, match shape).
// Every button calls the slice store action the desktop Output Manager uses.

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import { useSliceStore } from '../../../stores/sliceStore';
import type { OutputSlice } from '../../../types/outputSlice';
import { cornersOnTab, parsePercent, toPercentText } from './phoneOutputGeometry';
import { PHONE_OUTPUT_TEST_IDS as IDS } from './phoneOutputTestIds';
import { usePhoneOutputTargets } from './usePhoneOutputTarget';
import './PhoneOutput.css';

const CORNER_SHORT = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const blurAfterTouch = (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); };

function Chip({ testId, label, onPress, pressed, disabled, tone, ariaLabel }: {
  testId: string; label: string; onPress: () => void; pressed?: boolean; disabled?: boolean; tone?: 'danger'; ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`phone-output__chip${tone === 'danger' ? ' phone-output__chip--danger' : ''}`}
      data-testid={testId}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onPress(); }}
      onPointerUp={blurAfterTouch}
    >
      {label}
    </button>
  );
}

function ItemRow({ targetId, item, index, count, selected }: { targetId: string; item: OutputSlice; index: number; count: number; selected: boolean }) {
  const store = useSliceStore.getState;
  const isMask = item.type === 'mask';
  return (
    <li
      className={`phone-output__item${selected ? ' is-selected' : ''}${item.enabled ? '' : ' is-off'}`}
      data-testid={IDS.item}
      data-item-id={item.id}
      data-kind={item.type}
      data-selected={selected}
    >
      <button type="button" className="phone-output__card-head" aria-pressed={selected} onClick={() => store().selectSlice(targetId, item.id)} onPointerUp={blurAfterTouch}>
        <span className={`phone-output__dot${item.enabled ? ' is-on' : ''}`} aria-hidden="true" />
        <span className="phone-output__card-title">{item.name}</span>
        <span className="phone-output__card-meta">{isMask ? (item.inverted ? 'mask · black inside' : 'mask · black outside') : 'corner pin'}</span>
      </button>
      <div className="phone-output__actions">
        <Chip testId={IDS.itemEnabled} label={item.enabled ? 'On' : 'Off'} pressed={item.enabled} ariaLabel={`${item.name} ${item.enabled ? 'on' : 'off'}`}
          onPress={() => store().setSliceEnabled(targetId, item.id, !item.enabled)} />
        {isMask ? (
          <Chip testId={IDS.itemInvert} label={item.inverted ? 'Black inside' : 'Black outside'} pressed={item.inverted}
            ariaLabel={`${item.name}: ${item.inverted ? 'blacks out inside; tap for outside' : 'blacks out outside; tap for inside'}`}
            onPress={() => store().setMaskInverted(targetId, item.id, !item.inverted)} />
        ) : null}
        <Chip testId={IDS.itemUp} label="▲" ariaLabel={`Move ${item.name} up`} disabled={index === 0} onPress={() => store().reorderItems(targetId, index, index - 1)} />
        <Chip testId={IDS.itemDown} label="▼" ariaLabel={`Move ${item.name} down`} disabled={index === count - 1} onPress={() => store().reorderItems(targetId, index, index + 1)} />
        <Chip testId={IDS.itemDelete} label="Delete" tone="danger" ariaLabel={`Delete ${item.name}`} onPress={() => store().removeSlice(targetId, item.id)} />
      </div>
    </li>
  );
}

function ItemName({ targetId, item }: { targetId: string; item: OutputSlice }) {
  const [draft, setDraft] = useState(item.name);
  const commit = () => {
    const name = draft.trim();
    if (name && name !== item.name) useSliceStore.getState().renameSlice(targetId, item.id, name);
    else setDraft(item.name);
  };
  return (
    <input
      className="phone-output__field"
      data-testid={IDS.itemName}
      aria-label={item.type === 'mask' ? 'Mask name' : 'Slice name'}
      value={draft}
      enterKeyHint="done"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

function CornerField({ value, corner, axis, onCommit }: { value: number; corner: number; axis: 'x' | 'y'; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(toPercentText(value));
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const parsed = parsePercent(draft);
    if (parsed === null) { setInvalid(true); return; }
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <input
      className={`phone-output__field phone-output__field--number${invalid ? ' is-invalid' : ''}`}
      data-testid={IDS.cornerField}
      data-corner={corner}
      data-axis={axis}
      aria-label={`${CORNER_SHORT[corner]} ${axis === 'x' ? 'horizontal' : 'vertical'} position in percent`}
      aria-invalid={invalid}
      title={invalid ? 'Type a number in percent, for example 25 or 12.5' : undefined}
      inputMode="decimal"
      enterKeyHint="done"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

function ItemDetails({ targetId, item }: { targetId: string; item: OutputSlice }) {
  const tab = useSliceStore((state) => state.activeTab);
  const corners = cornersOnTab(item, tab);
  const store = useSliceStore.getState;
  const setCorner = (corner: number, point: { x: number; y: number }) => {
    if (tab === 'input') store().setInputCorner(targetId, item.id, corner, point);
    else store().setCornerPinCorner(targetId, item.id, corner, point);
  };
  return (
    <div className="phone-output__details">
      <ItemName key={`${item.id}:${item.name}`} targetId={targetId} item={item} />
      <p className="phone-output__hint">{tab === 'input' ? 'Corners of the source region (percent of the composition)' : 'Corners on the output (percent of the screen)'}</p>
      {corners ? (
        <div className="phone-output__corners">
          {corners.map((point, corner) => (
            <div className="phone-output__corner" key={corner}>
              <span className="phone-output__label">{CORNER_SHORT[corner]}</span>
              <CornerField key={`${item.id}:${tab}:x:${point.x}`} value={point.x} corner={corner} axis="x" onCommit={(x) => setCorner(corner, { x, y: point.y })} />
              <CornerField key={`${item.id}:${tab}:y:${point.y}`} value={point.y} corner={corner} axis="y" onCommit={(y) => setCorner(corner, { x: point.x, y })} />
            </div>
          ))}
        </div>
      ) : (
        <p className="phone-output__hint" data-testid={IDS.meshNotice}>
          This slice uses a mesh warp. MasterSelects has no mesh editor on any device yet; Reset turns it into a corner pin you can edit here.
        </p>
      )}
      <div className="phone-output__actions">
        <Chip testId={IDS.itemReset} label="Reset" onPress={() => store().resetSliceWarp(targetId, item.id)} />
        {item.warp.mode === 'cornerPin' ? (
          <Chip
            testId={IDS.itemMatch}
            label={tab === 'input' ? 'Match output shape' : 'Match input shape'}
            onPress={() => (tab === 'input' ? store().matchInputToOutput(targetId, item.id) : store().matchOutputToInput(targetId, item.id))}
          />
        ) : null}
      </div>
    </div>
  );
}

export function PhoneOutputSlices() {
  const { selected } = usePhoneOutputTargets();
  const config = useSliceStore((state) => (selected ? state.configs.get(selected.id) : undefined));
  if (!selected) {
    return <div className="phone-output__panel" data-testid={IDS.slices}><p className="phone-output__hint">Add an output first.</p></div>;
  }
  const items = config?.slices ?? [];
  const current = items.find((item) => item.id === config?.selectedSliceId) ?? null;
  const store = useSliceStore.getState;
  return (
    <div className="phone-output__panel" data-testid={IDS.slices}>
      <div className="phone-output__panel-head">
        <h3 className="phone-output__panel-title">Slices &amp; masks</h3>
        <Chip testId={IDS.addSlice} label="+ Slice" onPress={() => store().addSlice(selected.id)} />
        <Chip testId={IDS.addMask} label="+ Mask" onPress={() => store().addMask(selected.id)} />
      </div>
      {items.length === 0 ? <p className="phone-output__hint">No slices: the output shows the full frame. Add a slice to pick a region and pin its corners.</p> : null}
      <ul className="phone-output__list">
        {items.map((item, index) => (
          <ItemRow key={item.id} targetId={selected.id} item={item} index={index} count={items.length} selected={item.id === current?.id} />
        ))}
      </ul>
      {current ? <ItemDetails targetId={selected.id} item={current} /> : null}
    </div>
  );
}
