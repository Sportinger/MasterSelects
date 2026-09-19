import type { ToolResult } from '../types';

const DEFAULT_CLICK_SELECTOR = [
  'button',
  '[role="button"]',
  'summary',
  'a[href]',
  'input[type="button"]',
  'input[type="submit"]',
].join(',');

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key/iu;

function boundedInteger(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function elementLabel(element: Element): string {
  if (element instanceof HTMLInputElement) {
    return element.getAttribute('aria-label') || element.value || '';
  }
  return element.getAttribute('aria-label') || element.textContent || '';
}

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && (style.opacity === '' || Number(style.opacity) !== 0)
    && rect.width > 0
    && rect.height > 0;
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true'
    || ('disabled' in element && (element as HTMLButtonElement).disabled === true);
}

function elementSummary(element: HTMLElement): Record<string, unknown> {
  const rect = element.getBoundingClientRect();
  return {
    ariaLabel: element.getAttribute('aria-label'),
    className: element.className || null,
    id: element.id || null,
    tagName: element.tagName.toLocaleLowerCase(),
    text: elementLabel(element).replace(/\s+/gu, ' ').trim().slice(0, 300),
    rect: {
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
    },
  };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function summarizeFrameSamples(samples: number[]) {
  const sorted = samples.toSorted((left, right) => left - right);
  const percentile = (ratio: number) => sorted[Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  )] ?? 0;
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: samples.length ? Number((total / samples.length).toFixed(2)) : 0,
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    p99Ms: Number(percentile(0.99).toFixed(2)),
    over25Ms: samples.filter(value => value > 25).length,
    over50Ms: samples.filter(value => value > 50).length,
    sampleCount: samples.length,
  };
}

