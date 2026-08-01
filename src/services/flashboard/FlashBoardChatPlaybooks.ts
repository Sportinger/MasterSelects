export type FlashBoardChatPlaybookId =
  | 'analysis'
  | 'face'
  | 'montage'
  | 'motion'
  | 'quality'
  | 'silence'
  | 'storyboard'
  | 'text'
  | 'transcript'
  | 'visual';

interface FlashBoardChatPlaybook {
  id: FlashBoardChatPlaybookId;
  matches: RegExp;
  text: string;
}

const PLAYBOOKS: FlashBoardChatPlaybook[] = [
  {
    id: 'storyboard',
    matches: /\b(?:storyboard|story board|scene card|scene plan|shot list|animatic|co-?direct|director|directing|plan mode|planung|szenenplan|drehplan|regie|animatik)\b/i,
    text: `STORYBOARD / DIRECTING
- In Plan mode, inspect the current timeline and storyboard first, then create or revise only storyboard plans, scene cards, evidence, coverage, decisions, templates, and generation briefs.
- Keep scene identity stable. Use the storyboard semantic tools instead of ordinary timeline/media mutation tools.
- Preparing a generation brief is allowed; submitting a provider job, importing paid output, editing real media, or exporting is not. Describe prepared work honestly as planned, never completed.
- When the decision policy requires a pause, present durable alternatives with the evidence, expected trade-off, and affected base fingerprint. Do not choose or replay an old option implicitly.
- Verify the resulting storyboard state and report blocked or incomplete scenes explicitly.`,
  },
  {
    id: 'motion',
    matches: /\b(?:motion design|motion graphics?|shape|replicator|lower third|title card|bauchbinde|grafik(?:en)?|formen?)\b/i,
    text: `MOTION DESIGN
- Inspect getMotionCapabilities before assuming a primitive, appearance, property, layout, or instance limit is available. Read getMotionDesign before using clip-specific appearance ids.
- Use createMotionShapeClip for native editable rectangle, ellipse, polygon, or star layers. Use updateMotionAppearances for ordered color fills, strokes, linear/radial gradients, visibility, opacity, and advertised blend modes; use updateMotionProperties only for returned property paths, configureMotionReplicator for Grid, Linear, or Radial layout, and editMotionModifier for one flat modifier or falloff mutation with the current stack revision.
- Use the existing text tools for editable words layered with motion shapes. Creation returns stable clip/appearance ids needed by dependent calls.
- Author animation with one atomic addKeyframe sequence: entrance = off-frame/transparent to settled; exit = reverse near clip end; overshoot = start, pass the target, then settle; stagger sibling clips by 0.05-0.15s; hold a value by repeating it at two different times before the change.
- Emit all independent construction calls together so the editor applies them as one atomic transaction. Use executeBatch when later actions consume an earlier action result with {"$batchResult":{"action":0,"path":"clipId"}}; then verify representative frames. Never claim texture fills, modifiers, falloffs, nulls, groups, or adjustment layers before their capability response says they are supported.`,
  },
  {
    id: 'text',
    matches: /\b(?:text|title|typography|kinetic|schrift|titel|textanimation|bauchbinde|lower third)\b/i,
    text: `TEXT / TITLES
- Prefer createEditableTitleStack when the requested design is one or more editable text rows with backplates; it allocates separate topmost-first tracks, converts coordinates, and creates the entire stack atomically. Use createTextClip for standalone editable text.
- Text boxes use top-left composition pixels. Motion x/y use centered composition pixels. If building manually, convert a box to a centered shape with shapeX = boxX + boxWidth/2 - compositionWidth/2 and shapeY = boxY + boxHeight/2 - compositionHeight/2.
- Put every simultaneously visible text or backplate layer on its own video track. If there are not enough tracks, create them first and re-read the timeline for their generated IDs before creating the clips.
- Use the returned clipId for dependent calls. Use updateTextProperties for content/style and setTextBox for area-text position/size.
- Animate layer position, scale, rotation, or opacity with addKeyframe. Animate the text field itself with addTextBoundsKeyframe at clip-local times.
- Treat an automatic post-edit preview as the first valid visual check and do not recapture the same time unless it reveals a problem. Verify the finished title at representative times with one getFramesAtTimes call and adjust any off-frame or unreadable result.`,
  },
  {
    id: 'montage',
    matches: /\b(?:montage|random|shuffle|zusammenschnitt|highlight|best of|cuts?|clips?|segmente?)\b/i,
    text: `MONTAGE / MANY CUTS
- Inspect sources and durations first. getMediaItems is one-folder-only; recurse into returned folders.
- Build source montages with <=25 addClipSegment actions per executeBatch. Use video sources, clamp source ranges, and place slices sequentially.
- For split-and-shuffle, splitClipAtTimes first, re-read the timeline for new IDs, then reorderClips. Splitting alone does not create variety.
- Video slices may create linked audio. Keep or remove it intentionally and report the choice.`,
  },
  {
    id: 'transcript',
    matches: /\b(?:transcript|subtitle|speech|speak(?:s|ing)?|talk(?:s|ing)?|sentence|word|phrase|dialog|untertitel|transkript|spricht|satz|w[oö]rter?)\b/i,
    text: `TRANSCRIPT
- Read long transcripts in bounded source-time windows with getClipTranscript(sourceStart, sourceEnd, offset, limit); follow nextOffset while hasMore is true.
- Transcript timestamps are source time. Use getClipDetails before converting them for timeline editing.
- A transcript remix is not finished after splitting: re-read generated clip IDs, reorder wanted pieces, and remove unwanted pieces.`,
  },
  {
    id: 'face',
    matches: /\b(?:face|person|people|speaker|gesicht|person|menschen?)\b/i,
    text: `FACE / PERSON
- Call getClipFaceAnalysis before starting new analysis. If it is still analyzing, report progress and stop this turn.
- Resolve visible labels through personId; never invent internal IDs.
- For keep-only edits, use keepOnlyCutPlan.recommendedToolCall unchanged. Correct identity groups before editing when review data is ambiguous.`,
  },
  {
    id: 'silence',
    matches: /\b(?:silence|silent|pauses?|dead air|(?:no one|nobody)(?: is)? (?:speak(?:s|ing)?|talk(?:s|ing)?)|not (?:speaking|talking)|non-speaking|no (?:dialogue|dialog|speech)|without (?:dialogue|dialog|speech)|stille|pausen?|(?:wo|wenn) niemand spricht|ohne (?:sprache|dialog))\b/i,
    text: `SILENCE
- For "nobody speaking" or speech-gap requests, use getClipTranscript (paginate if needed) plus getClipDetails to derive the non-speech timeline gaps. Prefer this route when background sound may continue under the gaps.
- For audio-level silence or dead-air requests, call findSilentSections once and inspect its mapped timeline ranges.
- Remove all accepted ranges with one cutRangesFromClip call.
- Preserve linked audio unless the user explicitly wants only one side changed.`,
  },
  {
    id: 'quality',
    matches: /\b(?:blurry|blur|dark|shaky|quality|focus|motion|brightness|unscharf|dunkel|verwackelt|qualit[aä]t)\b/i,
    text: `ANALYSIS / QUALITY
- Start with compact getClipAnalysis. Request includeFrames only for a bounded source range that needs inspection.
- Use findLowQualitySections for threshold-based edits, then remove accepted ranges in bulk.`,
  },
  {
    id: 'visual',
    matches: /\b(?:look|visual(?:ly)?|frame|scene|shot|preview|sieht|visuell(?:e|en|er|es)?|bild|szene|einstellung|vorschau)\b/i,
    text: `VISUAL VERIFICATION
- Sample 3-8 relevant frames in one getFramesAtTimes call before making content claims.
- After a visual edit, verify with captureFrame, getFramesAtTimes, or getCutPreviewQuad. Transcript text is not visual evidence.`,
  },
  {
    id: 'analysis',
    matches: /\b(?:analyse|analysis|analyze|analysier|motion|bewegung)\b/i,
    text: `ANALYSIS
- Prefer summaries first. Query detailed frames only for a bounded source range and with an explicit limit.
- Treat returned measurements as evidence; do not infer unseen action between samples.`,
  },
];

export function selectFlashBoardChatPlaybooks(prompt: string): FlashBoardChatPlaybookId[] {
  return PLAYBOOKS
    .filter((playbook) => playbook.matches.test(prompt))
    .map((playbook) => playbook.id);
}

export function buildFlashBoardChatPlaybookInjection(prompt: string): string {
  const selected = new Set(selectFlashBoardChatPlaybooks(prompt));
  return PLAYBOOKS
    .filter((playbook) => selected.has(playbook.id))
    .map((playbook) => playbook.text)
    .join('\n\n');
}
