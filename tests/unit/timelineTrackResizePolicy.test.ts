import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('timeline track resize policy', () => {
  it('disables individual track separators without removing the main dividers', () => {
    const laneCss = readWorkspaceFile('src/components/timeline/TimelineTracksLanes.css');
    const timelineSource = readWorkspaceFile('src/components/timeline/Timeline.tsx');

    expect(laneCss).toMatch(/\.track-resize-handle\s*\{[\s\S]*?display:\s*none;/);
    expect(timelineSource).toContain('onSplitDividerPointerDown: handleSplitDividerPointerDown');
    expect(timelineSource).toContain('onTrackHeaderWidthResizeStart: handleTrackHeaderWidthResizeStart');
  });
});
