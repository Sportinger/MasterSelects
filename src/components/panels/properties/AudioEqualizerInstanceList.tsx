import { useMemo, useState } from 'react';
import {
  createAudioEqGraphViewModel,
  filterAudioEqInstances,
  type AudioEqInstanceDescriptor,
  type AudioEqInstanceScope,
} from '../../../engine/audio';

export interface AudioEqualizerInstanceListProps {
  instances: readonly AudioEqInstanceDescriptor[];
  onJump?: (instance: AudioEqInstanceDescriptor) => void;
}

function createMiniPath(instance: AudioEqInstanceDescriptor): string {
  const width = 92;
  const height = 28;
  const view = createAudioEqGraphViewModel(instance.params, {
    width,
    height,
    sampleCount: 64,
  });

  return Array.from(view.summedResponseDb).map((gainDb, index) => {
    const x = (index / Math.max(1, view.summedResponseDb.length - 1)) * width;
    const y = ((view.rangeDb - Math.max(-view.rangeDb, Math.min(view.rangeDb, gainDb))) / (view.rangeDb * 2)) * height;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function scopeLabel(scope: AudioEqInstanceScope): string {
  switch (scope) {
    case 'clip':
      return 'Clip';
    case 'track':
      return 'Track';
    case 'master':
      return 'Master';
  }
}

export function AudioEqualizerInstanceList({
  instances,
  onJump,
}: AudioEqualizerInstanceListProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<AudioEqInstanceScope | 'all'>('all');
  const filtered = useMemo(
    () => filterAudioEqInstances(instances, { query, scope }),
    [instances, query, scope],
  );

  return (
    <section className="audio-eq-instance-list">
      <div className="audio-eq-instance-list-head">
        <strong>EQ Instances</strong>
        <span>{filtered.length}/{instances.length}</span>
      </div>
      <div className="audio-eq-instance-list-filters">
        <input
          type="search"
          value={query}
          placeholder="Search"
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search EQ instances"
        />
        <select
          value={scope}
          onChange={(event) => setScope(event.currentTarget.value as AudioEqInstanceScope | 'all')}
          aria-label="Filter EQ instances"
        >
          <option value="all">All</option>
          <option value="clip">Clip</option>
          <option value="track">Track</option>
          <option value="master">Master</option>
        </select>
      </div>
      <div className="audio-eq-instance-list-rows">
        {filtered.length === 0 ? (
          <div className="audio-eq-instance-empty">No EQ instances</div>
        ) : filtered.map(instance => (
          <button
            key={instance.id}
            type="button"
            className={instance.enabled ? '' : 'bypassed'}
            onClick={() => onJump?.(instance)}
            title={`${scopeLabel(instance.scope)}: ${instance.ownerName}`}
          >
            <svg viewBox="0 0 92 28" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" y1="14" x2="92" y2="14" />
              <path d={createMiniPath(instance)} />
            </svg>
            <span>
              <strong>{instance.ownerName}</strong>
              <em>{scopeLabel(instance.scope)} / {instance.bandCount} bands</em>
            </span>
            <i>
              {instance.dynamicBandCount > 0 ? `D${instance.dynamicBandCount}` : ''}
              {instance.spectralBandCount > 0 ? ` S${instance.spectralBandCount}` : ''}
            </i>
          </button>
        ))}
      </div>
    </section>
  );
}
