type ProfileFrame = { name: string; resourceId?: number; line?: number; column?: number };
type ProfileTrace = {
  resources: string[]; frames: ProfileFrame[];
  stacks: Array<{ parentId?: number; frameId: number }>;
  samples: Array<{ stackId?: number; timestamp: number }>;
};
type SamplingProfiler = { stop(): Promise<ProfileTrace> };

/** Opt-in, bounded local development CPU sampling; retains no trace after return. */
export async function measureJsCpuProfile(args: Record<string, unknown>) {
  const Constructor = (window as unknown as {
    Profiler?: new (options: { sampleInterval: number; maxBufferSize: number }) => SamplingProfiler;
  }).Profiler;
  if (!Constructor) return { success: false, error: 'JS sampling profiler unavailable' };
  let profiler: SamplingProfiler;
  try { profiler = new Constructor({ sampleInterval: 2, maxBufferSize: 20000 }); }
  catch (error) { return { success: false, error: String(error) }; }
  const durationMs = Math.max(500, Math.min(10000, Number(args.durationMs) || 4000));
  await new Promise(resolve => setTimeout(resolve, durationMs));
  const trace = await profiler.stop();
  const costs = trace.frames.map((frame, id) => ({
    id, name: frame.name, url: frame.resourceId === undefined ? '' : trace.resources[frame.resourceId]?.split('?')[0],
    line: frame.line, column: frame.column, selfSamples: 0, inclusiveSamples: 0,
  }));
  let activeSamples = 0;
  for (const sample of trace.samples) {
    let stackId = sample.stackId;
    if (stackId === undefined) continue;
    activeSamples++;
    const leaf = trace.stacks[stackId];
    if (leaf) costs[leaf.frameId].selfSamples++;
    const visited = new Set<number>();
    while (stackId !== undefined) {
      const stack: { parentId?: number; frameId: number } | undefined = trace.stacks[stackId];
      if (!stack) break;
      if (!visited.has(stack.frameId)) costs[stack.frameId].inclusiveSamples++;
      visited.add(stack.frameId);
      stackId = stack.parentId;
    }
  }
  return { success: true, data: {
    durationMs, samples: trace.samples.length, activeSamples,
    self: costs.toSorted((a, b) => b.selfSamples - a.selfSamples).slice(0, 35),
    inclusive: costs.toSorted((a, b) => b.inclusiveSamples - a.inclusiveSamples).slice(0, 35),
    ...(args.includeTrace === true ? { trace } : {}),
  } };
}
