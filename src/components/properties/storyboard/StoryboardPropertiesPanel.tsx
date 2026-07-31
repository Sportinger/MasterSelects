import { useCallback, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { StoryboardClipProperties } from '../../../types/storyboard';
import {
  createStoryboardPropertiesClipUpdate,
  STORYBOARD_SCENE_STATUSES,
  type StoryboardPropertiesEditablePatch,
} from './storyboardPropertiesModel';
import './StoryboardPropertiesPanel.css';
import { StoryboardSceneInsights } from './coverage';

export interface StoryboardPropertiesPanelProps {
  clipId: string;
}

interface StoryboardTextFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}

function StoryboardTextField({
  label,
  value,
  multiline = false,
  onCommit,
}: StoryboardTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const common = {
    value: draft,
    'aria-label': label,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.currentTarget.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && event.key === 'Enter') event.currentTarget.blur();
    },
  };
  return (
    <label className="storyboard-properties-field">
      <span>{label}</span>
      {multiline ? <textarea {...common} rows={3} /> : <input {...common} type="text" />}
    </label>
  );
}

function StoryboardNumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0 && next !== value) {
      onCommit(next);
    } else {
      setDraft(String(value));
    }
  };
  return (
    <label className="storyboard-properties-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min="0.04"
        step="0.1"
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function StoryboardPropertiesPanel({
  clipId,
}: StoryboardPropertiesPanelProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const updateStoryboardScene = useTimelineStore(state => state.updateStoryboardScene);
  const properties = clip?.storyboardProperties;

  const commit = useCallback((
    patch: StoryboardPropertiesEditablePatch,
    label: string,
  ) => {
    if (!clip) return;
    const update = createStoryboardPropertiesClipUpdate(clip, patch);
    if (!update) return;
    const before = JSON.stringify(clip.storyboardProperties);
    const after = JSON.stringify(update.storyboardProperties);
    if (before === after && (!update.name || update.name === clip.name)) return;
    updateStoryboardScene(
      clip.storyboardProperties!.sceneId,
      patch,
      { historyLabel: label },
    );
  }, [clip, updateStoryboardScene]);

  if (!clip || clip.source?.type !== 'storyboard' || !properties) {
    return <div className="storyboard-properties-empty">Scene card is unavailable.</div>;
  }

  const commitField = <K extends keyof StoryboardClipProperties>(
    key: K,
    value: StoryboardClipProperties[K],
    label: string,
  ) => commit({ [key]: value } as StoryboardPropertiesEditablePatch, label);

  return (
    <section className="storyboard-properties" aria-label="Storyboard scene properties">
      <div className="storyboard-properties-identities">
        <div><span>Plan</span><code>{properties.planId}</code></div>
        <div><span>Scene</span><code>{properties.sceneId}</code></div>
      </div>

      <StoryboardTextField
        key={`title:${properties.title}`}
        label="Title"
        value={properties.title}
        onCommit={value => commitField('title', value, 'Rename storyboard scene')}
      />
      <StoryboardTextField
        key={`description:${properties.description}`}
        label="Description"
        value={properties.description}
        multiline
        onCommit={value => commitField('description', value, 'Edit storyboard description')}
      />
      <StoryboardTextField
        key={`intent:${properties.intent ?? ''}`}
        label="Intent"
        value={properties.intent ?? ''}
        multiline
        onCommit={value => commitField('intent', value || undefined, 'Edit storyboard intent')}
      />
      <StoryboardTextField
        key={`visual-direction:${properties.visualDirection ?? ''}`}
        label="Visual direction"
        value={properties.visualDirection ?? ''}
        multiline
        onCommit={value => commitField('visualDirection', value || undefined, 'Edit visual direction')}
      />
      <StoryboardTextField
        key={`audio-direction:${properties.audioDirection ?? ''}`}
        label="Audio direction"
        value={properties.audioDirection ?? ''}
        multiline
        onCommit={value => commitField('audioDirection', value || undefined, 'Edit audio direction')}
      />
      <StoryboardTextField
        key={`transition-intent:${properties.transitionIntent ?? ''}`}
        label="Transition intent"
        value={properties.transitionIntent ?? ''}
        onCommit={value => commitField('transitionIntent', value || undefined, 'Edit transition intent')}
      />

      <div className="storyboard-properties-grid">
        <StoryboardTextField
          key={`scene-kind:${properties.sceneKind ?? ''}`}
          label="Scene kind"
          value={properties.sceneKind ?? ''}
          onCommit={value => commitField('sceneKind', value || undefined, 'Edit scene kind')}
        />
        <StoryboardTextField
          key={`beat-id:${properties.beatId ?? ''}`}
          label="Beat ID"
          value={properties.beatId ?? ''}
          onCommit={value => commitField('beatId', value || undefined, 'Edit beat ID')}
        />
        <label className="storyboard-properties-field">
          <span>Status</span>
          <select
            aria-label="Status"
            value={properties.status}
            onChange={event => commitField(
              'status',
              event.currentTarget.value as StoryboardClipProperties['status'],
              'Change storyboard status',
            )}
          >
            {STORYBOARD_SCENE_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <StoryboardNumberField
          key={`target-duration:${properties.targetDurationSeconds}`}
          label="Target duration"
          value={properties.targetDurationSeconds}
          onCommit={value => commitField(
            'targetDurationSeconds',
            value,
            'Change storyboard target duration',
          )}
        />
        <label className="storyboard-properties-field">
          <span>Actual duration</span>
          <output aria-label="Actual duration">{clip.duration.toFixed(2)} s</output>
        </label>
        <label className="storyboard-properties-field">
          <span>Card color</span>
          <input
            aria-label="Card color"
            type="color"
            value={properties.color ?? '#6657d9'}
            onChange={event => commitField('color', event.currentTarget.value, 'Change storyboard color')}
          />
        </label>
      </div>

      <StoryboardTextField
        key={`notes:${properties.notes ?? ''}`}
        label="Notes"
        value={properties.notes ?? ''}
        multiline
        onCommit={value => commitField('notes', value || undefined, 'Edit storyboard notes')}
      />
      <StoryboardSceneInsights clipId={clipId} />
    </section>
  );
}
