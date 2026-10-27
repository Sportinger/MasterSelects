// 'shape-path' sheet: free shape paths (Motion Design path shapes) by finger. Draw a new path on the
// preview, or edit the selected path shape: drag points, bend their handles, tap a segment to add a
// point, remove points, make corners, open or close the path; trim (reveal) and dash the line. A
// rectangle, ellipse, polygon or star becomes a path first. All writes use the desktop Motion shape
// tab's store actions inside one owned transaction: Done is one undo step, Cancel changes nothing
// (a path drawn here disappears again).

import { useEffect, useRef, useState } from 'react';

import { splitPathSegment } from '../../../services/motionDesign/path/splitPathSegment';
import { useTimelineStore } from '../../../stores/timeline';
import type { MotionPathVertex } from '../../../types/motionDesign';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  PhoneActionButton, PhoneSegmented, PhoneSheetNote, PhoneSliderRow, PhoneToggleChip, type PhoneUnavailable,
} from '../crop/phoneDesignControls';
import {
  convertPhoneShapeToPath, createPhonePathClip, readPhonePathNumber, resolvePhoneShapePathTarget, writePhonePath, writePhonePathNumber,
  type PhonePathNumberKey,
} from './phoneShapePathCommands';
import { PHONE_PATH_MAX_VERTICES } from './phoneShapePathModel';
import { usePhoneShapePathStore, type PhoneShapePathMode } from './phoneShapePathStore';
import { PHONE_SHAPE_PATH_TEST_IDS as IDS } from './phoneShapePathTestIds';

type Numbers = Record<PhonePathNumberKey, number>;
const NUMBER_KEYS: readonly PhonePathNumberKey[] = ['trim.start', 'trim.end', 'trim.offset', 'dash.length', 'dash.gap', 'dash.offset'];

function readPath(clipId: string) {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
  return clip?.motion?.shape?.primitive === 'path' ? clip.motion.shape.path ?? null : null;
}

function readNumbers(clipId: string | null): Numbers {
  const path = clipId ? readPath(clipId) ?? undefined : undefined;
  return Object.fromEntries(NUMBER_KEYS.map((key) => [key, readPhonePathNumber(path, key)])) as Numbers;
}

