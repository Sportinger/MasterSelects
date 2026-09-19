import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleClickAppControl,
  handleFillAppControl,
  handleProfileAppInteraction,
  handleProbeSameOriginRequest,
} from '../../src/services/aiTools/handlers/appDebug';
import { AI_TOOLS } from '../../src/services/aiTools/definitions';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy';

function visibleRect(): DOMRect {
  return {
    bottom: 140,
    height: 40,
    left: 20,
    right: 220,
    top: 100,
    width: 200,
    x: 20,
    y: 100,
    toJSON: () => ({}),
  };
}

describe('app debug bridge tools', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers click and request probing only for explicit dev callers', () => {
    const toolNames = AI_TOOLS.map((tool) => tool.function.name);
    const handlerNames = getRegisteredToolHandlerNames();

    for (const name of [
      'clickAppControl',
      'fillAppControl',
      'probeSameOriginRequest',
      'profileAppInteraction',
    ]) {
      expect(toolNames).toContain(name);
      expect(handlerNames).toContain(name);
      expect(getToolPolicy(name)).toMatchObject({
        readOnly: false,
        requiresConfirmation: true,
        riskLevel: 'medium',
      });
      expect(checkToolAccess(name, 'devBridge').allowed).toBe(true);
      expect(checkToolAccess(name, 'console').allowed).toBe(true);
      expect(checkToolAccess(name, 'chat').allowed).toBe(false);
      expect(checkToolAccess(name, 'kernel').allowed).toBe(false);
    }
  });

  it('profiles idle browser frame timing without dispatching input', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      now += 16.67;
      window.setTimeout(() => callback(now), 0);
      return Math.round(now);
    }));

    const result = await handleProfileAppInteraction({ durationMs: 500, mode: 'idle' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      mode: 'idle',
      frameRate: expect.any(Number),
      frames: { over25Ms: 0, over50Ms: 0 },
    });
  });

  it('fills a visible controlled text field through normal input events', async () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'story-input';
    textarea.getBoundingClientRect = visibleRect;
    textarea.scrollIntoView = vi.fn();
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);
    document.body.append(textarea);

    const result = await handleFillAppControl({
      selector: '#story-input',
      settleMs: 0,
      value: 'Make a strong documentary.',
    });

    expect(result.success).toBe(true);
    expect(textarea.value).toBe('Make a strong documentary.');
    expect(onInput).toHaveBeenCalledOnce();
    expect(result.data).toMatchObject({ matchedCount: 1, valueLength: 26 });
  });

  it('selects a visible option through normal input events', async () => {
    const select = document.createElement('select');
    select.id = 'directing-mode';
    select.innerHTML = '<option value="automatic">Auto</option><option value="milestones">Guided</option>';
    select.getBoundingClientRect = visibleRect;
    select.scrollIntoView = vi.fn();
    const onChange = vi.fn();
    select.addEventListener('change', onChange);
    document.body.append(select);

    const result = await handleFillAppControl({
      selector: '#directing-mode',
      settleMs: 0,
      value: 'milestones',
    });

    expect(result.success).toBe(true);
    expect(select.value).toBe('milestones');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('clicks a visible control by exact accessible text', async () => {
    const button = document.createElement('button');
    button.textContent = 'Retry Commons search';
    button.getBoundingClientRect = visibleRect;
    button.scrollIntoView = vi.fn();
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    document.body.append(button);

    const result = await handleClickAppControl({ text: 'Retry Commons search', settleMs: 0 });

    expect(result.success).toBe(true);
    expect(onClick).toHaveBeenCalledOnce();
    expect(button.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center' });
    expect(result.data).toMatchObject({ matchedCount: 1, settleMs: 0 });
  });

  it('returns status and redacts sensitive fields from a same-origin response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'upstream failed',
      importToken: 'must-not-leak',
    }), {
      headers: { 'content-type': 'application/json' },
      status: 502,
      statusText: 'Bad Gateway',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleProbeSameOriginRequest({
      body: { limit: 4, query: 'Bundesverfassungsgericht Karlsruhe' },
      method: 'POST',
      path: '/api/media/commons/search',
      timeoutMs: 1_000,
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/api/media/commons/search', window.location.origin),
      expect.objectContaining({ credentials: 'same-origin', method: 'POST' }),
    );
    expect(result.data).toMatchObject({
      body: { error: 'upstream failed', importToken: '[redacted]' },
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    });
  });

  it('extracts the useful exception from a verbose HTML error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`<!doctype html>
      <title>An error has occurred</title>
      <h2 id="error-name">ReferenceError</h2>
      <h1 id="error-title">Worker request failed</h1>
      <div id="error-message">COMMONS_IMPORT_TOKEN is not defined</div>
      <div id="error-hint">Check the route binding.</div>
      <div id="stack-frames-raw">at searchCommons (functions/api/media/commons/search.ts:42)</div>`, {
      headers: { 'content-type': 'text/html;charset=utf-8' },
      status: 500,
    })));

    const result = await handleProbeSameOriginRequest({ path: '/api/media/commons/search' });

    expect(result.data).toMatchObject({
      body: {
        errorName: 'ReferenceError',
        errorTitle: 'Worker request failed',
        hint: 'Check the route binding.',
        message: 'COMMONS_IMPORT_TOKEN is not defined',
        stack: 'at searchCommons (functions/api/media/commons/search.ts:42)',
        title: 'An error has occurred',
      },
      status: 500,
    });
  });

  it('refuses a path that resolves outside the API prefix', async () => {
    await expect(handleProbeSameOriginRequest({ path: '/api/../private' })).resolves.toEqual({
      success: false,
      error: 'Cross-origin request probes are not allowed.',
    });
  });
});
