import { json, methodNotAllowed, parseJson } from '../lib/db';
import type { AppContext, AppRouteHandler } from '../lib/env';

const POLL_KEY = 'poll:splash-credits-v1';
const VOTES_KEY = `${POLL_KEY}:votes`;
const IP_PREFIX = `${POLL_KEY}:ip:`;

interface PollResults {
  great: number;
  'no-sub': number;
  total: number;
}

function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

async function getResults(kv: AppContext['env']['KV']): Promise<PollResults> {
  const data = await kv.get<PollResults>(VOTES_KEY, { type: 'json' });
  return data ?? { great: 0, 'no-sub': 0, total: 0 };
}

// GET /api/poll  — return current results + whether this IP already voted
// POST /api/poll — vote (body: { choice: "great" | "no-sub" })
export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'GET') {
    const ip = getClientIp(request);
    const existingVote = await env.KV.get(`${IP_PREFIX}${ip}`);
    const results = await getResults(env.KV);
    return json({ ...results, ...(existingVote ? { voted: existingVote } : {}) });
  }

  if (request.method === 'POST') {
    const ip = getClientIp(request);
    const ipKey = `${IP_PREFIX}${ip}`;

    // Check if this IP already voted
    const existingVote = await env.KV.get(ipKey);
    if (existingVote) {
      const results = await getResults(env.KV);
      return json({ voted: existingVote, ...results });
    }

    const body = await parseJson<{ choice?: string }>(request);
    const choice = body?.choice;
    if (choice !== 'great' && choice !== 'no-sub') {
      return json({ error: 'Invalid choice' }, { status: 400 });
    }

    // Store IP vote (expire after 90 days)
    await env.KV.put(ipKey, choice, { expirationTtl: 90 * 24 * 60 * 60 });

    // Update totals
    const results = await getResults(env.KV);
    results[choice]++;
    results.total++;
    await env.KV.put(VOTES_KEY, JSON.stringify(results));

    return json({ voted: choice, ...results });
  }

  return methodNotAllowed(['GET', 'POST']);
};
