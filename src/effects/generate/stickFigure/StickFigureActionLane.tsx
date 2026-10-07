import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { InspectorSelect } from '../../../components/inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../../components/panels/properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../../components/panels/properties/resolveInspector/ResolveInspectorNumberRow';
import { useTimelineStore } from '../../../stores/timeline';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { SIMPLE_SYNTH_PRESETS } from '../../../engine/audio/synth/simpleSynthPresets';
import { SKELETON_JOINT_LABELS, type SkeletonJoint } from '../../../services/rig/skeletonRig';
import {
  parseSkeletonActions,
  SKELETON_ACTION_IDS,
  SKELETON_ACTIONS,
  skeletonActionContact,
  type SkeletonActionId,
} from '../../../services/rig/skeletonActions';
import { addStickFigureAction, removeStickFigureAction, updateStickFigureAction } from '../../../services/rig/stickFigureActions';
import { addStickFigureContactSfx, syncStickFigureContactMarkers } from '../../../services/rig/stickFigureContacts';
import { validateChoreography, type ChoreographyIssue } from '../../../services/rig/choreographyValidation';
import { STICK_FIGURE_EFFECT, stickFigureRef } from '../../../services/rig/stickFigureJointRuntime';
import './StickFigureControls.css';

const TARGET_JOINTS: readonly SkeletonJoint[] = ['head', 'neck', 'pelvis', 'handL', 'handR', 'footL', 'footR'];
const SFX_PRESETS = SIMPLE_SYNTH_PRESETS.filter(preset => preset.id.startsWith('sfx-'));

