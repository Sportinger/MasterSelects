import { lazy, Suspense } from 'react';
import type { TimelineClip } from '../../../types/timeline';
import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { requestNodeWorkspaceView } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { ResolveInspectorIconButton, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';

const ColorControls = lazy(() => import('./ColorTab').then(module => ({ default: module.ColorTab })));

/** A view of the existing clip grade, not another entry in clip.effects. */
export function ColorGraphEffectEntry({ clip }: { clip: TimelineClip }) {
  const setEnabled = useTimelineStore(state => state.setColorCorrectionEnabled);
  const activatePanelType = useDockStore(state => state.activatePanelType);
  if (!clip.colorCorrection && !clip.nodeGraph?.forcedBuiltIns?.includes('color')) return null;
  return <ResolveInspectorSection title="Color" enabled={clip.colorCorrection?.enabled === true}
    className="color-graph-effect-entry" onEnabledChange={enabled => setEnabled(clip.id, enabled)}
    headerActions={<ResolveInspectorIconButton className="resolve-inspector-text-button" ariaLabel="Open Color Graph in Nodes" onClick={() => {
      requestNodeWorkspaceView(clip.id, 'color'); activatePanelType('node-workspace');
    }}>Nodes</ResolveInspectorIconButton>}>
    <Suspense fallback={<p className="effect-info">Loading color controls…</p>}>
      <ColorControls clipId={clip.id} />
    </Suspense>
  </ResolveInspectorSection>;
}
