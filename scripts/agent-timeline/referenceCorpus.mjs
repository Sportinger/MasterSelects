/**
 * Phase 0A reference corpus metadata. The manifest intentionally contains no
 * media paths: local teams can attach licensed fixtures without changing the
 * scenario contract or making the cheap harness download media.
 */
export const AGENT_TIMELINE_CORPUS_VERSION = 1;

export const REFERENCE_CASES = Object.freeze([
  {
    id: 'short-interview',
    durationSeconds: 75,
    tags: ['short', 'dialog', 'single-face', 'cuts'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 1, nested: false, reverse: false, speedChanges: false },
  },
  {
    id: 'shot-reverse-shot',
    durationSeconds: 600,
    tags: ['dialog', 'multiple-faces', 'repeated-setup', 'cuts'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 2, nested: false, reverse: false, speedChanges: false },
  },
  {
    id: 'handheld-low-light',
    durationSeconds: 240,
    tags: ['handheld', 'low-light', 'camera-motion', 'quality'],
    source: { video: true, audio: true, variableFrameRate: true },
    timeline: { occurrenceCount: 1, nested: false, reverse: false, speedChanges: false },
  },
  {
    id: 'music-no-faces',
    durationSeconds: 300,
    tags: ['music', 'noise', 'no-faces', 'audio'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 1, nested: false, reverse: false, speedChanges: false },
  },
  {
    id: 'ocr-titles',
    durationSeconds: 180,
    tags: ['ocr', 'titles', 'cuts', 'dialog'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 1, nested: false, reverse: false, speedChanges: false },
  },
  {
    id: 'long-mixed-program',
    durationSeconds: 3600,
    tags: ['long', 'dialog', 'music', 'low-light', 'camera-motion', 'multiple-faces'],
    source: { video: true, audio: true, variableFrameRate: true },
    timeline: { occurrenceCount: 3, nested: true, reverse: true, speedChanges: true },
  },
  {
    id: 'source-reuse-reverse-speed',
    durationSeconds: 420,
    tags: ['repeated-source', 'reverse', 'speed-zero', 'speed-change', 'mapping'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 5, nested: false, reverse: true, speedChanges: true },
  },
  {
    id: 'nested-transition-multisource',
    durationSeconds: 900,
    tags: ['nested-comp', 'transition-map', 'multiple-visible-sources', 'mapping'],
    source: { video: true, audio: true, variableFrameRate: false },
    timeline: { occurrenceCount: 4, nested: true, reverse: false, speedChanges: true },
  },
]);

export function createReferenceCorpusManifest() {
  return {
    schemaVersion: AGENT_TIMELINE_CORPUS_VERSION,
    kind: 'agent-timeline-reference-corpus',
    cases: REFERENCE_CASES.map((entry) => ({
      ...entry,
      tags: [...entry.tags],
      source: { ...entry.source },
      timeline: { ...entry.timeline },
    })),
  };
}

export function validateReferenceCorpusManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['manifest must be an object'];
  }
  if (manifest.schemaVersion !== AGENT_TIMELINE_CORPUS_VERSION) {
    errors.push(`schemaVersion must be ${AGENT_TIMELINE_CORPUS_VERSION}`);
  }
  if (manifest.kind !== 'agent-timeline-reference-corpus') {
    errors.push('kind must be agent-timeline-reference-corpus');
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    errors.push('cases must be a non-empty array');
    return errors;
  }

  const ids = new Set();
  for (const entry of manifest.cases) {
    if (!entry || typeof entry !== 'object') {
      errors.push('each case must be an object');
      continue;
    }
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id)) {
      errors.push('case id must be a lowercase kebab-case string');
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate case id: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }
    if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) {
      errors.push(`case ${entry.id ?? '?'} needs a positive durationSeconds`);
    }
    if (!Array.isArray(entry.tags) || entry.tags.length === 0) {
      errors.push(`case ${entry.id ?? '?'} needs at least one tag`);
    }
    if (!entry.source || typeof entry.source.video !== 'boolean' || typeof entry.source.audio !== 'boolean') {
      errors.push(`case ${entry.id ?? '?'} needs source video/audio booleans`);
    }
    if (!entry.timeline || !Number.isInteger(entry.timeline.occurrenceCount) || entry.timeline.occurrenceCount < 1) {
      errors.push(`case ${entry.id ?? '?'} needs timeline occurrenceCount >= 1`);
    }
  }
  return errors;
}
