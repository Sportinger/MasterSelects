// Read-only development diagnostics; never retains component props or fibers.
type Fiber = {
  child?: Fiber | null;
  sibling?: Fiber | null;
  return?: Fiber | null;
  actualDuration?: number;
  selfBaseDuration?: number;
  type?: { displayName?: string; name?: string } | string;
  stateNode?: { current?: Fiber };
  memoizedProps?: Record<string, unknown>;
  alternate?: Fiber | null;
};

export function inspectReactRenderCosts() {
  const element = document.getElementById('root')?.firstElementChild;
  if (!element) return { success: false, error: 'No mounted React root' };
  const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
  let root = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  while (root?.return) root = root.return;
  root = root?.stateNode?.current ?? root;
  if (!root) return { success: false, error: 'React development fibers unavailable' };
  const totals = new Map<string, { name: string; count: number; selfMs: number; maxMs: number }>();
  const changedTrackProps = new Map<string, number>();
  const changedTrackRowProps = new Map<string, number>();
  const visit = (fiber: Fiber) => {
    const type = fiber.type;
    const name = typeof type === 'string' ? type : type?.displayName ?? type?.name;
    if (name && typeof type !== 'string') {
      if (name === 'TimelineTrackComponent' && fiber.alternate?.memoizedProps) {
        for (const [key, value] of Object.entries(fiber.memoizedProps ?? {})) {
          if (!Object.is(value, fiber.alternate.memoizedProps[key])) {
            changedTrackProps.set(key, (changedTrackProps.get(key) ?? 0) + 1);
          }
        }
      }
      if (name === 'TimelineSectionTrackRows' && fiber.alternate?.memoizedProps) {
        for (const [key, value] of Object.entries(fiber.memoizedProps ?? {})) {
          if (!Object.is(value, fiber.alternate.memoizedProps[key])) {
            changedTrackRowProps.set(key, (changedTrackRowProps.get(key) ?? 0) + 1);
          }
        }
      }
      const cost = fiber.selfBaseDuration ?? 0;
      const entry = totals.get(name) ?? { name, count: 0, selfMs: 0, maxMs: 0 };
      entry.count++;
      entry.selfMs += cost;
      entry.maxMs = Math.max(entry.maxMs, cost);
      totals.set(name, entry);
    }
    if (fiber.child) visit(fiber.child);
    if (fiber.sibling) visit(fiber.sibling);
  };
  visit(root);
  return { success: true, data: {
    note: 'Latest development self render costs, not a timed CPU profile',
    changedTrackProps: Object.fromEntries(changedTrackProps),
    changedTrackRowProps: Object.fromEntries(changedTrackRowProps),
    entries: [...totals.values()].toSorted((a, b) => b.selfMs - a.selfMs).slice(0, 25),
  } };
}
