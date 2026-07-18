// Live parameter value bus (plan §14.3 piece 3).
//
// The framework-free channel between the playhead-driven driver and the animated
// UI controls. The driver publishes a live value per parameter id every frame;
// controls subscribe and update their own DOM. Keeping this OUT of React (a plain
// pub/sub, not a store) is the whole point: the properties panel must not
// re-render 60×/second just to move a ghost thumb — same reasoning as the
// imperative playhead follow in useTimelinePlayheadDisplay.
//
// `undefined` means "no live automation for this param right now" — the control
// then shows only its static base value (no ghost). One panel is visible at a
// time, so a single module singleton keyed by param id is sufficient.

type LiveParamListener = (value: number | undefined) => void;

class LiveParamBus {
  private values = new Map<string, number | undefined>();
  private listeners = new Map<string, Set<LiveParamListener>>();

  /** Subscribe to a param id. Fires immediately with the current value. */
  subscribe(id: string, listener: LiveParamListener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    listener(this.values.get(id));
    return () => {
      const current = this.listeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(id);
    };
  }

  /** Publish a live value; a no-op (no notify) when unchanged. */
  publish(id: string, value: number | undefined): void {
    if (this.values.get(id) === value) return;
    this.values.set(id, value);
    const set = this.listeners.get(id);
    if (set) for (const listener of set) listener(value);
  }

  /** Clear every live value (e.g. playback stopped) — listeners get `undefined`. */
  reset(): void {
    for (const id of [...this.values.keys()]) this.publish(id, undefined);
  }
}

export const liveParamBus = new LiveParamBus();
