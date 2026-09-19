import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('AI Studio chat layout', () => {
  it('lets chat history start directly below the workspace tabs', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/panels/ai-studio/AIStudioChat.css'),
      'utf8',
    );
    const historyRule = css.match(/\.ai-studio-chat-history\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(historyRule).toContain('padding: 8px 12px 12px');
    expect(historyRule).not.toMatch(/padding:\s*(?:6[0-9]|[7-9][0-9])px/);
  });
});
