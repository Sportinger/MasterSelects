export interface ProjectDirtyTrace {
  sequence: number;
  timestamp: number;
  source: 'fsa-core' | 'native-core';
  projectOpen: boolean;
  wasDirty: boolean;
  stack: string[];
}

interface ProjectDirtyDiagnosticState {
  nextSequence: number;
  traces: ProjectDirtyTrace[];
}

const MAX_PROJECT_DIRTY_TRACES = 24;
const state = (import.meta.hot?.data?.projectDirtyDiagnosticState as ProjectDirtyDiagnosticState | undefined)
  ?? { nextSequence: 1, traces: [] };

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.projectDirtyDiagnosticState = state;
  });
  import.meta.hot.accept();
}

export function recordProjectDirtyMark(
  source: ProjectDirtyTrace['source'],
  projectOpen: boolean,
  wasDirty: boolean,
): void {
  if (!import.meta.env.DEV) return;
  const errorConstructor = Error as ErrorConstructor & { stackTraceLimit?: number };
  const previousStackTraceLimit = errorConstructor.stackTraceLimit;
  let rawStack: string | undefined;
  try {
    errorConstructor.stackTraceLimit = 32;
    rawStack = new Error('Project marked dirty').stack;
  } finally {
    errorConstructor.stackTraceLimit = previousStackTraceLimit;
  }
  const stack = rawStack
    ?.split('\n')
    .slice(1, 24)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  state.traces.push({
    sequence: state.nextSequence++,
    timestamp: Date.now(),
    source,
    projectOpen,
    wasDirty,
    stack,
  });
  if (state.traces.length > MAX_PROJECT_DIRTY_TRACES) state.traces.shift();
}

export function readProjectDirtyTraces(): ProjectDirtyTrace[] {
  return state.traces.map((trace) => ({ ...trace, stack: [...trace.stack] }));
}

export function clearProjectDirtyTraces(): void {
  state.traces.length = 0;
}
