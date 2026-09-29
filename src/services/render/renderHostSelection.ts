export type RenderHostSelectionId = 'main-fallback' | 'worker-primary';
export type RenderHostSelectionRole = 'fallback' | 'primary';

export interface RenderHostSelectionTelemetry {
  readonly selectedId: RenderHostSelectionId;
  readonly selectedRole: RenderHostSelectionRole;
  readonly workerPrimaryRequested: boolean;
  readonly workerPrimaryRegistered: boolean;
  readonly workerPrimaryAvailable: boolean;
  readonly blockers: readonly string[];
  readonly reason: string;
}

export interface RenderHostSelection<T> {
  readonly host: T;
  readonly telemetry: RenderHostSelectionTelemetry;
}

export interface SelectRenderHostOptions<T> {
  readonly mainFallback: T;
  readonly workerPrimary?: T | null;
  readonly preferWorkerPrimary: boolean;
  readonly workerPrimaryAvailable?: boolean;
  readonly workerPrimaryBlockers?: readonly string[];
  readonly allowMainFallback?: boolean;
}

function normalizeBlockers(blockers: readonly string[] | undefined): readonly string[] {
  return blockers?.filter((blocker) => blocker.trim().length > 0) ?? [];
}

function fallbackTelemetry(input: {
  readonly requested: boolean;
  readonly registered: boolean;
  readonly available: boolean;
  readonly blockers: readonly string[];
}): RenderHostSelectionTelemetry {
  const blockers = input.blockers.length > 0
    ? input.blockers
    : input.requested
      ? ['worker render host unavailable']
      : ['worker render host flag disabled'];
  return {
    selectedId: 'main-fallback',
    selectedRole: 'fallback',
    workerPrimaryRequested: input.requested,
    workerPrimaryRegistered: input.registered,
    workerPrimaryAvailable: input.available,
    blockers,
    reason: `using main fallback: ${blockers.join('; ')}`,
  };
}

export function selectRenderHost<T>(options: SelectRenderHostOptions<T>): RenderHostSelection<T> {
  const workerPrimaryRegistered = Boolean(options.workerPrimary);
  const workerPrimaryAvailable = workerPrimaryRegistered && options.workerPrimaryAvailable === true;
  const explicitBlockers = normalizeBlockers(options.workerPrimaryBlockers);

  if (options.allowMainFallback === false && !workerPrimaryAvailable) {
    if (!options.workerPrimary) throw new Error('Worker render host unavailable; main fallback is disabled');
    return {
      host: options.workerPrimary,
      telemetry: {
        selectedId: 'worker-primary', selectedRole: 'primary',
        workerPrimaryRequested: true, workerPrimaryRegistered: true, workerPrimaryAvailable: false,
        blockers: explicitBlockers.length ? explicitBlockers : ['worker render host unavailable'],
        reason: 'worker unavailable; main fallback is disabled',
      },
    };
  }

  if ((options.preferWorkerPrimary || options.allowMainFallback === false) && workerPrimaryAvailable && options.workerPrimary) {
    return {
      host: options.workerPrimary,
      telemetry: {
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      },
    };
  }

  const blockers = [
    ...(!options.preferWorkerPrimary ? ['worker render host flag disabled'] : []),
    ...(!workerPrimaryRegistered ? ['worker render host implementation not registered'] : []),
    ...(options.preferWorkerPrimary && workerPrimaryRegistered && !workerPrimaryAvailable
      ? explicitBlockers.length > 0
        ? explicitBlockers
        : ['worker render host unavailable']
      : []),
  ];

  return {
    host: options.mainFallback,
    telemetry: fallbackTelemetry({
      requested: options.preferWorkerPrimary,
      registered: workerPrimaryRegistered,
      available: workerPrimaryAvailable,
      blockers,
    }),
  };
}