export async function handleProfileAppInteraction(args: Record<string, unknown>): Promise<ToolResult> {
  const mode = args.mode === 'circle-pan' ? 'circle-pan' : args.mode === 'idle' ? 'idle' : null;
  if (!mode) return { success: false, error: 'mode must be idle or circle-pan.' };
  const durationMs = boundedNumber(args.durationMs, 5_000, 500, 10_000);
  const index = boundedInteger(args.index, 0, 100);
  const selector = typeof args.selector === 'string' ? args.selector.trim().slice(0, 500) : '';
  const radiusPx = boundedNumber(args.radiusPx, 90, 4, 500);
  const rotations = boundedNumber(args.rotations, 5, 0.25, 20);

  let target: HTMLElement | null = null;
  if (mode === 'circle-pan') {
    if (!selector) return { success: false, error: 'selector is required for circle-pan.' };
    try {
      target = [...document.querySelectorAll(selector)].filter(isVisible)[index] ?? null;
    } catch {
      return { success: false, error: 'The CSS selector is invalid.' };
    }
    if (!target) {
      const visibleCanvasLike = [...document.querySelectorAll('canvas,[class*="canvas"]')]
        .filter(isVisible)
        .slice(0, 30)
        .map(elementSummary);
      return {
        success: false,
        error: 'No visible gesture target matched the selector.',
        data: { selector, visibleCanvasLike },
      };
    }
  }

  const frameSamples: number[] = [];
  const frameSpikes: Array<{ atMs: number; gapMs: number }> = [];
  const dispatchSamples: number[] = [];
  const longTasks: Array<{ atMs: number; durationMs: number }> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  const startedAt = performance.now();
  if (typeof PerformanceObserver !== 'undefined') {
    const entryTypes = ['longtask', 'long-animation-frame'].filter(
      entryType => PerformanceObserver.supportedEntryTypes?.includes(entryType),
    );
    if (entryTypes.length > 0) {
    observer = new PerformanceObserver((list) => {
      list.getEntries().forEach(entry => {
        if (entry.entryType === 'longtask') {
          longTasks.push({
            atMs: Number((entry.startTime - startedAt).toFixed(2)),
            durationMs: Number(entry.duration.toFixed(2)),
          });
          return;
        }
        const animationFrame = entry as PerformanceEntry & {
          blockingDuration?: number;
          renderStart?: number;
          scripts?: Array<{
            duration?: number;
            forcedStyleAndLayoutDuration?: number;
            functionName?: string;
            invoker?: string;
            invokerType?: string;
            sourceURL?: string;
          }>;
        };
        longAnimationFrames.push({
          atMs: Number((entry.startTime - startedAt).toFixed(2)),
          blockingDurationMs: Number((animationFrame.blockingDuration ?? 0).toFixed(2)),
          durationMs: Number(entry.duration.toFixed(2)),
          renderStartMs: Number(((animationFrame.renderStart ?? entry.startTime) - startedAt).toFixed(2)),
          scripts: (animationFrame.scripts ?? []).slice(0, 12).map(script => ({
            durationMs: Number((script.duration ?? 0).toFixed(2)),
            forcedStyleAndLayoutDurationMs: Number(
              (script.forcedStyleAndLayoutDuration ?? 0).toFixed(2),
            ),
            functionName: script.functionName || null,
            invoker: script.invoker || null,
            invokerType: script.invokerType || null,
            sourceURL: script.sourceURL || null,
          })),
        });
      });
    });
    observer.observe({ entryTypes });
    }
  }

  const pointerId = 9137;
  const rect = target?.getBoundingClientRect();
  const radius = rect
    ? Math.min(radiusPx, Math.max(4, rect.width * 0.25), Math.max(4, rect.height * 0.25))
    : 0;
  const centerX = rect ? rect.left + rect.width / 2 : 0;
  const centerY = rect ? rect.top + rect.height / 2 : 0;
  const startX = centerX + radius;
  const startY = centerY;
  const pointerEvent = (type: string, clientX: number, clientY: number) => new PointerEvent(type, {
    bubbles: true,
    button: type === 'pointermove' ? -1 : 1,
    buttons: type === 'pointerup' ? 0 : 4,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: 'mouse',
  });

  try {
    if (target) target.dispatchEvent(pointerEvent('pointerdown', startX, startY));
    await new Promise<void>((resolve) => {
      let previousFrameAt: number | null = null;
      const sampleFrame = (now: number) => {
        const elapsed = now - startedAt;
        if (previousFrameAt !== null) {
          const gap = now - previousFrameAt;
          frameSamples.push(gap);
          if (gap > 25 && frameSpikes.length < 100) {
            frameSpikes.push({ atMs: Number(elapsed.toFixed(2)), gapMs: Number(gap.toFixed(2)) });
          }
        }
        previousFrameAt = now;

        if (target) {
          const angle = Math.PI * 2 * rotations * Math.min(1, elapsed / durationMs);
          const dispatchStartedAt = performance.now();
          window.dispatchEvent(pointerEvent(
            'pointermove',
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius,
          ));
          dispatchSamples.push(performance.now() - dispatchStartedAt);
        }

        if (elapsed < durationMs) requestAnimationFrame(sampleFrame);
        else resolve();
      };
      requestAnimationFrame(sampleFrame);
    });
  } finally {
    if (target) window.dispatchEvent(pointerEvent('pointerup', startX, startY));
    observer?.disconnect();
  }

  const actualDurationMs = performance.now() - startedAt;
  return {
    success: true,
    data: {
      actualDurationMs: Number(actualDurationMs.toFixed(2)),
      dispatch: summarizeFrameSamples(dispatchSamples),
      frameRate: Number((frameSamples.length * 1_000 / Math.max(1, actualDurationMs)).toFixed(2)),
      frames: summarizeFrameSamples(frameSamples),
      frameSpikes,
      longAnimationFrames,
      longTasks,
      mode,
      radiusPx: radius,
      rotations: mode === 'circle-pan' ? rotations : 0,
      target: target ? elementSummary(target) : null,
    },
  };
}

export async function handleClickAppControl(args: Record<string, unknown>): Promise<ToolResult> {
  const selector = typeof args.selector === 'string' && args.selector.trim()
    ? args.selector.trim().slice(0, 500)
    : DEFAULT_CLICK_SELECTOR;
  const requestedText = typeof args.text === 'string' ? normalizedText(args.text) : '';
  const match = args.match === 'contains' ? 'contains' : 'exact';
  const index = boundedInteger(args.index, 0, 100);
  const settleMs = boundedInteger(args.settleMs, 500, 30_000);
  if (!requestedText && selector === DEFAULT_CLICK_SELECTOR) {
    return { success: false, error: 'Provide text or a specific CSS selector.' };
  }

  let candidates: HTMLElement[];
  try {
    candidates = [...document.querySelectorAll(selector)].filter(isVisible);
  } catch {
    return { success: false, error: 'The CSS selector is invalid.' };
  }
  if (requestedText) {
    candidates = candidates.filter((element) => {
      const label = normalizedText(elementLabel(element));
      return match === 'contains' ? label.includes(requestedText) : label === requestedText;
    });
  }
  const target = candidates[index];
  if (!target) {
    return {
      success: false,
      error: 'No visible app control matched the requested selector and text.',
      data: { candidateCount: candidates.length, index, match, selector, text: requestedText || null },
    };
  }
  if (isDisabled(target)) {
    return { success: false, error: 'The matched app control is disabled.', data: elementSummary(target) };
  }

  const clicked = elementSummary(target);
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.click();
  if (settleMs > 0) await new Promise((resolve) => window.setTimeout(resolve, settleMs));
  return {
    success: true,
    data: {
      clicked,
      matchedCount: candidates.length,
      page: { title: document.title, url: window.location.href },
      settleMs,
    },
  };
}

