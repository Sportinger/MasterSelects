// Unique id generation for score model elements (issue #366).
//
// Score element ids (slots, pitches, tuplets, measures) only need to be unique
// within one score, but a random UUID keeps them unique across copy/paste and
// clip duplication too, so tie pointers never alias between clips.

export function generateScoreElementId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `score-el-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
