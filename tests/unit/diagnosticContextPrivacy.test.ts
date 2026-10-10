import { afterEach, describe, expect, it } from 'vitest';
import { collectDiagnosticContext } from '../../src/services/diagnostics/diagnosticContext';

describe('diagnostic context', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('records the page path without campaign query strings or fragments', () => {
    window.history.replaceState(null, '', '/editor?utm_source=ig&fbclid=PAZX#panel');
    const context = collectDiagnosticContext();
    expect(context.pageUrl).toBe('/editor');
    expect(JSON.stringify(context)).not.toContain('fbclid');
  });

  it('carries no source commit outside a production build', () => {
    const context = collectDiagnosticContext();
    expect(context.sourceRevision).toBeNull();
    expect(context.releaseId).toBeNull();
  });
});
