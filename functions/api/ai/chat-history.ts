import { getChatLogDetail, getChatLogs } from '../../lib/chatLog';
import { getCurrentUser, json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { Allow: 'GET, OPTIONS' },
      status: 204,
    });
  }

  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET', 'OPTIONS']);
  }

  const user = getCurrentUser(context);

  if (!user) {
    return json(
      { error: 'auth_required', message: 'You must be signed in to view chat history.' },
      { status: 401 },
    );
  }

  const url = new URL(context.request.url);
  const logId = url.searchParams.get('id');

  // Single log detail
  if (logId) {
    const log = await getChatLogDetail(context.env.DB, user.id, logId);

    if (!log) {
      return json({ error: 'not_found', message: 'Chat log not found.' }, { status: 404 });
    }

    return json({
      ok: true,
      data: {
        id: log.id,
        model: log.model,
        messages: JSON.parse(log.messages_json),
        response: JSON.parse(log.response_json),
        toolCalls: log.tool_calls_json ? JSON.parse(log.tool_calls_json) : null,
        finishReason: log.finish_reason,
        tokensIn: log.tokens_in,
        tokensOut: log.tokens_out,
        tokensTotal: log.tokens_total,
        creditCost: log.credit_cost,
        durationMs: log.duration_ms,
        status: log.status,
        errorMessage: log.error_message,
        createdAt: log.created_at,
      },
    });
  }

  // List logs
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
  const search = url.searchParams.get('search')?.trim().slice(0, 100) || undefined;

  const result = await getChatLogs(context.env.DB, {
    userId: user.id,
    limit,
    offset,
    search,
  });

  return json({
    ok: true,
    data: result.logs,
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
    },
  });
};
