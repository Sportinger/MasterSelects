// Left side of the phone output editor: the output targets (projectors, screens) as cards. Add,
// select, rename, switch on/off, route a source (active composition, a fixed composition or a slot),
// remove. Opening a target on a second display is greyed: a phone browser cannot drive one.

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';
import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import { useSliceStore } from '../../../stores/sliceStore';
import type { RenderTarget } from '../../../types/renderTarget';
import { listOutputSourceOptions, outputSourceKey, outputSourceLabel } from '../../outputManager/outputSourceOptions';
import { removeOutputTarget, routeOutputTargetSource } from '../../outputManager/outputTargetCommands';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneOutputStore } from './phoneOutputStore';
import { PHONE_OUTPUT_TEST_IDS as IDS } from './phoneOutputTestIds';
import { addPhoneOutputTarget, PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON } from './phoneOutputCommands';
import { usePhoneOutputTargets } from './usePhoneOutputTarget';
import './PhoneOutput.css';

const blurAfterTouch = (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType !== 'mouse') event.currentTarget.blur(); };

function NameField({ target }: { target: RenderTarget }) {
  const [draft, setDraft] = useState(target.name);
  const commit = () => {
    const name = draft.trim();
    if (name && name !== target.name) useRenderTargetStore.getState().updateTargetName(target.id, name);
    else setDraft(target.name);
  };
  return (
    <input
      className="phone-output__field"
      data-testid={IDS.targetName}
      aria-label="Output name"
      value={draft}
      enterKeyHint="done"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

function SourceField({ target }: { target: RenderTarget }) {
  const all = useMediaStore((state) => state.compositions);
  const slots = useMediaStore((state) => state.activeLayerSlots);
  const visible = all.filter(isUserVisibleComposition);
  const options = listOutputSourceOptions(visible, all, slots);
  const currentKey = outputSourceKey(target.source);
  const known = options.some((option) => option.key === currentKey);
  return (
    <label className="phone-output__row">
      <span className="phone-output__label">Source</span>
      <select
        className="phone-output__field"
        data-testid={IDS.targetSource}
        value={currentKey}
        onChange={(event) => {
          const option = options.find((entry) => entry.key === event.target.value);
          if (option) routeOutputTargetSource(target.id, option.source);
        }}
      >
        {known ? null : <option value={currentKey}>{outputSourceLabel(target.source, all)}</option>}
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TargetCard({ target, selected }: { target: RenderTarget; selected: boolean }) {
  const selectTarget = usePhoneOutputStore((state) => state.selectTarget);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const items = useSliceStore((state) => state.configs.get(target.id)?.slices.length ?? 0);
  return (
    <li
      className={`phone-output__card${selected ? ' is-selected' : ''}`}
      data-testid={IDS.targetCard}
      data-target-id={target.id}
      data-selected={selected}
    >
      <button
        type="button"
        className="phone-output__card-head"
        aria-pressed={selected}
        onClick={() => selectTarget(target.id)}
        onPointerUp={blurAfterTouch}
      >
        <span className={`phone-output__dot${target.enabled ? ' is-on' : ''}`} aria-hidden="true" />
        <span className="phone-output__card-title">{target.name}</span>
        <span className="phone-output__card-meta">{items === 0 ? 'full frame' : `${items} ${items === 1 ? 'item' : 'items'}`}</span>
      </button>
      {selected ? (
        <div className="phone-output__card-body">
          <NameField key={target.name} target={target} />
          <SourceField target={target} />
          <div className="phone-output__actions">
            <button
              type="button"
              className="phone-output__chip"
              data-testid={IDS.targetEnabled}
              aria-pressed={target.enabled}
              onClick={() => useRenderTargetStore.getState().setTargetEnabled(target.id, !target.enabled)}
              onPointerUp={blurAfterTouch}
            >
              {target.enabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="phone-output__chip is-greyed"
              data-testid={IDS.targetExternal}
              aria-disabled="true"
              onClick={() => showUnavailable({ actionId: 'output-external-display', label: 'Open on a display', reason: PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON })}
              onPointerUp={blurAfterTouch}
            >
              Open on display
            </button>
            <button
              type="button"
              className="phone-output__chip phone-output__chip--danger"
              data-testid={IDS.targetRemove}
              onClick={() => removeOutputTarget(target.id)}
              onPointerUp={blurAfterTouch}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PhoneOutputTargets() {
  const { targets, selected } = usePhoneOutputTargets();
  return (
    <div className="phone-output__panel" data-testid={IDS.targets}>
      <div className="phone-output__panel-head">
        <h3 className="phone-output__panel-title">Outputs</h3>
        <button type="button" className="phone-output__chip" data-testid={IDS.addTarget} onClick={addPhoneOutputTarget} onPointerUp={blurAfterTouch}>
          + Output
        </button>
      </div>
      {targets.length === 0 ? <p className="phone-output__hint">No outputs yet.</p> : null}
      <ul className="phone-output__list">
        {targets.map((target) => <TargetCard key={target.id} target={target} selected={target.id === selected?.id} />)}
      </ul>
    </div>
  );
}
