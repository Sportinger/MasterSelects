// 'crop' sheet ("Crop & transform") for the selected clip. Crop: ratio presets (largest centred
// crop of that shape), the four edges and a soft edge, written as the desktop inspector's crop
// mask. Transform: position, scale, rotation, opacity, flip, fit/fill and reset, written through
// setPropertyValue like the desktop inspector. Live inside one owned transaction: Done is one
// undo step, Cancel restores the clip exactly.

import { useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { calculateFillToFrameScale, calculateFitToFrameScale } from '../../../utils/sourcePixelScale';
import type { ResolveCropValues } from '../../panels/properties/transformTab/resolveCropMask';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { resolvePhoneClipTarget } from './phoneClipTarget';
import { phoneNodeDrivenTransformKeys, readPhoneCrop, writePhoneCrop, writePhoneTransform } from './phoneCropCommands';
import {
  detectPhoneCropRatio, NO_CROP, PHONE_CROP_RATIOS, phoneRatioCrop, readPhoneTransform, resetPhoneTransform, setPhoneCropEdge,
  type PhoneCropRatioId, type PhoneTransformKey, type PhoneTransformValues,
} from './phoneCropGeometry';
import { PHONE_CROP_TEST_IDS as IDS } from './phoneCropTestIds';
import {
  PhoneActionButton, PhoneChipGroup, PhoneSegmented, PhoneSheetNote, PhoneSliderRow, PhoneToggleChip, type PhoneUnavailable,
} from './phoneDesignControls';

type Tab = 'crop' | 'transform';
const ALL_KEYS: readonly PhoneTransformKey[] = ['position.x', 'position.y', 'scale.all', 'scale.x', 'scale.y', 'rotation.z', 'opacity'];
const EDGES = [['left', 'Left', IDS.cropLeft], ['right', 'Right', IDS.cropRight], ['top', 'Top', IDS.cropTop], ['bottom', 'Bottom', IDS.cropBottom]] as const;

function readStart() {
  const target = resolvePhoneClipTarget();
  if (!target.ok) return { target, crop: null, transform: null, nodeDriven: new Set<PhoneTransformKey>() };
  const state = useTimelineStore.getState();
  const local = Math.max(0, state.playheadPosition - target.clip.startTime);
  const transform = readPhoneTransform(state.getInterpolatedTransform(target.clip.id, local), target.comp);
  return { target, crop: readPhoneCrop(target.clip, target.source), transform, nodeDriven: phoneNodeDrivenTransformKeys(target.clip, ALL_KEYS) };
}

export const PhoneCropSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Crop & transform');
  const [start] = useState(readStart);
  const { target, nodeDriven } = start;
  const [tab, setTab] = useState<Tab>('crop');
  const [crop, setCrop] = useState<ResolveCropValues>(start.crop?.values ?? NO_CROP);
  const [ratio, setRatio] = useState<PhoneCropRatioId | null>(() => (target.ok && start.crop ? detectPhoneCropRatio(start.crop.values, target.source) : null));
  const [transform, setTransform] = useState<PhoneTransformValues | null>(start.transform);
  const [touched, setTouched] = useState<{ crop: boolean; keys: Set<PhoneTransformKey> }>({ crop: false, keys: new Set() });
  const [busy, setBusy] = useState(false);

  const blocked: PhoneUnavailable | undefined = target.ok ? undefined : { reason: target.reason };

  const writeAll = (nextCrop: ResolveCropValues, nextTransform: PhoneTransformValues | null, nextTouched: typeof touched) => () => {
    if (!target.ok) return;
    if (nextTouched.crop) writePhoneCrop(target.clip.id, nextCrop, target.source);
    if (nextTransform && nextTouched.keys.size > 0) writePhoneTransform(target.clip.id, nextTransform, nextTouched.keys, target.comp);
  };

  const applyCrop = (next: ResolveCropValues, nextRatio: PhoneCropRatioId | null) => {
    if (blocked || busy) return;
    const nextTouched = { ...touched, crop: true };
    setCrop(next);
    setRatio(nextRatio);
    setTouched(nextTouched);
    void session.apply(writeAll(next, transform, nextTouched));
  };

  const applyTransform = (patch: Partial<PhoneTransformValues>, keys: readonly PhoneTransformKey[]) => {
    if (blocked || busy || !transform) return;
    const writable = keys.filter((key) => !nodeDriven.has(key));
    if (writable.length < keys.length) showToast('Some of these values are driven by a node graph and stay as they are.', 'info');
    if (writable.length === 0) return;
    const next = { ...transform, ...patch };
    const nextTouched = { crop: touched.crop, keys: new Set([...touched.keys, ...writable]) };
    setTransform(next);
    setTouched(nextTouched);
    void session.apply(writeAll(crop, next, nextTouched));
  };

  const pickRatio = (id: PhoneCropRatioId) => {
    if (!target.ok) return;
    const entry = PHONE_CROP_RATIOS.find((candidate) => candidate.id === id);
    if (!entry?.ratio) {
      setRatio('free');
      return;
    }
    const next = phoneRatioCrop(target.source, entry.ratio, crop.softness);
    applyCrop(next, id);
    if (next.left + next.right + next.top + next.bottom === 0) showToast(`The clip already is ${entry.label}; nothing to crop.`, 'info');
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = session.changed ? await session.commit(writeAll(crop, transform, touched)) : await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const percentOf = (edge: 'left' | 'right' | 'top' | 'bottom') => {
    if (!target.ok) return 0;
    const side = edge === 'left' || edge === 'right' ? target.source.width : target.source.height;
    return (crop[edge] / side) * 100;
  };
  const keyBlock = (key: PhoneTransformKey): PhoneUnavailable | undefined => blocked
    ?? (nodeDriven.has(key) ? { reason: 'A node graph drives this value. Change it at its source in the full editor.' } : undefined);
  const fitBlock: PhoneUnavailable | undefined = blocked
    ?? (target.ok && !target.sourceKnown ? { reason: 'Fit and Fill need the picture’s size, which this clip does not report.' } : undefined)
    ?? keyBlock('scale.x');
  const frameScale = (mode: 'fit' | 'fill') => {
    if (!target.ok) return 1;
    const { source, comp } = target;
    return mode === 'fit'
      ? calculateFitToFrameScale(source.width, source.height, comp.width, comp.height)
      : calculateFillToFrameScale(source.width, source.height, comp.width, comp.height);
  };
  const cropOff = target.ok && start.crop && !start.crop.enabled;

  return (
    <PhoneSheet title="Crop & transform" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy || !target.ok}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <PhoneSegmented<Tab> label="Crop or transform" value={tab} testId={IDS.tabs} onChange={setTab}
          options={[{ value: 'crop', label: 'Crop' }, { value: 'transform', label: 'Transform' }]} />
        <PhoneSheetNote testId={IDS.status} tone={blocked || cropOff ? 'warn' : 'info'}>
          {blocked ? blocked.reason : cropOff
            ? 'Cropping is switched off for this clip in the full editor; turn the Cropping section on there to see it.'
            : `${target.ok ? target.clip.name : ''}${target.ok && target.otherSelected > 0 ? ` (the ${target.otherSelected} other selected clip${target.otherSelected === 1 ? '' : 's'} stay unchanged)` : ''}`}
        </PhoneSheetNote>
        {tab === 'crop' ? (
          <>
            <PhoneChipGroup<PhoneCropRatioId> label="Crop ratio" value={ratio} testId={IDS.ratios} disabled={blocked}
              options={PHONE_CROP_RATIOS.map(({ id, label }) => ({ value: id, label }))} onChange={pickRatio} />
            {EDGES.map(([edge, label, testId]) => (
              <PhoneSliderRow key={edge} label={label} testId={testId} unit="%" min={0} max={95} value={percentOf(edge)} decimals={0}
                resetValue={0} unavailable={blocked}
                onChange={(value) => { if (target.ok) applyCrop(setPhoneCropEdge(crop, edge, value, target.source), 'free'); }} />
            ))}
            <PhoneSliderRow label="Soft edge" testId={IDS.softness} unit=" px" min={0} max={200} value={crop.softness}
              resetValue={0} unavailable={blocked} onChange={(value) => applyCrop({ ...crop, softness: value }, ratio)} />
            <div className="phone-design-row">
              <PhoneActionButton label="Reset crop" testId={IDS.resetCrop} unavailable={blocked} onPress={() => applyCrop(NO_CROP, null)} />
            </div>
          </>
        ) : transform ? (
          <>
            <div className="phone-design-row">
              <PhoneToggleChip label="Flip H" pressed={transform.flipH} testId={IDS.flipH} unavailable={keyBlock('scale.x')}
                onToggle={(flipH) => applyTransform({ flipH }, ['scale.x'])} />
              <PhoneToggleChip label="Flip V" pressed={transform.flipV} testId={IDS.flipV} unavailable={keyBlock('scale.y')}
                onToggle={(flipV) => applyTransform({ flipV }, ['scale.y'])} />
              <PhoneActionButton label="Fit" testId={IDS.fit} unavailable={fitBlock}
                onPress={() => { const s = frameScale('fit'); applyTransform({ scale: 1, scaleX: s, scaleY: s }, ['scale.all', 'scale.x', 'scale.y']); }} />
              <PhoneActionButton label="Fill" testId={IDS.fill} unavailable={fitBlock}
                onPress={() => { const s = frameScale('fill'); applyTransform({ scale: 1, scaleX: s, scaleY: s }, ['scale.all', 'scale.x', 'scale.y']); }} />
            </div>
            <PhoneSliderRow label="Position X" testId={IDS.positionX} unit=" px" min={-(target.ok ? target.comp.width : 1920)} max={target.ok ? target.comp.width : 1920}
              value={transform.x} resetValue={0} unavailable={keyBlock('position.x')} onChange={(x) => applyTransform({ x }, ['position.x'])} />
            <PhoneSliderRow label="Position Y" testId={IDS.positionY} unit=" px" min={-(target.ok ? target.comp.height : 1080)} max={target.ok ? target.comp.height : 1080}
              value={transform.y} resetValue={0} unavailable={keyBlock('position.y')} onChange={(y) => applyTransform({ y }, ['position.y'])} />
            <PhoneSliderRow label="Scale" testId={IDS.scale} unit="%" min={10} max={400} value={transform.scale * 100}
              resetValue={100} unavailable={keyBlock('scale.all')} onChange={(value) => applyTransform({ scale: value / 100 }, ['scale.all'])} />
            <PhoneSliderRow label="Rotation" testId={IDS.rotation} unit="°" min={-180} max={180} value={transform.rotation}
              resetValue={0} unavailable={keyBlock('rotation.z')} onChange={(rotation) => applyTransform({ rotation }, ['rotation.z'])} />
            <PhoneSliderRow label="Opacity" testId={IDS.opacity} unit="%" min={0} max={100} value={transform.opacity * 100}
              resetValue={100} unavailable={keyBlock('opacity')} onChange={(value) => applyTransform({ opacity: value / 100 }, ['opacity'])} />
            <div className="phone-design-row">
              <PhoneActionButton label="Reset transform" testId={IDS.resetTransform} unavailable={blocked}
                onPress={() => applyTransform(resetPhoneTransform(transform), ['position.x', 'position.y', 'scale.all', 'scale.x', 'scale.y', 'rotation.z', 'opacity'])} />
            </div>
            <PhoneSheetNote>Values with keyframes get a keyframe at the playhead. Dragging and pinching on the preview, 3D and anchor point are in the full editor.</PhoneSheetNote>
          </>
        ) : null}
      </div>
    </PhoneSheet>
  );
};
