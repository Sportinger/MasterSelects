import { describe, expect, it } from 'vitest';
import {
  buildFlashBoardChatSystemPrompt,
  FLASHBOARD_CHAT_SYSTEM_PROMPT,
} from '../../src/services/flashboard/FlashBoardChatService';

// These tests pin the "prompt harness" invariants for the in-app FlashBoard chat agent.
// Each assertion guards a piece of guidance whose removal reintroduces a known failure
// mode (the agent giving up on "make 30 cuts" because it did not know about
// executeBatch / addClipSegment / the per-turn tool-step budget).

describe('FlashBoard chat harness prompt', () => {
  const prompt = buildFlashBoardChatSystemPrompt();

  it('builds without a live timeline store and stays substantial', () => {
    expect(typeof prompt).toBe('string');
    // A rich harness, not the old 9-sentence stub.
    expect(prompt.length).toBeGreaterThan(1500);
  });

  it('tells the agent not to refuse or downscope tool-expressible work', () => {
    expect(prompt).toMatch(/never refuse or silently downscope/i);
  });

  it('allows an edited base prompt while keeping live context appended', () => {
    const customPrompt = buildFlashBoardChatSystemPrompt('Custom compact editor prompt.');

    expect(customPrompt).toContain('Custom compact editor prompt.');
    expect(customPrompt).toContain('Current MasterSelects context:');
    expect(customPrompt).not.toContain(FLASHBOARD_CHAT_SYSTEM_PROMPT.slice(0, 80));
  });

  it('can omit the live MasterSelects context for saved system prompts', () => {
    const customPrompt = buildFlashBoardChatSystemPrompt('Custom compact editor prompt.', { includeContext: false });

    expect(customPrompt).toBe('Custom compact editor prompt.');
    expect(customPrompt).not.toContain('Current MasterSelects context:');
  });

  it('teaches the tool-step budget and batching as the bulk mechanism', () => {
    expect(prompt).toMatch(/tool calls per turn/i);
    expect(prompt).toContain('executeBatch');
    // Bulk tools that collapse N edits into one call.
    for (const tool of ['splitClipEvenly', 'splitClipAtTimes', 'cutRangesFromClip', 'reorderClips', 'deleteClips']) {
      expect(prompt).toContain(tool);
    }
  });

  it('documents addClipSegment as the way to build montages from slices', () => {
    expect(prompt).toContain('addClipSegment');
    expect(prompt).toMatch(/time-slice/i);
  });

  it('contains the random / N-cut montage recipe wired to a single batch', () => {
    expect(prompt).toMatch(/N-cut montage/i);
    // The recipe must steer toward one batch of addClipSegment, not whole-clip imports.
    const recipeRegion = prompt.slice(prompt.indexOf('N-cut montage'));
    expect(recipeRegion).toContain('executeBatch');
    expect(recipeRegion).toContain('addClipSegment');
  });

  it('makes the montage recipe clamp slices to source duration and skip non-video', () => {
    const recipeRegion = prompt.slice(prompt.indexOf('N-cut montage'));
    expect(recipeRegion).toMatch(/ONLY video sources/i);
    expect(recipeRegion).toMatch(/inPoint \+ sliceLen <= duration/);
  });

  it('explains executeBatch partial-failure handling', () => {
    expect(prompt).toMatch(/reports failed if ANY single action fails/i);
    expect(prompt).toMatch(/out-of-range slice/i);
  });

  it('makes the agent account for linked audio on video cuts', () => {
    expect(prompt).toMatch(/Audio awareness/i);
    expect(prompt).toMatch(/LINKED audio clip/i);
    expect(prompt).toMatch(/deleteClips\(linkedAudioIds, withLinked:false\)/);
  });

  it('requires delivering the full requested count in one pass', () => {
    expect(prompt).toMatch(/Deliver the full requested amount in one pass/i);
    expect(prompt).toMatch(/finish the whole job/i);
  });

  it('distinguishes split-and-shuffle from assemble for true variety', () => {
    expect(prompt).toMatch(/THEN reorderClips to randomise order/);
    expect(prompt).toMatch(/splitting alone leaves the same video/i);
  });

  it('does not stop transcript remixes after merely splitting the clip', () => {
    expect(prompt).toMatch(/Transcript remix \/ funny sentence/i);
    expect(prompt).toMatch(/Transcript timestamps are SOURCE time/);
    expect(prompt).toMatch(/getClipDetails \+ getClipTranscript/);
    expect(prompt).toMatch(/splitClipAtTimes.*getTimelineState.*reorderClips/s);
    expect(prompt).toMatch(/Splitting is preparation, never completion/i);
    expect(prompt).toMatch(/dependent calls sequentially in the SAME turn/i);
  });

  it('warns that one giant batch truncates and large N must be chunked', () => {
    expect(prompt).toMatch(/2048 tokens/);
    expect(prompt).toMatch(/empty "0 steps" batch/i);
    expect(prompt).toMatch(/<=25 actions/);
  });

  it('pushes the agent to be autonomous and default parameters', () => {
    expect(prompt).toMatch(/Be autonomous/i);
    expect(prompt).toMatch(/Reusing the same few sources across many cuts is NORMAL/i);
    expect(prompt).toMatch(/never ask permission for it/i);
  });

  it('exposes the core editing recipes across the tool surface', () => {
    for (const intent of [
      'Remove silence',
      'Remove bad takes',
      'Even / rhythmic cut',
      'Crossfade',
      'Picture-in-picture',
      'Chroma key',
      'Highlight reel',
    ]) {
      expect(prompt).toContain(intent);
    }
  });

  it('instructs the agent to self-verify edits with the preview tools', () => {
    expect(prompt).toContain('getCutPreviewQuad');
    expect(prompt).toMatch(/captureFrame|getFramesAtTimes/);
    expect(prompt).toMatch(/3-8 evenly spaced frames/);
    expect(prompt).toContain('A transcript alone is not visual evidence.');
  });

  it('warns about the timeline-vs-source time and linked-clip gotchas', () => {
    expect(prompt).toMatch(/TIMELINE time/);
    expect(prompt).toMatch(/SOURCE-media time/);
    expect(prompt).toMatch(/linked video\+audio/i);
  });

  it('tells the agent to recurse subfolders and not prefix tool names', () => {
    expect(prompt).toMatch(/NOT recursive/);
    expect(prompt).toMatch(/subfolder/i);
    expect(prompt).toMatch(/never prefix them/i);
  });
});
