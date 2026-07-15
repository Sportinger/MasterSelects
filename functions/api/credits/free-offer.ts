import { json, methodNotAllowed } from '../../lib/db';
import {
  acquireWebsiteFreeCreditOffer,
  setWebsiteFreeCreditOfferCookie,
} from '../../lib/websiteFreeCreditOffer';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);

  const origin = context.request.headers.get('Origin');
  if (!origin || origin !== new URL(context.request.url).origin) {
    return json({ error: 'untrusted_origin', ok: false, offer: null }, { status: 403 });
  }

  const offer = await acquireWebsiteFreeCreditOffer(context.env, context.request);
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (offer) await setWebsiteFreeCreditOfferCookie(context.env, context.request, headers, offer);

  return json({ ok: true, offer }, { headers });
};
