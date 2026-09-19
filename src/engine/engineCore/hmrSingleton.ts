export interface HotDataHost {
  data: Record<string, unknown>;
}

export interface HmrSingletonOptions<T> {
  hot?: HotDataHost;
  key: string;
  create: () => T;
  reuse?: (instance: T) => void;
  onCreate?: () => void;
  onReuse?: () => void;
}

/** Retains a stateful runtime owner in the importing module's HMR data. */
export function retainHmrSingleton<T>(options: HmrSingletonOptions<T>): T {
  if (!options.hot) return options.create();
  const existing = options.hot.data[options.key] as T | undefined;
  if (existing) {
    options.onReuse?.();
    options.reuse?.(existing);
    return existing;
  }
  options.onCreate?.();
  const instance = options.create();
  options.hot.data[options.key] = instance;
  return instance;
}
