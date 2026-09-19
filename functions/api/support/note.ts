import { sendSupportNoteEmail } from '../../lib/authProviders';
import { hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { buildRateLimitKey, getClientIp } from '../../lib/rateLimit';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_PAGE_LENGTH = 500;
const RATE_LIMIT_SECONDS = 60;

interface SupportNoteBody {
  message?: unknown;
  page?: unknown;
}

/** One note per address per minute, tracked as a single-slot lock (pending/sent). */
async function getRateLimitKey(context: AppContext): Promise<string | null> {
  const ip = getClientIp(context.request);
  if (!ip) return null;
  return buildRateLimitKey(
    'support-note',
    ip,
    context.env.VISITOR_NOTIFY_SECRET?.trim() || context.env.SESSION_SECRET,
  );
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'invalid_origin',
        message: 'The note must be sent from MasterSelects.',
      },
      { status: 403 },
    );
  }

  const body = await parseJson<SupportNoteBody>(context.request);
  if (!body) {
    return json(
      {
        error: 'invalid_json',
        message: 'Expected a JSON body containing a note.',
      },
      { status: 400 },
    );
  }

  const message = normalizeOptionalString(body.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    return json(
      {
        error: 'empty_note',
        message: 'Write something before sending your note.',
      },
      { status: 422 },
    );
  }

  const rateLimitKey = await getRateLimitKey(context);
  if (rateLimitKey && await context.env.KV.get(rateLimitKey)) {
    return json(
      {
        error: 'rate_limited',
        message: 'Please wait a moment before sending another note.',
      },
      { status: 429 },
    );
  }

  if (!context.env.RESEND_API_KEY || !context.env.AUTH_EMAIL_FROM) {
    return json(
      {
        error: 'note_delivery_not_configured',
        message: 'Note delivery is not available right now. Please use Write issue instead.',
      },
      { status: 503 },
    );
  }

  if (rateLimitKey) {
    await context.env.KV.put(rateLimitKey, 'pending', { expirationTtl: RATE_LIMIT_SECONDS });
  }

  try {
    await sendSupportNoteEmail(context.env, {
      appVersion: normalizeOptionalString(context.request.headers.get('X-App-Version'), 80),
      message,
      page: normalizeOptionalString(body.page, MAX_PAGE_LENGTH),
      senderEmail: context.data.user?.email,
    });

    if (rateLimitKey) {
      await context.env.KV.put(rateLimitKey, 'sent', { expirationTtl: RATE_LIMIT_SECONDS });
    }

    return json({ ok: true }, { status: 201 });
  } catch {
    if (rateLimitKey) {
      await context.env.KV.delete(rateLimitKey);
    }

    return json(
      {
        error: 'note_delivery_failed',
        message: 'Could not send your note. Please try again.',
      },
      { status: 502 },
    );
  }
};
