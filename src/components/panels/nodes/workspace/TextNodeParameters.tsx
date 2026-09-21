import { useEffect, useState } from 'react';
import type { TimelineClip } from '../../../../types/timeline';
import type { TextNodeStage } from '../../../../types/text';
import { TextTab } from '../../TextTab';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { TEXT_NODE_STAGES, type TextSettingsStage } from '../../../../services/text/textNodeStages';
import { applyTextNodePresetSettings, listTextNodePresets, saveTextNodePreset, type SavedTextNodePreset } from '../../../../services/text/textNodePresets';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';

export function TextNodeParameters({ clip, stage }: { clip: TimelineClip; stage: TextNodeStage }) {
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.id === clip.trackId && track.locked));
  const [name, setName] = useState(''), [selected, setSelected] = useState(''), [message, setMessage] = useState('');
  const [presets, setPresets] = useState<SavedTextNodePreset[]>([]);
  const settingsStage: TextSettingsStage = stage === 'content' || stage === 'render' ? 'all' : stage;
  useEffect(() => {
    const refresh = () => { try { setPresets(listTextNodePresets()); } catch (error) { setMessage(String(error)); } };
    refresh(); window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  if (!clip.textProperties) return null;
  const run = (action: () => void) => { try { action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const compatible = presets.filter(preset => preset.stage === settingsStage);
  const liveText = !!clip.captionProperties || !!clip.captionLayerBinding;
  return <div className="operator-parameters" onClick={event => {
    if (event.detail > 0 && event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <div className="node-workspace-inspector-header"><h3>{TEXT_NODE_STAGES[stage].label}</h3></div>
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <TextTab clipId={clip.id} textProperties={clip.textProperties} scope={stage === 'render' ? 'all' : stage}
        hideContent={stage === 'render'} liveText={liveText} compact disabled={locked}
        canvasSize={{ width: clip.source?.textCanvas?.width ?? 1920, height: clip.source?.textCanvas?.height ?? 1080 }} />
    </fieldset>
    {stage !== 'content' && <ResolveInspectorSection title="Reusable text settings" indicator="none">
      <ResolveInspectorRow label="Name"><input className="operator-group-name" aria-label="Text preset name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></ResolveInspectorRow>
      <button className="node-workspace-primary-action" type="button" disabled={!name.trim()} onClick={() => run(() => {
        const current = readTimelineRuntimeState(useTimelineStore).clips.find(item => item.id === clip.id);
        if (!current?.textProperties) throw new Error('Text clip unavailable.');
        const preset = saveTextNodePreset(name, settingsStage, current.textProperties);
        setPresets(listTextNodePresets()); setSelected(preset.id); setName(''); setMessage('Text settings saved.');
      })}>Save settings</button>
      <ResolveInspectorRow label="Preset"><InspectorSelect ariaLabel="Text settings preset" value={selected}
        options={[{ value: '', label: 'Choose preset' }, ...compatible.map(preset => ({ value: preset.id, label: preset.name }))]} onChange={setSelected} /></ResolveInspectorRow>
      <button className="node-workspace-primary-action" type="button" disabled={locked || !compatible.some(preset => preset.id === selected)} onClick={() => run(() => {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(item => item.id === clip.id);
        if (!current?.textProperties || state.isExporting || state.tracks.some(track => track.id === current.trackId && track.locked)) throw new Error('The clip is locked or exporting.');
        const preset = listTextNodePresets().find(item => item.id === selected && item.stage === settingsStage);
        if (!preset) throw new Error('Text preset unavailable.');
        const batch = startBatch('Apply text node preset');
        try { state.updateTextProperties(clip.id, applyTextNodePresetSettings(preset)); }
        finally { if (batch.opened) endBatch(); }
        setMessage('Text settings applied.');
      })}>Apply settings</button>
      <p className="face-cable-hint">Reuse on other text clips in this browser. Text content and animation stay with the destination clip.</p>
    </ResolveInspectorSection>}
    {message && <p role="status" className="face-cable-hint">{message}</p>}
  </div>;
}
