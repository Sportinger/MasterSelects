import { useEffect, useState } from 'react';
import type { TimelineClip } from '../../../types/timeline';
import { getActiveColorVersion, isColorGradeNode } from '../../../types/colorCorrection';
import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { requestNodeWorkspaceView } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { ColorNodeParameterControls } from '../color/ColorNodeParameterControls';
import { ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';

/** A view of the existing clip grade, not another entry in clip.effects. */
export function ColorGraphEffectEntry({ clip }: { clip: TimelineClip }) {
  const setEnabled = useTimelineStore(state => state.setColorCorrectionEnabled);
  const setNodeEnabled = useTimelineStore(state => state.setColorNodeEnabled);
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const enabled = clip.colorCorrection?.enabled === true;
  const [collapsed, setCollapsed] = useState(!enabled);
  useEffect(() => { if (!enabled) setCollapsed(true); }, [enabled]);
  if (!clip.colorCorrection && !clip.nodeGraph?.forcedBuiltIns?.includes('color')) return null;
  const version = clip.colorCorrection && getActiveColorVersion(clip.colorCorrection);
  const nodes = version?.nodes.filter(isColorGradeNode) ?? [];

  return <div className={`effect-item color-graph-effect-entry ${!enabled ? 'bypassed' : ''}`}>
    <div className="effect-header">
      <button type="button" className="effect-collapse-toggle" aria-expanded={!collapsed}
        title={collapsed ? 'Expand Color' : 'Collapse Color'} onClick={() => setCollapsed(value => !value)}>
        <span className="effect-collapse-chevron" aria-hidden="true">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="effect-name">Color</span>
      </button>
      <button type="button" className={`effect-bypass-btn ${!enabled ? 'bypassed' : ''}`}
        aria-label={enabled ? 'Bypass Color' : 'Enable Color'} aria-pressed={enabled}
        title={enabled ? 'Bypass Color' : 'Enable Color'} onClick={() => setEnabled(clip.id, !enabled)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          {enabled ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
            : <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />}
        </svg>
      </button>
      <button type="button" className="effect-bypass-btn" aria-label="Open Color Graph in Nodes" title="Open Color Graph in Nodes"
        onClick={() => { requestNodeWorkspaceView(clip.id, 'color'); activatePanelType('node-workspace'); }}>Nodes</button>
    </div>
    {!collapsed && <div className="effect-params">
      {version && nodes.map(node => <ResolveInspectorSection key={`${version.id}:${node.id}`} title={node.name}
        enabled={node.enabled !== false} onEnabledChange={next => setNodeEnabled(clip.id, node.id, next)}>
        <ColorNodeParameterControls clip={clip} versionId={version.id} node={node} disabled={!enabled || node.enabled === false} />
      </ResolveInspectorSection>)}
      {!nodes.length && <p className="effect-info">{version ? 'No correction nodes. Add one in Nodes.' : 'Enable Color to initialize the grade.'}</p>}
    </div>}
  </div>;
}
