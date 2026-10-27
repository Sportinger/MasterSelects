// 'preview-view' sheet: how the phone preview shows the picture and what it lays over it. Clip
// handles and their snapping, pixel rulers, fit or actual pixels (100 %, slide with a finger),
// composition guides (the desktop's guides: add, clear; drag them on the rulers) and the split
// compare of the untreated clip against its effects. Guide changes and the transform reset are
// edits: they run in one owned transaction (Done = one undo step, Cancel = nothing). View options
// apply at once and Cancel puts them back as they were.

import { useState } from 'react';

import { addCompositionGuide, clearCompositionGuides } from '../../../services/compositionGuides';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSplitCompareStore } from '../../../stores/splitCompareStore';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { resolvePhoneClipTarget } from '../crop/phoneClipTarget';
import { phoneNodeDrivenTransformKeys, writePhoneTransform } from '../crop/phoneCropCommands';
import { readPhoneTransform, type PhoneTransformKey } from '../crop/phoneCropGeometry';
import {
  PhoneActionButton, PhoneSegmented, PhoneSheetNote, PhoneSliderRow, PhoneToggleChip,
} from '../crop/phoneDesignControls';
import { useTimelineStore } from '../../../stores/timeline';
import { PHONE_PREVIEW_VIEW_TEST_IDS as IDS } from './phonePreviewViewIds';
import { usePhonePreviewViewStore, type PhonePreviewZoom } from './phonePreviewViewStore';

const RESET_KEYS: readonly PhoneTransformKey[] = ['position.x', 'position.y', 'scale.all', 'rotation.z'];

function snapshotView() {
  const view = usePhonePreviewViewStore.getState();
  const compare = useSplitCompareStore.getState();
  return {
    handles: view.handles, snap: view.snap, rulers: view.rulers, zoom: view.zoom, pan: view.pan,
    compare: { enabled: compare.enabled, position: compare.position, feather: compare.feather },
  };
}

function restoreView(saved: ReturnType<typeof snapshotView>): void {
  const view = usePhonePreviewViewStore.getState();
  view.setHandles(saved.handles);
  view.setSnap(saved.snap);
  view.setRulers(saved.rulers);
  view.setZoom(saved.zoom);
  view.setPan(saved.pan);
  const compare = useSplitCompareStore.getState();
  compare.setEnabled(saved.compare.enabled);
  compare.setPosition(saved.compare.position);
  compare.setFeather(saved.compare.feather);
}

export const PhonePreviewViewSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Preview view');
  const [saved] = useState(snapshotView);
  const [busy, setBusy] = useState(false);
  const view = usePhonePreviewViewStore();
  const compare = useSplitCompareStore();
  const comp = useMediaStore((state) => state.compositions.find((c) => c.id === state.activeCompositionId));
  const guideCount = comp?.guides?.length ?? 0;
  const noComp = comp ? undefined : { reason: 'Guides belong to a composition; open one first.' };

  const addGuide = (orientation: 'horizontal' | 'vertical') => {
    if (!comp || busy) return;
    const position = orientation === 'vertical' ? comp.width / 2 : comp.height / 2;
    void session.apply(() => {
      if (addCompositionGuide(comp.id, orientation, position) === null) showToast('This composition already has the most guides it can hold (500).', 'error');
    });
    // A guide shows with the rulers (as on the desktop), so turn them on.
    view.setRulers(true);
  };

  const resetTransform = () => {
    const target = resolvePhoneClipTarget();
    if (!target.ok) { showToast(target.reason, 'info'); return; }
    const state = useTimelineStore.getState();
    const local = Math.max(0, state.playheadPosition - target.clip.startTime);
    const values = readPhoneTransform(state.getInterpolatedTransform(target.clip.id, local), target.comp);
    const blocked = phoneNodeDrivenTransformKeys(target.clip, RESET_KEYS);
    const keys = new Set(RESET_KEYS.filter((key) => !blocked.has(key)));
    if (blocked.size > 0) showToast('A node graph drives part of this transform; those values stay as they are.', 'info');
    void session.apply(() => writePhoneTransform(target.clip.id, { ...values, x: 0, y: 0, scale: 1, rotation: 0 }, keys, target.comp));
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
    restoreView(saved);
    closeSheet();
  };

  return (
    <PhoneSheet title="Preview view" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <div className="phone-design-row">
          <PhoneToggleChip label="Clip handles" pressed={view.handles} testId={IDS.handles} onToggle={view.setHandles} />
          <PhoneToggleChip label="Snap" pressed={view.snap} testId={IDS.snap} onToggle={view.setSnap}
            unavailable={view.handles ? undefined : { reason: 'Snapping belongs to the clip handles; turn them on first.' }} />
          <PhoneActionButton label="Reset clip position" testId={IDS.gizmoReset} onPress={resetTransform} />
        </div>
        <PhoneSheetNote>Drag the selected clip on the preview to move it, pinch to scale, twist two fingers to rotate. Each gesture is one undo step.</PhoneSheetNote>
        <PhoneSegmented<PhonePreviewZoom> label="Preview zoom" value={view.zoom} testId={IDS.zoom} onChange={view.setZoom}
          options={[{ value: 'fit', label: 'Fit' }, { value: 'actual', label: '1:1 (100 %)' }]} />
        <div className="phone-design-row">
          <PhoneToggleChip label="Rulers" pressed={view.rulers} testId={IDS.rulers} onToggle={view.setRulers} />
          <PhoneActionButton label="Add horizontal guide" testId={IDS.guideAddH} unavailable={noComp} onPress={() => addGuide('horizontal')} />
          <PhoneActionButton label="Add vertical guide" testId={IDS.guideAddV} unavailable={noComp} onPress={() => addGuide('vertical')} />
          <PhoneActionButton label="Clear guides" testId={IDS.guideClear}
            unavailable={noComp ?? (guideCount === 0 ? { reason: 'This composition has no guides yet.' } : undefined)}
            onPress={() => { if (comp) void session.apply(() => clearCompositionGuides(comp.id)); }} />
        </div>
        <PhoneSheetNote testId={IDS.guideStatus}>
          {guideCount === 0 ? 'No guides yet.' : `${guideCount} guide${guideCount === 1 ? '' : 's'}.`} New guides start in the middle; drag them on the preview, drop one on its ruler to remove it. Clips snap to guides.
        </PhoneSheetNote>
        <div className="phone-design-row">
          <PhoneToggleChip label="Compare before / after" pressed={compare.enabled} testId={IDS.compare} onToggle={compare.setEnabled} />
        </div>
        <PhoneSliderRow label="Compare line" testId={IDS.comparePosition} unit="%" min={2} max={98} value={compare.position * 100}
          resetValue={50} unavailable={compare.enabled ? undefined : { reason: 'Turn Compare on first.' }}
          onChange={(value) => compare.setPosition(value / 100)} />
        <PhoneSliderRow label="Soft line" testId={IDS.compareFeather} unit="%" min={0} max={5} decimals={1} step={0.1}
          value={compare.feather * 100} resetValue={0.6} unavailable={compare.enabled ? undefined : { reason: 'Turn Compare on first.' }}
          onChange={(value) => compare.setFeather(value / 100)} />
        <PhoneSheetNote>Compare shows the clip without its effects left of the line, with them on the right. It is a preview aid: exports stay fully edited.</PhoneSheetNote>
      </div>
    </PhoneSheet>
  );
};