/** Action clips of one figure on a mini lane spanning its clip, plus contacts and checks. */
export function StickFigureActionLane({ clipId, effectId, actionsParam }: { clipId: string; effectId: string; actionsParam: unknown }) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const allClips = useTimelineStore(state => state.clips);
  const playhead = useTimelineStore(state => state.playheadPosition);
  const [selectedId, setSelectedId] = useState('');
  const [newAction, setNewAction] = useState<SkeletonActionId>('punch');
  const [sfxPreset, setSfxPreset] = useState('sfx-hit');
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null);
  const [issues, setIssues] = useState<ChoreographyIssue[] | null>(null);
  const [message, setMessage] = useState('');
  const laneRef = useRef<HTMLDivElement>(null);
  const actions = parseSkeletonActions(actionsParam);
  if (!clip) return null;
  const duration = Math.max(0.1, clip.duration);
  const clipTime = Math.max(0, Math.min(duration, playhead - clip.startTime));
  const selected = actions.find(item => item.id === selectedId);
  const run = (label: string, action: () => void) => {
    const batch = startBatch(label);
    try { action(); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (batch.opened) endBatch(); }
  };
  const secondsPerPixel = () => duration / Math.max(1, laneRef.current?.clientWidth ?? 1);
  const targetOptions = [{ value: '', label: 'No target' }, ...allClips.flatMap(item => item.effects
    .filter(effect => effect.type === STICK_FIGURE_EFFECT && !(item.id === clipId && effect.id === effectId))
    .flatMap(effect => TARGET_JOINTS.map(joint => ({
      value: `${stickFigureRef(item.id, effect.id)}#${joint}`, label: `${item.name} / ${SKELETON_JOINT_LABELS[joint]}`,
    }))))];

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(id);
    setDrag({ id, offset: 0 });
    (event.currentTarget as HTMLDivElement).dataset.startX = String(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const startX = Number((event.currentTarget as HTMLDivElement).dataset.startX ?? event.clientX);
    setDrag({ ...drag, offset: (event.clientX - startX) * secondsPerPixel() });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const action = actions.find(item => item.id === drag.id);
    if (action && Math.abs(drag.offset) > 1e-3) {
      run('Move action', () => updateStickFigureAction(clipId, effectId, drag.id, { start: Math.round((action.start + drag.offset) * 100) / 100 }));
    }
    setDrag(null);
  };

  return (
    <ResolveInspectorSection title="Actions" indicator="none">
      <div className="stick-figure-lane" ref={laneRef} aria-label="Action lane" onPointerDown={() => setSelectedId('')}>
        {actions.map(action => {
          const start = action.start + (drag?.id === action.id ? drag.offset : 0);
          const contact = skeletonActionContact(action);
          return (
            <div
              key={action.id}
              className={`stick-figure-lane-block${action.id === selectedId ? ' is-selected' : ''}`}
              style={{ left: `${start / duration * 100}%`, width: `${action.duration / duration * 100}%` }}
              title={`${SKELETON_ACTIONS[action.action].label} · ${action.start.toFixed(2)} s`}
              onPointerDown={event => onPointerDown(event, action.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <span>{SKELETON_ACTIONS[action.action].label}</span>
              {contact !== undefined && <i className="stick-figure-lane-contact" style={{ left: `${(contact - action.start) / action.duration * 100}%` }} />}
            </div>
          );
        })}
        <i className="stick-figure-lane-playhead" style={{ left: `${clipTime / duration * 100}%` }} />
      </div>
      <ResolveInspectorRow label="Add">
        <InspectorSelect ariaLabel="Action to add" value={newAction}
          options={SKELETON_ACTION_IDS.map(id => ({ value: id, label: SKELETON_ACTIONS[id].label }))} onChange={setNewAction} />
        <button type="button" className="perspective-action" title="Add the action at the playhead"
          onClick={() => run('Add action', () => setSelectedId(addStickFigureAction(clipId, effectId, newAction, Math.round(clipTime * 100) / 100)))}>
          At playhead
        </button>
      </ResolveInspectorRow>
      {selected && <>
        <ResolveInspectorNumberRow label="Start" suffix=" s" value={selected.start} defaultValue={0} min={0} max={duration} step={0.01}
          hardMin={0} onChange={start => run('Move action', () => updateStickFigureAction(clipId, effectId, selected.id, { start }))} />
        <ResolveInspectorNumberRow label="Duration" suffix=" s" value={selected.duration} defaultValue={SKELETON_ACTIONS[selected.action].duration}
          min={0.05} max={10} step={0.01} hardMin={0.05}
          onChange={value => run('Retime action', () => updateStickFigureAction(clipId, effectId, selected.id, { duration: value }))} />
        <ResolveInspectorNumberRow label="Strength" value={selected.strength ?? 1} defaultValue={1} min={0} max={2} step={0.01} hardMin={0} hardMax={2}
          onChange={strength => run('Action strength', () => updateStickFigureAction(clipId, effectId, selected.id, { strength }))} />
        {SKELETON_ACTIONS[selected.action].limb && (
          <ResolveInspectorRow label="Aim at">
            <InspectorSelect ariaLabel="Action target" options={targetOptions}
              value={selected.target ? `${selected.target.figure}#${selected.target.joint}` : ''}
              onChange={value => run('Aim action', () => {
                const [figure, joint] = value.split('#');
                updateStickFigureAction(clipId, effectId, selected.id, { target: value ? { figure, joint: joint as SkeletonJoint } : null });
              })} />
          </ResolveInspectorRow>
        )}
        <ResolveInspectorRow label="Remove">
          <button type="button" className="perspective-action"
            onClick={() => run('Remove action', () => { removeStickFigureAction(clipId, effectId, selected.id); setSelectedId(''); })}>
            Delete {SKELETON_ACTIONS[selected.action].label}
          </button>
        </ResolveInspectorRow>
      </>}
      <ResolveInspectorRow label="Contacts">
        <button type="button" className="perspective-action" title="One timeline marker per impact, release or landing"
          onClick={() => run('Contact markers', () => { const ids = syncStickFigureContactMarkers(clipId, effectId); setMessage(`${ids.length} contact markers.`); })}>
          Markers
        </button>
        <InspectorSelect ariaLabel="Contact sound" value={sfxPreset}
          options={SFX_PRESETS.map(preset => ({ value: preset.id, label: preset.name.replace('SFX ', '') }))} onChange={setSfxPreset} />
        <button type="button" className="perspective-action" title="A MIDI track with one sound per contact"
          onClick={() => run('Contact sounds', () => { addStickFigureContactSfx(clipId, effectId, sfxPreset); setMessage('Sound track added.'); })}>
          Sounds
        </button>
      </ResolveInspectorRow>
      <ResolveInspectorRow label="Check">
        <button type="button" className="perspective-action" title="Look for feet in the ground, missed hits, pops and overlaps"
          onClick={() => { try { setIssues(validateChoreography()); setMessage(''); } catch (error) { setMessage(String(error)); } }}>
          Check choreography
        </button>
      </ResolveInspectorRow>
      {issues && (
        <ul className="stick-figure-issues" aria-label="Choreography issues">
          {issues.length === 0 && <li>No problems found.</li>}
          {issues.slice(0, 30).map((issue, index) => (
            <li key={index}>
              <button type="button" onClick={() => useTimelineStore.getState().setPlayheadPosition(issue.time)}>
                {issue.time.toFixed(2)} s
              </button>{' '}
              {issue.figureName}: {issue.detail}
            </li>
          ))}
        </ul>
      )}
      {message && <p className="effect-info" role="status">{message}</p>}
    </ResolveInspectorSection>
  );
}