export const PhoneShapePathSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Shape path');
  const [start] = useState(resolvePhoneShapePathTarget);
  const [clipId, setClipId] = useState<string | null>(start.kind === 'path' ? start.clip.id : null);
  const [numbers, setNumbers] = useState<Numbers>(() => readNumbers(start.kind === 'path' ? start.clip.id : null));
  const [busy, setBusy] = useState(false);
  const vertices = usePhoneShapePathStore((state) => state.vertices);
  const closed = usePhoneShapePathStore((state) => state.closed);
  const mode = usePhoneShapePathStore((state) => state.mode);
  const selected = usePhoneShapePathStore((state) => state.selected);
  const active = usePhoneShapePathStore((state) => state.active);

  const lastWritten = useRef<MotionPathVertex[] | null>(null);
  const lastClosed = useRef<boolean | null>(null);

  const beginEditing = (id: string, initialMode: PhoneShapePathMode) => {
    const path = readPath(id);
    usePhoneShapePathStore.getState().begin(id, path?.vertices.map((v) => ({ ...v })) ?? [], path?.closed ?? false, initialMode);
    lastWritten.current = usePhoneShapePathStore.getState().vertices;
    lastClosed.current = usePhoneShapePathStore.getState().closed;
    setClipId(id);
    setNumbers(readNumbers(id));
  };

  useEffect(() => {
    if (start.kind === 'path') beginEditing(start.clip.id, 'edit');
    return () => usePhoneShapePathStore.getState().end();
    // Starts once per sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every change of the overlay or the buttons is written live (absolute state).
  useEffect(() => {
    if (!active || !clipId) return;
    if (vertices === lastWritten.current && closed === lastClosed.current) return;
    lastWritten.current = vertices;
    lastClosed.current = closed;
    const id = clipId;
    const next = vertices;
    const nextClosed = closed;
    void session.apply(() => writePhonePath(id, next, nextClosed));
  }, [active, clipId, closed, session, vertices]);

  const run = (change: () => void) => session.apply(change);

  const newPath = async () => {
    if (start.kind !== 'none' || !start.trackId || busy || clipId) return;
    const created = { id: null as string | null };
    await run(() => { created.id = createPhonePathClip(); });
    if (created.id) beginEditing(created.id, 'draw');
    else showToast('The path could not be added; see the log for details.', 'error');
  };

  const convert = async () => {
    if (start.kind !== 'shape' || busy || clipId) return;
    const id = start.clip.id;
    await run(() => convertPhoneShapeToPath(id));
    beginEditing(id, 'edit');
  };

  const setNumber = (key: PhonePathNumberKey, value: number) => {
    if (!clipId) return;
    const id = clipId;
    setNumbers((current) => ({ ...current, [key]: value }));
    void run(() => writePhonePathNumber(id, key, value));
  };

  const setPath = (next: MotionPathVertex[], nextClosed: boolean, nextSelected?: number | null) =>
    usePhoneShapePathStore.getState().setPath(next, nextClosed, nextSelected);

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

  const editing = Boolean(clipId && active);
  const noPath: PhoneUnavailable | undefined = editing ? undefined : { reason: 'Draw a new path or turn the selected shape into a path first.' };
  const noPoint: PhoneUnavailable | undefined = noPath ?? (selected === null ? { reason: 'Tap a point on the preview first.' } : undefined);
  const minPoints = closed ? 3 : 2;
  const lastOpen = !closed && selected === vertices.length - 1;
  const status = !editing
    ? (start.kind === 'shape' ? 'This shape is not a path yet. Turn it into a path to edit its points.' : start.kind === 'none' ? start.reason : '')
    : mode === 'draw'
      ? 'Draw the path with one finger on the preview.'
      : `${vertices.length} point${vertices.length === 1 ? '' : 's'}${closed ? ', closed' : ''}. Drag a point, tap a segment to add one.`;

  return (
    <PhoneSheet title="Shape path" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-design-sheet" data-testid={IDS.sheet}>
        <PhoneSheetNote testId={IDS.status} tone={!editing && start.kind === 'none' && !start.trackId ? 'warn' : 'info'}>{status}</PhoneSheetNote>
        {!editing ? (
          <div className="phone-design-row">
            <PhoneActionButton label="Draw new path" testId={IDS.newPath}
              unavailable={start.kind === 'none' && start.trackId ? undefined : { reason: start.kind === 'none' ? start.reason : 'A shape is selected; turn it into a path, or deselect it to draw a new one.' }}
              onPress={() => { void newPath(); }} />
            <PhoneActionButton label="Turn shape into path" testId={IDS.convert}
              unavailable={start.kind === 'shape' ? undefined : { reason: 'Select a rectangle, ellipse, polygon or star shape clip first.' }}
              onPress={() => { void convert(); }} />
          </div>
        ) : (
          <>
            <PhoneSegmented<PhoneShapePathMode> label="Path mode" value={mode} testId={IDS.mode}
              onChange={(next) => usePhoneShapePathStore.getState().setMode(next)}
              options={[{ value: 'draw', label: 'Draw' }, { value: 'edit', label: 'Edit points' }]} />
            <div className="phone-design-row">
              <PhoneToggleChip label="Closed" pressed={closed} testId={IDS.closed}
                unavailable={vertices.length < 3 && !closed ? { reason: 'A closed path needs at least 3 points.' } : undefined}
                onToggle={(on) => setPath(vertices, on)} />
              <PhoneActionButton label="Add point after" testId={IDS.insert}
                unavailable={noPoint ?? (vertices.length >= PHONE_PATH_MAX_VERTICES ? { reason: 'A path holds at most 128 points.' } : lastOpen ? { reason: 'The last point of an open path has no segment after it.' } : undefined)}
                onPress={() => { if (selected !== null) setPath(splitPathSegment({ vertices, closed }, selected), closed, selected + 1); }} />
              <PhoneActionButton label="Remove point" testId={IDS.remove}
                unavailable={noPoint ?? (vertices.length <= minPoints ? { reason: `This path needs at least ${minPoints} points.` } : undefined)}
                onPress={() => { if (selected !== null) setPath(vertices.filter((_, i) => i !== selected), closed, Math.max(0, selected - 1)); }} />
              <PhoneActionButton label="Corner point" testId={IDS.corner} unavailable={noPoint}
                onPress={() => { if (selected !== null) setPath(vertices.map((v, i) => (i === selected ? { ...v, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } } : v)), closed); }} />
            </div>
          </>
        )}
        <PhoneSliderRow label="Reveal from" testId={IDS.trimStart} unit="%" min={0} max={100} value={numbers['trim.start'] * 100} resetValue={0}
          unavailable={noPath} onChange={(value) => setNumber('trim.start', Math.min(value / 100, numbers['trim.end']))} />
        <PhoneSliderRow label="Reveal to" testId={IDS.trimEnd} unit="%" min={0} max={100} value={numbers['trim.end'] * 100} resetValue={100}
          unavailable={noPath} onChange={(value) => setNumber('trim.end', Math.max(value / 100, numbers['trim.start']))} />
        <PhoneSliderRow label="Reveal offset" testId={IDS.trimOffset} unit="%" min={0} max={100} value={numbers['trim.offset'] * 100} resetValue={0}
          unavailable={noPath} onChange={(value) => setNumber('trim.offset', value / 100)} />
        <PhoneSliderRow label="Dash length" testId={IDS.dashLength} unit=" px" min={0} max={200} value={numbers['dash.length']} resetValue={0}
          unavailable={noPath} onChange={(value) => setNumber('dash.length', value)} />
        <PhoneSliderRow label="Dash gap" testId={IDS.dashGap} unit=" px" min={0} max={200} value={numbers['dash.gap']} resetValue={0}
          unavailable={noPath} onChange={(value) => setNumber('dash.gap', value)} />
        <PhoneSliderRow label="Dash offset" testId={IDS.dashOffset} unit=" px" min={0} max={200} value={numbers['dash.offset']} resetValue={0}
          unavailable={noPath} onChange={(value) => setNumber('dash.offset', value)} />
        <PhoneSheetNote>Reveal and dash values with keyframes get a keyframe at the playhead: set a keyframe with the diamond to animate the line drawing itself. Colour and width are under All settings → Motion.</PhoneSheetNote>
      </div>
    </PhoneSheet>
  );
};
