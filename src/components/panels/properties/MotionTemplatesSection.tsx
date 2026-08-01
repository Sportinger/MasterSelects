import { useCallback, useState } from 'react';

import {
  handleApplyMotionTemplateForCurrentTimeline,
  handleSaveMotionTemplateForCurrentTimeline,
} from '../../../services/aiTools/handlers/motionDesign';
import { listMotionTemplates } from '../../../services/motionDesign/motionTemplateLibrary';
import { useTimelineStore } from '../../../stores/timeline';

interface MotionTemplatesSectionProps {
  clipId: string;
}

const EXPANDED_STORAGE_KEY = 'masterselects.motionTemplatesSection.expanded';

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch { /* storage unavailable */ }
}

const styles = {
  header: {
    display: 'flex', alignItems: 'center', gap: '6px', width: '100%', margin: 0,
    padding: 0, border: 'none', background: 'none', color: 'inherit', font: 'inherit',
    textAlign: 'left', cursor: 'pointer',
  },
  chevron: {
    display: 'inline-block', width: '1em', color: 'var(--text-secondary)', fontSize: 'var(--font-xs)',
  },
  error: { margin: '6px 0 0', color: 'var(--color-error, #d33)', fontSize: 'var(--font-xs)' },
  warning: { margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--font-xs)' },
} as const;

export function MotionTemplatesSection({ clipId }: MotionTemplatesSectionProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missingDependencies, setMissingDependencies] = useState<string[]>([]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const trackId = clip?.trackId;
  const templates = listMotionTemplates().templates;
  const categories = [...new Set(templates.map(template => template.category))].sort();
  const filteredTemplates = categoryFilter
    ? templates.filter(template => template.category === categoryFilter)
    : templates;

  const toggleExpanded = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      persistExpanded(next);
      return next;
    });
  }, []);

  const saveTemplate = useCallback(async () => {
    const result = await handleSaveMotionTemplateForCurrentTimeline({
      clipId,
      name,
      ...(category.trim() ? { category: category.trim() } : {}),
    });
    if (!result.success) {
      setError(result.error ?? 'Could not save motion template');
      return;
    }
    setName('');
    setCategory('');
    setError(null);
    setLibraryRevision(revision => revision + 1);
  }, [category, clipId, name]);

  const applyTemplate = useCallback(async () => {
    if (!trackId) return;
    const result = await handleApplyMotionTemplateForCurrentTimeline({
      templateId: selectedTemplateId,
      trackId,
      startTime: playheadPosition,
    });
    if (!result.success) {
      setError(result.error ?? 'Could not apply motion template');
      setMissingDependencies([]);
      return;
    }
    const data = result.data as { missingDependencies?: Array<{ label?: string }> } | undefined;
    setMissingDependencies((data?.missingDependencies ?? [])
      .map(dependency => dependency.label)
      .filter((label): label is string => Boolean(label)));
    setError(null);
  }, [playheadPosition, selectedTemplateId, trackId]);

  if (!clip?.motion?.shape) return null;

  return (
    <section className="properties-section" aria-label="Motion templates" data-library-revision={libraryRevision}>
      <h4>
        <button aria-expanded={expanded} style={styles.header} type="button" onClick={toggleExpanded}>
          <span aria-hidden="true" style={styles.chevron}>{expanded ? '▼' : '▶'}</span>
          Templates
        </button>
      </h4>
      {expanded && <>
        <div className="control-row motion-template-apply-row">
          <label className="prop-label" htmlFor={`motion-template-${clipId}`}>Templates</label>
          <select aria-label="Motion template category filter" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select id={`motion-template-${clipId}`} aria-label="Motion template" value={selectedTemplateId} onChange={event => setSelectedTemplateId(event.target.value)}>
            <option value="">Saved templates…</option>
            {filteredTemplates.map(template => <option key={template.templateId} value={template.templateId}>{template.name}</option>)}
          </select>
          <button aria-label="Apply motion template" className="btn btn-xs" disabled={!selectedTemplateId} type="button" onClick={applyTemplate}>Apply</button>
        </div>
        <div className="control-row motion-template-save-row">
          <input aria-label="Motion template name" value={name} placeholder="Save as template…" onChange={event => setName(event.target.value)} />
          <input aria-label="Motion template category" value={category} placeholder="Category (optional)" onChange={event => setCategory(event.target.value)} />
          <button aria-label="Save motion template" className="btn btn-xs" disabled={!name.trim()} type="button" onClick={saveTemplate}>Save</button>
        </div>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        {missingDependencies.length > 0 && <p role="status" style={styles.warning}>Missing dependencies: {missingDependencies.join(', ')}</p>}
      </>}
    </section>
  );
}
