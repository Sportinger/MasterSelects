import { useTimelineStore } from '../../../stores/timeline';
import { CABLE_LIGHT_FIELDS, cableLightValue } from '../../../services/faceCables/cableLight';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { DEFAULT_LIGHT_CLIP_SETTINGS } from '../../../types/light';
import { useHistoryStore } from '../../../stores/historyStore';

export function FaceCableLightControls({ clipId, effectId, busy, onChange }: {
  clipId: string; effectId: string; busy: boolean; onChange: () => void;
}) {
  const params = useTimelineStore(s => s.clips.find(c => c.id === clipId)?.effects.find(e => e.id === effectId)?.params);
  if (!params) return null;
  const update = (patch: Record<string, boolean | number>) => {
    const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
    if (!clip) return;
    state.updateClip(clipId, { effects: clip.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, ...patch } } : e) });
    onChange();
  };
  return <ResolveInspectorSection title="Light & face shadows">
    <ResolveInspectorRow label="Renderer"><label className="face-cable-checks">
      <input type="checkbox" checked={Boolean(params.scene3D)} disabled={busy} onChange={e => update({ scene3D: e.target.checked })} />Native 3D scene
    </label></ResolveInspectorRow>
    {params.scene3D ? <>
      <ResolveInspectorRow label="Scene depth"><label className="face-cable-checks">
        <input type="checkbox" checked={Boolean(params.sceneDepth)} disabled={busy} onChange={e => update({ sceneDepth: e.target.checked })} />Depth for the rest of the image
      </label></ResolveInspectorRow>
      {params.sceneDepth && <>
        <ResolveInspectorRow label="Depth contact"><label className="face-cable-checks">
          <input type="checkbox" checked={params.sceneDepthCollision !== false} disabled={busy} onChange={e => update({ sceneDepthCollision: e.target.checked })} />Collide with scene depth
        </label></ResolveInspectorRow>
        <ResolveInspectorNumberRow label="Depth strength" ariaLabel="Scene depth strength" value={Number(params.sceneDepthStrength) || 1}
          defaultValue={1} min={0.1} max={2} hardMin={0.1} hardMax={2} step={0.05} disabled={busy}
          persistenceKey={`face-cables.${effectId}.sceneDepthStrength`} onChange={value => update({ sceneDepthStrength: value })} />
        <p className="face-cable-hint">Bake estimates depth for hair, body and background; the face and anchors stay MediaPipe. First use downloads a 99 MB model. Video stays on this device. Relative relief, not a complete 3D scan. Depth contact adds collision with this surface; face contact is controlled separately.</p>
      </>}
      <p className="face-cable-hint">Bake to create cable tubes and the textured face mesh. Existing camera and light clips then control perspective, lighting and shadows in real time. Enable Cast shadows on the light clip. Physics changes still require Bake.</p>
      <button type="button" disabled={busy} onClick={() => {
        const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
        if (!clip || state.isExporting) return;
        const history = useHistoryStore.getState(), batch = history.startBatch('Add cable scene light');
        try {
          const track = state.addTrack('video'); state.renameTrack(track, 'Cable light');
          const id = state.addLightClip(track, clip.startTime, clip.duration, true, { ...DEFAULT_LIGHT_CLIP_SETTINGS, castsShadows: true, shadowStrength: 0.7, diameter: 1 });
          const light = useTimelineStore.getState().clips.find(c => c.id === id);
          if (light) state.updateClip(light.id, { name: 'Cable light', transform: { ...light.transform, position: { x: -1.5, y: 1.5, z: 3 } } });
          if (id) state.selectClip(id);
        } finally { if (batch.opened) history.endBatch(); }
      }}>Add scene light clip</button>
      <button type="button" disabled={busy} onClick={() => {
        const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
        if (!clip || state.isExporting) return;
        const history = useHistoryStore.getState(), batch = history.startBatch('Add cable scene camera');
        try {
          const track = state.addTrack('video'); state.renameTrack(track, 'Cable camera');
          const id = state.addCameraClip(track, clip.startTime, clip.duration, true);
          const camera = useTimelineStore.getState().clips.find(c => c.id === id);
          if (camera) {
            state.updateClip(camera.id, { name: 'Cable camera',
              transform: { ...camera.transform, position: { x: 0, y: 0, z: 1 / Math.tan(25 * Math.PI / 180) } },
              source: { ...camera.source!, cameraSettings: { ...camera.source!.cameraSettings!, fov: 50 } } });
            state.selectClip(camera.id);
          }
        } finally { if (batch.opened) history.endBatch(); }
      }}>Add scene camera clip</button>
    </> : <>
    <ResolveInspectorRow label="Shadows"><label className="face-cable-checks">
      <input type="checkbox" checked={Boolean(params.faceShadows)} disabled={busy} onChange={e => update({ faceShadows: e.target.checked })} />Cast shadows on face
    </label></ResolveInspectorRow>
    {(Object.keys(CABLE_LIGHT_FIELDS) as (keyof typeof CABLE_LIGHT_FIELDS)[]).map(key => {
      const spec = CABLE_LIGHT_FIELDS[key];
      return <ResolveInspectorNumberRow key={key} label={spec.label} ariaLabel={`Cable light ${spec.label.toLowerCase()}`}
        value={cableLightValue(params, key)} defaultValue={spec.default} min={spec.min} max={spec.max}
        hardMin={spec.min} hardMax={spec.max} step={key.startsWith('light') ? 1 : 0.01}
        disabled={busy || !params.faceShadows} persistenceKey={`face-cables.${effectId}.${key}`} onChange={value => update({ [key]: value })} />;
    })}
    <p className="face-cable-hint">Directional light: negative horizontal = left, negative vertical = above. Shadows receive on the tracked face mesh, soften with distance, and work with flat lines. Live preview while paused; bake for playback and export.</p>
    </>}
  </ResolveInspectorSection>;
}
