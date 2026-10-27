import { captureEditorTransactionBinding } from '../project/repository/transaction/editorTransactionBinding';
import { Logger } from '../logger';

const log = Logger.create('ToolTransaction');

/** A tool's own transaction, carried explicitly across its awaits. */
export interface ToolTransaction {
  /** True when the tool runs inside a repository transaction (its own, or a pinned grouped one). */
  readonly bound: boolean;
  /** Runs one synchronous write phase in the tool's transaction (an async action: only its part before the first await). */
  run<T>(action: () => T): T;
  /** The store state with every action running in the tool's transaction, for calls after an await. */
  bindStore<S extends object>(state: S): S;
}

/**
 * Capture before the tool's first await. A tool's synchronous start runs inside its transaction, so this
 * picks up exactly that transaction. Writes after an await join it only through `run` / `bindStore`; a timer,
 * a background result or a user edit during the await keeps its own transaction and is never rolled back
 * with a failing tool. A late write after the tool's transaction closed (a timed-out tool that kept going)
 * is recorded as its own step and logged.
 */
export function captureToolTransaction(label: string): ToolTransaction {
  const binding = captureEditorTransactionBinding(label);
  let warned = false;
  const run = <T>(action: () => T): T => {
    if (binding.token && !binding.isOpen() && !warned) {
      warned = true;
      log.warn(`${label}: the tool's transaction already closed; a late write is recorded as its own step`);
    }
    return binding.run(action);
  };
  const bindStore = <S extends object>(state: S): S => (binding.token ? new Proxy(state, { get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    return typeof value === 'function' ? (...args: unknown[]) => run(() => value.apply(target, args)) : value;
  } }) : state);
  return { bound: binding.token !== null, run, bindStore };
}
