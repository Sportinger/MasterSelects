import { describe, expect, it } from 'vitest';
import { buildDecline } from '../../src/services/kernelClient/runReport';
import type { KernelCompileAbortReason } from '../../src/services/kernelClient/types';

/**
 * A kernel abort reason has to survive two hops: the gateway's parser has to
 * recognise it, and the report has to have user-facing copy for it. When
 * `storyOnlyModeActive` was added kernel-side, the copy landed but the parser
 * did not, so the reason was silently dropped and every decline degraded to
 * the generic "stopped before changing anything" line.
 *
 * This list is the contract. Adding a reason kernel-side without wiring both
 * hops fails here instead of in the UI.
 */
const KERNEL_ABORT_REASONS: KernelCompileAbortReason[] = [
  'notMechanicalTask',
  'storyPathNeedsProvider',
  'storyPathNeedsMoments',
  'storyOnlyModeActive',
];

const GENERIC_FALLBACK = 'The kernel stopped before changing anything.';

describe('kernel decline reason coverage', () => {
  it.each(KERNEL_ABORT_REASONS)('has dedicated copy for %s', (reason) => {
    const decline = buildDecline(reason);

    expect(decline.reason).toBe(reason);
    // A mapped reason must not fall through to the generic sentence.
    expect(decline.explanation).not.toBe(GENERIC_FALLBACK);
    expect(decline.explanation.length).toBeGreaterThan(20);
  });

  it('keeps the kernel detail available for an unmapped reason', () => {
    const decline = buildDecline('somethingNewFromTheKernel', 'raw kernel detail');

    expect(decline.explanation).toBe(GENERIC_FALLBACK);
    // The raw detail still reaches the run card, so the run stays diagnosable.
    expect(decline.detail).toBe('raw kernel detail');
  });

  it('names the story-only cause instead of blaming a missing transcript', () => {
    const storyOnly = buildDecline('storyOnlyModeActive');
    const needsMoments = buildDecline('storyPathNeedsMoments');

    expect(storyOnly.explanation).not.toMatch(/transcript/i);
    expect(storyOnly.explanation).toMatch(/story-only/i);
    expect(storyOnly.nextStep).toMatch(/KERNEL_STORY_ONLY/);
    // The genuine no-transcript case keeps its transcribe advice.
    expect(needsMoments.nextStep).toMatch(/transcribe/i);
  });
});
