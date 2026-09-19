import {
  parseSeedanceOrchestrationEvent,
  parseSeedanceOrchestrationRun,
  type SeedanceStoryPreferences,
  type SeedanceOrchestrationEvent,
  type SeedanceOrchestrationPhase,
  type SeedanceOrchestrationPublicRun,
} from './orchestrationContracts';

interface SeedanceEventBatch {
  events: SeedanceOrchestrationEvent[];
  nextSequence: number;
  phase?: SeedanceOrchestrationPhase;
}

const PHASES = new Set<SeedanceOrchestrationPhase>([
  'initializing', 'ideating', 'reviewing', 'synthesizing', 'awaiting-selection',
  'writing-story', 'planning-scenes', 'reviewing-media', 'completed', 'failed', 'cancelled',
]);

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

async function assertResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const payload = await responsePayload(response);
  const message = payload && typeof payload === 'object' && 'error' in payload
    ? String((payload as { error: unknown }).error)
    : `Story orchestration failed with HTTP ${response.status}.`;
  throw new Error(message);
}

export async function startSeedanceOrchestration(input: {
  runId: string;
  prompt: string;
  sourceBundleId: string;
  preferences: SeedanceStoryPreferences;
  signal?: AbortSignal;
}): Promise<SeedanceOrchestrationPublicRun> {
  const response = await assertResponse(await fetch('/api/kernel/preproduction/seedance/runs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      runId: input.runId,
      prompt: input.prompt,
      sourceBundleId: input.sourceBundleId,
      preferences: input.preferences,
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }));
  return parseSeedanceOrchestrationRun(await responsePayload(response));
}

export async function getSeedanceOrchestrationRun(
  runId: string,
  signal?: AbortSignal,
): Promise<SeedanceOrchestrationPublicRun> {
  const response = await assertResponse(await fetch(
    `/api/kernel/preproduction/seedance/runs/${encodeURIComponent(runId)}`,
    {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    },
  ));
  return parseSeedanceOrchestrationRun(await responsePayload(response));
}

export async function selectSeedanceOrchestrationConcept(input: {
  runId: string;
  selectedConceptId: string;
  signal?: AbortSignal;
}): Promise<SeedanceOrchestrationPublicRun> {
  const response = await assertResponse(await fetch(
    `/api/kernel/preproduction/seedance/runs/${encodeURIComponent(input.runId)}/selection`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, selectedConceptId: input.selectedConceptId }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  ));
  return parseSeedanceOrchestrationRun(await responsePayload(response));
}

export async function cancelSeedanceOrchestration(
  runId: string,
  signal?: AbortSignal,
): Promise<SeedanceOrchestrationPublicRun> {
  const response = await assertResponse(await fetch(
    `/api/kernel/preproduction/seedance/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    },
  ));
  return parseSeedanceOrchestrationRun(await responsePayload(response));
}

export async function resumeSeedanceOrchestration(
  runId: string,
  signal?: AbortSignal,
): Promise<SeedanceOrchestrationPublicRun> {
  const response = await assertResponse(await fetch(
    `/api/kernel/preproduction/seedance/runs/${encodeURIComponent(runId)}/resume`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    },
  ));
  return parseSeedanceOrchestrationRun(await responsePayload(response));
}

function parseEventStream(value: string): SeedanceOrchestrationEvent[] {
  return value.split(/\n\n/gu).flatMap((block) => {
    const data = block.split(/\n/gu)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return [];
    try {
      return [parseSeedanceOrchestrationEvent(JSON.parse(data) as unknown)];
    } catch (error) {
      throw new Error(
        `The Story event stream is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export async function readSeedanceOrchestrationEvents(input: {
  runId: string;
  afterSequence: number;
  sceneId?: string;
  signal?: AbortSignal;
}): Promise<SeedanceEventBatch> {
  const query = new URLSearchParams({ after: String(input.afterSequence), limit: '500' });
  if (input.sceneId) query.set('sceneId', input.sceneId);
  const response = await assertResponse(await fetch(
    `/api/kernel/preproduction/seedance/runs/${encodeURIComponent(input.runId)}/events?${query}`,
    {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  ));
  const nextSequence = Number(response.headers.get('X-Seedance-Next-Sequence') ?? input.afterSequence);
  const phaseHeader = response.headers.get('X-Seedance-Phase');
  const phase = PHASES.has(phaseHeader as SeedanceOrchestrationPhase)
    ? phaseHeader as SeedanceOrchestrationPhase
    : undefined;
  return {
    events: parseEventStream(await response.text()),
    nextSequence: Number.isSafeInteger(nextSequence) ? nextSequence : input.afterSequence,
    ...(phase === undefined ? {} : { phase }),
  };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

export async function followSeedanceOrchestration(input: {
  runId: string;
  afterSequence: number;
  stopPhases: ReadonlySet<SeedanceOrchestrationPhase>;
  signal: AbortSignal;
  onEvents(events: SeedanceOrchestrationEvent[], nextSequence: number): void;
  onSnapshot?(run: SeedanceOrchestrationPublicRun): void;
}): Promise<SeedanceOrchestrationPublicRun> {
  let cursor = input.afterSequence;
  let emptyBatches = 0;
  while (true) {
    input.signal.throwIfAborted();
    const batch = await readSeedanceOrchestrationEvents({
      runId: input.runId,
      afterSequence: cursor,
      signal: input.signal,
    });
    if (batch.events.length > 0) {
      cursor = Math.max(cursor, batch.nextSequence);
      emptyBatches = 0;
      input.onEvents(batch.events, cursor);
    } else {
      emptyBatches += 1;
    }
    if (batch.phase !== undefined && input.stopPhases.has(batch.phase)) {
      const run = await getSeedanceOrchestrationRun(input.runId, input.signal);
      input.onSnapshot?.(run);
      return run;
    }
    if (emptyBatches >= 8) {
      const run = await getSeedanceOrchestrationRun(input.runId, input.signal);
      input.onSnapshot?.(run);
      emptyBatches = 0;
      if (input.stopPhases.has(run.phase)) return run;
    }
    await delay(batch.events.length > 0 ? 80 : 350, input.signal);
  }
}

export async function followSeedanceSceneOrchestration(input: {
  runId: string;
  sceneId: string;
  afterSequence: number;
  signal: AbortSignal;
  onEvents(events: SeedanceOrchestrationEvent[], nextSequence: number): void;
}): Promise<void> {
  let cursor = input.afterSequence;
  const terminal = new Set<SeedanceOrchestrationPhase>([
    'reviewing-media', 'completed', 'failed', 'cancelled',
  ]);
  while (true) {
    input.signal.throwIfAborted();
    const batch = await readSeedanceOrchestrationEvents({
      runId: input.runId,
      sceneId: input.sceneId,
      afterSequence: cursor,
      signal: input.signal,
    });
    if (batch.events.length > 0) {
      cursor = Math.max(cursor, batch.nextSequence);
      input.onEvents(batch.events, cursor);
    }
    if (batch.phase !== undefined && terminal.has(batch.phase)) return;
    await delay(batch.events.length > 0 ? 80 : 350, input.signal);
  }
}
