import { useFaceCableAnimation } from './useFaceCableAnimation';
import { FaceCableEnvironmentControls } from './FaceCableEnvironmentControls';
import { FaceCableLightControls } from './FaceCableLightControls';
import { cableSimulationOrder } from '../../../services/faceCables/cableConnections';
import { useCablePreview } from '../../../services/faceCables/useCablePreview';
import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { FACE_CABLE_ANCHORS, MAX_FACE_CABLES, isFaceCableConfig, defaultFaceCable, type FaceCableConfig } from '../../../services/faceCables/cableData';
import type { EffectControlProps } from '../../../effects/types';
import { usePreciseFaceTrack } from '../../../services/landmarkTracking/usePreciseFaceTrack';
import './faceCableInspector.css';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { bakeFaceCables } from '../../../services/faceCables/bakeFaceCables';

function readConfigs(value: unknown): FaceCableConfig[] {
  try { const configs = JSON.parse(String(value)); if (Array.isArray(configs) && configs.length && configs.length <= MAX_FACE_CABLES && configs.every(isFaceCableConfig)) return configs.map(c => ({ windZ: 0, windGusts: 0, renderStyle: 'shaded', viscosity: 0, segments: 24, stiffness: 0, lockFrom: true, lockTo: true, showAnchors: true, ...c })); } catch { /* New effect. */ }
  return [defaultFaceCable()];
}
export default function FaceCableEffectControls(props: EffectControlProps) {
  return props.clipId && props.effectInstanceId ? <FaceCableControls key={`${props.clipId}:${props.effectInstanceId}`} clipId={props.clipId} effectId={props.effectInstanceId} /> : <span>Select a timeline clip to configure face cables.</span>;
}
export function FaceCableControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const tracking = usePreciseFaceTrack(clipId);
  const disabled = !tracking.ready || tracking.summary?.status === "tracking" || tracking.summary?.status === "loading";
  const settings = useTimelineStore(state => state.clips.find(c => c.id === clipId)?.effects.find(e => e.id === effectId)?.params.settings);
  const [defaults] = useState(defaultFaceCable);
  const [configs, setConfigs] = useState(() => readConfigs(settings));
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [message, setMessage] = useState('');
  const previewStatus = useCablePreview(clipId, effectId, configs, dirty && previewEnabled && !busy && !disabled);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { const restored = readConfigs(settings); setConfigs(restored); setSelected(index => Math.min(index, restored.length - 1)); setDirty(false); }, [settings]);
  useEffect(() => () => controller.current?.abort(), []);
  const cable = configs[Math.min(selected, configs.length - 1)];
  const edit = (patch: Partial<FaceCableConfig>) => { setDirty(true); setConfigs(list => list.map((c, i) => i === selected ? { ...c, ...patch } : c)); setMessage('Settings changed — bake to apply.'); };
  const animation = useFaceCableAnimation(clipId, effectId, cable, () => setDirty(true), edit, busy);
  const bake = async () => {
    const abort = new AbortController(); controller.current = abort; setBusy(true); setProgress(0); setMessage('Simulating cables…');
    try { await bakeFaceCables(clipId, effectId, configs, abort.signal, setProgress); setDirty(false); setMessage(`${configs.length} cable${configs.length === 1 ? '' : 's'} baked · preview and export`); }
    catch (error) { setMessage(abort.signal.aborted ? 'Cancelled; previous cables kept.' : error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); controller.current = null; }
  };
  const numberRow = (key: 'windZ' | 'windGusts' | 'viscosity' | 'segments' | 'stiffness' | 'slack' | 'gravity' | 'damping' | 'width', label: string, min: number, max: number, step: number) => (
    <ResolveInspectorNumberRow key={key} label={label} ariaLabel={`Cable ${label.toLowerCase()}`}
      value={animation.values[key] ?? 0} min={min} max={max} step={step}
      hardMin={key === 'windZ' ? undefined : min}
      hardMax={key === 'segments' ? 96 : ['stiffness', 'viscosity', 'windGusts'].includes(key) ? 1 : undefined} defaultValue={defaults[key] ?? 0}
      disabled={busy} persistenceKey={`face-cables.${effectId}.${key}`}
      keyframeToggle={key === 'segments' ? undefined : animation.toggle(key, label)}
      onChange={value => key === 'segments' ? edit({ segments: Math.round(value) }) : animation.change(key, value)} />
  );
  const parentOptions = configs.flatMap((candidate, index) => {
    try {
      cableSimulationOrder(configs.map(c => c.id === cable.id ? { ...c, fromCableId: candidate.id } : c));
      return [{ value: `cable:${candidate.id}`, label: `Cable ${index + 1} midpoint` }];
    } catch { return []; }
  });
  const hasBranches = configs.some(c => c.fromCableId === cable.id);
  return <div className="face-cable-inspector" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button, select, input[type="checkbox"], input[type="color"]')?.blur();
  }}>
    <ResolveInspectorSection title="Connections">
      <div className="face-cable-actions" role="group" aria-label="Choose cable">
        {configs.map((config, index) => <button key={config.id} type="button" disabled={busy}
          aria-pressed={index === selected} onClick={() => setSelected(index)}>
          Cable {index + 1}{config.fromCableId ? ' (branch)' : ''}
        </button>)}
      </div>
      <p className="face-cable-hint">Editing cable {selected + 1}. Each cable has independent settings and keyframes.</p>
      <ResolveInspectorRow label="Cable">
        <InspectorSelect ariaLabel="Selected cable" value={String(selected)} disabled={busy} onChange={value => setSelected(Number(value))}
          options={configs.map((config, i) => ({ value: String(i), label: `${i + 1}: ${config.fromCableId ? 'Cable ' + (configs.findIndex(c => c.id === config.fromCableId) + 1) + ' midpoint' : FACE_CABLE_ANCHORS[config.from]?.label} to ${FACE_CABLE_ANCHORS[config.to]?.label}` }))} />
      </ResolveInspectorRow>
      {(['from', 'to'] as const).map(field => <ResolveInspectorRow key={field} label={field === 'from' ? 'From' : 'To'}>
        <InspectorSelect ariaLabel={`Cable ${field}`} value={field === 'from' && cable.fromCableId ? `cable:${cable.fromCableId}` : cable[field]} disabled={busy}
          onChange={value => field === 'from'
            ? edit(value.startsWith('cable:') ? { fromCableId: value.slice(6), lockFrom: true } : { from: value as FaceCableConfig['from'], fromCableId: undefined })
            : edit({ to: value as FaceCableConfig['to'] })}
          options={[...Object.entries(FACE_CABLE_ANCHORS).map(([id, anchor]) => ({ value: id, label: anchor.label })), ...(field === 'from' ? parentOptions : [])]} />
      </ResolveInspectorRow>)}
      <ResolveInspectorRow label="Attachment">
        <div className="face-cable-checks">
          <label><input type="checkbox" checked={cable.lockFrom ?? true} disabled={busy} onChange={event => edit({ lockFrom: event.target.checked })} />Lock start</label>
          <label><input type="checkbox" checked={cable.lockTo ?? true} disabled={busy} onChange={event => edit({ lockTo: event.target.checked })} />Lock end</label>
        </div>
      </ResolveInspectorRow>
      <p className="face-cable-hint">Right / left means your own right / left. Ear area uses an approximate face-edge point. Unlocked ends move freely.</p>
      <div className="face-cable-actions">
        <button type="button" disabled={busy || configs.length >= MAX_FACE_CABLES} onClick={() => { setDirty(true); setConfigs([...configs, defaultFaceCable()]); setSelected(configs.length); }}>Add cable</button>
        <button type="button" disabled={busy || configs.length >= MAX_FACE_CABLES} onClick={() => {
          setDirty(true);
          setConfigs([...configs, { ...defaultFaceCable(), fromCableId: cable.id, to: 'rightEar', color: cable.color, width: cable.width, renderStyle: cable.renderStyle }]);
          setSelected(configs.length);
        }}>Branch to right ear</button>
        {hasBranches && <span className="face-cable-hint">Remove or reconnect child cables before removing this cable.</span>}
        <button type="button" disabled={busy || configs.length <= 1 || hasBranches} onClick={() => { setDirty(true); setConfigs(configs.filter((_, i) => i !== selected)); setSelected(0); }}>Remove cable</button>
      </div>
    </ResolveInspectorSection>
    <FaceCableEnvironmentControls clipId={clipId} effectId={effectId} busy={busy} onChange={() => setDirty(true)} />
    <FaceCableLightControls clipId={clipId} effectId={effectId} busy={busy} onChange={() => setDirty(true)} />
    <ResolveInspectorSection title="Physics">
      {numberRow('segments', 'Segments', 4, 96, 1)}
      {numberRow('slack', 'Length factor', 1.05, 3, 0.05)}
      {numberRow('stiffness', 'Stiffness', 0, 1, 0.05)}
      {numberRow('gravity', 'Gravity', 0, 3, 0.1)}
      {numberRow('damping', 'Damping', 0.2, 10, 0.2)}
      {numberRow('viscosity', 'Viscosity', 0, 1, 0.05)}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Wind">
      {numberRow('windZ', 'Toward camera', -30, 30, 0.1)}
      {numberRow('windGusts', 'Gusts', 0, 1, 0.05)}
      <p className="face-cable-hint">Positive: toward camera. Negative: away. Zero: off.</p>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Appearance">
      <ResolveInspectorRow label="Style">
        <InspectorSelect ariaLabel="Cable appearance" value={cable.renderStyle ?? 'shaded'} disabled={busy}
          onChange={value => edit({ renderStyle: value })}
          options={[{ value: 'shaded', label: 'Shaded cable' }, { value: 'flat', label: 'Flat line' }]} />
      </ResolveInspectorRow>
      {numberRow('width', 'Thickness', 1, 20, 0.5)}
      <ResolveInspectorRow label="Color"><input aria-label="Cable color" type="color" value={cable.color} disabled={busy} onChange={event => edit({ color: event.target.value })} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Attachments"><label className="face-cable-checks"><input type="checkbox" checked={cable.showAnchors ?? true} disabled={busy} onChange={event => edit({ showAnchors: event.target.checked })} />Show rings</label></ResolveInspectorRow>
    </ResolveInspectorSection>
    <div className="face-cable-footer">
      <label className="face-cable-checks"><input type="checkbox" checked={previewEnabled} onChange={event => setPreviewEnabled(event.target.checked)} />Live frame preview</label>
      {previewStatus && <p role="status" className="face-cable-hint">{previewStatus}</p>}
      <p className="face-cable-hint">{tracking.ready ? 'Precise face tracking ready.' : 'Track face precisely in the Tracking panel first.'} Bake saves changes for playback and export.</p>
      <div className="face-cable-actions">
        <button type="button" disabled={disabled || busy} onClick={() => void bake()}>Bake cables</button>
        {busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel cables</button>}
      </div>
      {busy && <progress aria-label="Cable bake progress" max={1} value={progress} />}
      <output aria-live="polite">{message}{busy ? ` ${Math.round(progress * 100)}%` : ''}</output>
    </div>
  </div>;
}
