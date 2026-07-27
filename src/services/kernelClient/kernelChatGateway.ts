import { KernelServiceClient } from './index';

const DEFAULT_KERNEL_URL = 'http://127.0.0.1:8787';
const KERNEL_ENABLED_KEY = 'ms.kernel.enabled';
const KERNEL_TOKEN_KEY = 'ms.kernel.token';
const KERNEL_URL_KEY = 'ms.kernel.url';
const FINGERPRINT_SHORT_LENGTH = 8;

export type KernelChatGatewayResult =
  | { handled: false }
  | { handled: true; message: string; runId?: string };

interface KernelRunPayload {
  error?: unknown;
  failure?: unknown;
  fingerprint?: unknown;
  id?: unknown;
  message?: unknown;
  reason?: unknown;
  runId?: unknown;
  status?: unknown;
}

function getDefaultStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function readNestedMessage(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === 'object') {
    return readString((value as { message?: unknown }).message);
  }

  return undefined;
}

function readFingerprint(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) {
    return direct;
  }

  if (value && typeof value === 'object') {
    return readString((value as { hash?: unknown }).hash);
  }

  return undefined;
}

function readRunId(payload: KernelRunPayload): string | undefined {
  return readString(payload.runId) ?? readString(payload.id);
}

function failedMessage(payload: KernelRunPayload): string {
  const detail = readNestedMessage(payload.error)
    ?? readNestedMessage(payload.failure)
    ?? readString(payload.message)
    ?? readString(payload.reason);

  return detail
    ? `Kernel-Ausf\u00fchrung fehlgeschlagen: ${detail}`
    : 'Kernel-Ausf\u00fchrung fehlgeschlagen: Der Kernel hat keinen Fehlergrund angegeben.';
}

export async function tryKernelFirst(
  request: string,
  deps?: { client?: KernelServiceClient; storage?: Storage },
): Promise<KernelChatGatewayResult> {
  const storage = deps?.storage ?? getDefaultStorage();
  if (!storage) {
    return { handled: false };
  }

  let enabled: boolean;
  try {
    enabled = storage.getItem(KERNEL_ENABLED_KEY) === 'true';
  } catch {
    return { handled: false };
  }

  if (!enabled) {
    return { handled: false };
  }

  let token: string;
  let baseUrl: string;
  try {
    token = storage.getItem(KERNEL_TOKEN_KEY)?.trim() ?? '';
    baseUrl = storage.getItem(KERNEL_URL_KEY)?.trim() || DEFAULT_KERNEL_URL;
  } catch {
    return { handled: false };
  }

  if (!token) {
    return { handled: false };
  }

  try {
    const client = deps?.client ?? new KernelServiceClient({
      authToken: token,
      baseUrl,
    });

    const result = await client.run({ request });
    if (!result.ok) {
      return { handled: false };
    }

    const payload = result.data as KernelRunPayload;
    const status = readString(payload.status)?.toLowerCase();
    const runId = readRunId(payload);

    if (status === 'aborted') {
      return { handled: false };
    }

    if (status === 'failed') {
      return {
        handled: true,
        message: failedMessage(payload),
        ...(runId ? { runId } : {}),
      };
    }

    if (status === 'succeeded') {
      const fingerprint = readFingerprint(payload.fingerprint);
      const shortFingerprint = fingerprint?.slice(0, FINGERPRINT_SHORT_LENGTH) ?? 'unbekannt';
      return {
        handled: true,
        message: `Kernel-verifiziert (${shortFingerprint}): Der Auftrag wurde erfolgreich ausgef\u00fchrt.`,
        ...(runId ? { runId } : {}),
      };
    }

    return { handled: false };
  } catch {
    return { handled: false };
  }
}
