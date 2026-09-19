import { useMemo } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types';
import {
  ensureColorCorrectionState,
  getActiveColorVersion,
  getEditableColorNodes,
} from '../../../types/colorCorrection';
import './ColorKeyframesPanel.css';
import './ColorWorkspacePanel.css';

interface ColorKeyframesPanelProps {
  clipId: string;
}

interface KeyframeRow {
  id: string;
  label: string;
  keyframes: Keyframe[];
  kind: 'master' | 'node' | 'sizing';
}

const EMPTY_KEYFRAMES: Keyframe[] = [];

function formatKeyframeTime(seconds: number): string {
  const frames = Math.max(0, Math.round(seconds * 30));
  const frame = frames % 30;
  const totalSeconds = Math.floor(frames / 30);
  const second = totalSeconds % 60;
  const minute = Math.floor(totalSeconds / 60) % 60;
  const hour = Math.floor(totalSeconds / 3600);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
}

function isSizingKeyframe(keyframe: Keyframe): boolean {
  return keyframe.property === 'opacity'
    || keyframe.property.startsWith('position.')
    || keyframe.property.startsWith('scale.')
    || keyframe.property.startsWith('rotation.');
}

export function ColorKeyframesPanel({ clipId }: ColorKeyframesPanelProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const clipKeyframes = useTimelineStore(
    state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES,
  );
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const colorState = useMemo(
    () => ensureColorCorrectionState(clip?.colorCorrection),
    [clip?.colorCorrection],
  );
  const activeVersion = getActiveColorVersion(colorState);
  const duration = Math.max(0.001, clip?.duration ?? 1);
  const rows = useMemo<KeyframeRow[]>(() => {
    const nodeRows = getEditableColorNodes(colorState).map((node, index) => ({
      id: node.id,
      label: node.name || `Corrector ${index + 1}`,
      kind: 'node' as const,
      keyframes: clipKeyframes.filter(keyframe => (
        activeVersion
          ? keyframe.property.startsWith(`color.${activeVersion.id}.${node.id}.`)
          : false
      )),
    }));
    const sizingKeyframes = clipKeyframes.filter(isSizingKeyframe);
    return [
      { id: 'master', label: 'Master', kind: 'master', keyframes: clipKeyframes },
      ...nodeRows,
      { id: 'sizing', label: 'Sizing', kind: 'sizing', keyframes: sizingKeyframes },
    ];
  }, [activeVersion, clipKeyframes, colorState]);
  const playheadLocalTime = Math.max(0, Math.min(duration, playheadPosition - (clip?.startTime ?? 0)));
  const timeTicks = Array.from({ length: 4 }, (_, index) => duration * index / 3);

  if (!clip) {
    return <div className="panel-empty"><p>Select a video clip to inspect keyframes</p></div>;
  }

  return (
    <section className="color-keyframes-panel">
      <header className="color-workspace-surface-header">
        <strong>Keyframes</strong>
        <span>All⌄</span>
      </header>
      <div className="color-keyframes-ruler">
        <span />
        <div>
          {timeTicks.map(time => (
            <label key={time} style={{ left: `${time / duration * 100}%` }}>{formatKeyframeTime(time)}</label>
          ))}
        </div>
      </div>
      <div className="color-keyframes-rows">
        {rows.map(row => (
          <div className={`color-keyframes-row ${row.kind}`} key={row.id}>
            <span className="color-keyframes-label">
              {row.kind !== 'master' && <i aria-hidden="true" />}
              {row.label}
            </span>
            <div className="color-keyframes-lane">
              {row.keyframes.map(keyframe => (
                <b
                  aria-label={`${row.label} keyframe at ${formatKeyframeTime(keyframe.time)}`}
                  key={`${row.id}-${keyframe.id}`}
                  style={{ left: `${Math.max(0, Math.min(100, keyframe.time / duration * 100))}%` }}
                />
              ))}
              <span className="color-keyframes-playhead" style={{ left: `${playheadLocalTime / duration * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