export async function handleFillAppControl(args: Record<string, unknown>): Promise<ToolResult> {
  const selector = typeof args.selector === 'string' ? args.selector.trim().slice(0, 500) : '';
  const value = typeof args.value === 'string' ? args.value.slice(0, 20_000) : undefined;
  const index = boundedInteger(args.index, 0, 100);
  const settleMs = boundedInteger(args.settleMs, 250, 30_000);
  if (!selector || value === undefined) {
    return { success: false, error: 'Provide a CSS selector and string value.' };
  }

  let candidates: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  try {
    candidates = [...document.querySelectorAll(selector)].filter((
      element,
    ): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => (
      (element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement)
      && isVisible(element)
    ));
  } catch {
    return { success: false, error: 'The CSS selector is invalid.' };
  }
  const target = candidates[index];
  if (!target) {
    return {
      success: false,
      error: 'No visible form control matched the requested selector.',
      data: { candidateCount: candidates.length, index, selector },
    };
  }
  const readOnly = !(target instanceof HTMLSelectElement) && target.readOnly;
  if (isDisabled(target) || readOnly) {
    return {
      success: false,
      error: 'The matched form control is disabled or read-only.',
      data: { ...elementSummary(target), disabled: target.disabled, readOnly },
    };
  }

  const prototype = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : target instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!valueSetter) return { success: false, error: 'The matched form control cannot be filled.' };
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.focus();
  valueSetter.call(target, value);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  if (settleMs > 0) await new Promise((resolve) => window.setTimeout(resolve, settleMs));
  return {
    success: true,
    data: {
      filled: elementSummary(target),
      matchedCount: candidates.length,
      page: { title: document.title, url: window.location.href },
      settleMs,
      valueLength: value.length,
    },
  };
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactJson(item, depth + 1));
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 4_000 ? `${value.slice(0, 4_000)}...` : value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => (
    [key, SENSITIVE_KEY.test(key) ? '[redacted]' : redactJson(item, depth + 1)]
  )));
}

function htmlErrorSummary(html: string): Record<string, string | null> {
  const parsed = new DOMParser().parseFromString(html.slice(0, 100_000), 'text/html');
  const textFrom = (selector: string, maximum: number): string | null => {
    const value = parsed.querySelector(selector)?.textContent?.replace(/\s+/gu, ' ').trim();
    return value ? value.slice(0, maximum) : null;
  };
  return {
    errorName: textFrom('#error-name', 500),
    errorTitle: textFrom('#error-title', 1_000),
    hint: textFrom('#error-hint', 2_000),
    message: textFrom('#error-message', 4_000),
    stack: textFrom('#stack-frames-raw', 8_000) || textFrom('#stack-frames', 8_000),
    title: parsed.title?.slice(0, 500) || null,
  };
}

export async function handleProbeSameOriginRequest(args: Record<string, unknown>): Promise<ToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path.startsWith('/api/') || path.length > 1_000) {
    return { success: false, error: 'path must be a same-origin /api/ URL.' };
  }
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    return { success: false, error: 'Cross-origin request probes are not allowed.' };
  }
  const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    return { success: false, error: 'method must be GET, HEAD, or POST.' };
  }
  const timeoutMs = boundedInteger(args.timeoutMs, 20_000, 60_000);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = method === 'POST' && args.body !== undefined
      ? JSON.stringify(args.body)
      : undefined;
    if (body && body.length > 20_000) return { success: false, error: 'Probe request body is too large.' };
    const startedAt = performance.now();
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      method,
      signal: controller.signal,
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let responseBody: unknown = text.slice(0, 20_000);
    if (contentType.includes('application/json')) {
      try {
        responseBody = redactJson(JSON.parse(text.slice(0, 100_000)) as unknown);
      } catch {
        responseBody = text.slice(0, 20_000);
      }
    } else if (contentType.includes('text/html')) {
      responseBody = htmlErrorSummary(text);
    }
    return {
      success: true,
      data: {
        body: responseBody,
        durationMs: Math.round(performance.now() - startedAt),
        headers: {
          contentLength: response.headers.get('content-length'),
          contentType: response.headers.get('content-type'),
          requestId: response.headers.get('x-request-id'),
          retryAfter: response.headers.get('retry-after'),
        },
        method,
        ok: response.ok,
        path: `${url.pathname}${url.search}`,
        status: response.status,
        statusText: response.statusText,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Same-origin request probe failed.',
      data: { method, path, timeoutMs },
    };
  } finally {
    window.clearTimeout(timer);
  }
}
