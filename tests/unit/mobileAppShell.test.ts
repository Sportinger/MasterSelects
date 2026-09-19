import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MobileApp shell', () => {
  it('routes touch devices through the responsive editor without an unsupported-device warning', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/App.tsx'),
      'utf8',
    );

    expect(source).toContain('<DockContainer');
    expect(source).toContain('useEditorTouchGestures();');
    expect(source).toContain("useOverLayoutSync(initialExperience !== 'chat');");
    expect(source).not.toContain('Geht noch nicht');
    expect(source).not.toContain('Bitte Desktop nutzen');
    expect(source).not.toContain('welcome-browser-warning');
  });
});
