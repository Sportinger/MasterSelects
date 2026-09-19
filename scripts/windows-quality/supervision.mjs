import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';

export const SUPERVISION_PROTOCOL = 'windows-campaign-owned-process-v1';
export function validateSupervisor(adapter) {
  if (adapter?.protocol !== SUPERVISION_PROTOCOL ||
      ['prepare', 'launch', 'stop', 'verifyQuiescence'].some(name => typeof adapter[name] !== 'function')) {
    throw new Error('Explicit trusted owned-process supervisor adapter required');
  }
}
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
export function validateOwnership(binding) {
  if (binding?.protocol !== SUPERVISION_PROTOCOL || binding.hostname !== os.hostname() ||
      !['ownershipId', 'runId', 'leaseId', 'issuedBy', 'workspace'].every(key => token(binding[key])) ||
      !/^[a-f0-9]{64}$/.test(binding.manifestSha256 || '') ||
      !Number.isFinite(Date.parse(binding.deadlineAt))) throw new Error('Invalid durable ownership binding');
}
function validateIdentity(identity, binding) {
  if (!isDeepStrictEqual(identity?.binding, binding) || !token(identity?.serviceInstanceId) ||
      !token(identity?.jobId)) throw new Error('Supervisor identity does not bind this ownership');
}
async function bounded(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Supervisor RPC timeout; ownership remains uncertain')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// A receipt is supplied by the trusted service, never by the campaign/report or a PID probe.
// A fresh challenge binds the response; the adapter must authenticate its service transport.
export async function verifyOwnedQuiescence(adapter, binding, identity, timeoutMs = 5000) {
  validateSupervisor(adapter); validateOwnership(binding);
  if (identity !== null) validateIdentity(identity, binding);
  const challenge = randomUUID();
  const requestedAt = Date.now();
  const receipt = await bounded(() => adapter.verifyQuiescence({ binding, identity, challenge }), timeoutMs);
  if (!isDeepStrictEqual(receipt?.binding, binding) || receipt?.challenge !== challenge ||
      !token(receipt?.verificationId) || !Number.isFinite(Date.parse(receipt?.observedAt)) ||
      Date.parse(receipt.observedAt) < requestedAt || Date.parse(receipt.observedAt) > Date.now() ||
      receipt?.launchSealed !== true || receipt?.ownedProcessesAbsent !== true ||
      receipt?.ownedResourcesQuiescent !== true) throw new Error('External quiescence not proven');
  validateIdentity(receipt.identity, binding);
  if (identity !== null && !isDeepStrictEqual(receipt.identity, identity)) throw new Error('Quiescence identity mismatch');
  return receipt;
}

// No native process implementation here. The external service owns creation, containment,
// deadline and lease enforcement even if this recorder dies. See SUPERVISOR-CONTRACT.md.
export async function recordSupervisedProcess({ adapter, ownership, command, maxRuntimeMs,
  heartbeatMs, emit, signal, checkAuthority = async () => {}, rpcTimeoutMs = 5000 }) {
  validateSupervisor(adapter);
  if (!Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1) throw new Error('Finite supervisor RPC timeout required');
  const binding = Object.freeze({ ...ownership, protocol: SUPERVISION_PROTOCOL,
    hostname: os.hostname(), ownershipId: randomUUID(), deadlineAt: new Date(Date.now() + maxRuntimeMs).toISOString() });
  validateOwnership(binding);
  let identity = null, timer, heartbeat, checking = false, interruptedReason;
  let heartbeatTask = Promise.resolve();
  let chain = Promise.resolve();
  const append = (type, data) => {
    const result = chain.then(() => emit(type, data));
    chain = result.catch(() => {});
    return result;
  };
  let interrupt;
  const interrupted = new Promise((_, reject) => {
    interrupt = reason => { interruptedReason ??= reason; reject(new Error(interruptedReason)); };
  });
  // Attach immediately, including while the launch-intent journal is being synced.
  interrupted.catch(() => {});
  const abort = () => interrupt('Authority revoked by controller signal');
  const authority = async () => {
    if (signal?.aborted) throw new Error('Authority revoked by controller signal');
    if (Date.now() >= Date.parse(binding.deadlineAt)) throw new Error('Runtime/grant deadline');
    await bounded(checkAuthority, rpcTimeoutMs);
  };
  const active = action => Promise.race([bounded(action, rpcTimeoutMs), interrupted]);
  let result;
  try {
    await append('supervision-intent', { binding });
    timer = setTimeout(() => interrupt('Runtime/grant deadline'), Math.max(1, Date.parse(binding.deadlineAt) - Date.now()));
    signal?.addEventListener('abort', abort, { once: true });
    await active(authority);
    const prepared = structuredClone(await active(() => adapter.prepare({ binding })));
    validateIdentity(prepared, binding);
    identity = prepared;
    await append('supervision-prepared', { binding, identity });
    await active(authority);
    heartbeat = setInterval(() => {
      if (checking) return;
      checking = true;
      heartbeatTask = authority().then(() => append('heartbeat', { binding, identity }))
        .catch(error => interrupt(`Authority/heartbeat failed: ${String(error)}`))
        .finally(() => { checking = false; });
    }, heartbeatMs);
    const handle = await active(() => adapter.launch({ binding, identity, command }));
    if (!handle?.completion || typeof handle.completion.then !== 'function') throw new Error('Missing supervised completion');
    const completion = Promise.resolve(handle.completion);
    completion.catch(() => {});
    await append('supervision-started', { binding, identity });
    result = await Promise.race([completion, interrupted]);
    if (!Number.isInteger(result?.exitCode) && result?.exitCode !== null) throw new Error('Invalid supervised exit result');
    // Do not accept arbitrary adapter fields as verdict or cleanup authority.
    result = { exitCode: result.exitCode, signal: result.signal ?? null };
    await active(authority);
  } catch (error) {
    result = { exitCode: null, interrupted: true, reason: interruptedReason || String(error) };
  } finally {
    clearTimeout(timer); clearInterval(heartbeat); signal?.removeEventListener('abort', abort);
  }
  await heartbeatTask;
  if (interruptedReason) result = { ...result, interrupted: true, reason: interruptedReason };
  // stop must fence this ownership ID, including late prepare/launch RPCs, before returning.
  // Successful parent exit still requires sealing and cleanup of any owned descendants.
  try {
    await bounded(() => adapter.stop({ binding, identity, reason: result.interrupted ? result.reason : 'root-exited' }), rpcTimeoutMs);
    result.quiescence = await verifyOwnedQuiescence(adapter, binding, identity, rpcTimeoutMs);
  } catch (error) {
    result.interrupted = true;
    result.reason = [result.reason, `Owned-process reconciliation failed: ${String(error)}`].filter(Boolean).join('; ');
  }
  await chain;
  await append(result.interrupted ? 'interrupted' : 'process-exited', { ...result, binding, identity });
  return result;
}
