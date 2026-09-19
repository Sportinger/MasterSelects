import { handleConsumerRequest } from '../../lib/consumerRequests';
import type { AppContext, AppRouteHandler } from '../../lib/env';

/** Cancellation button (Kündigungsschaltfläche, §312k BGB) reachable from /kuendigen and /cancel. */
export const onRequest: AppRouteHandler = (context: AppContext): Promise<Response> =>
  handleConsumerRequest(context, 'cancellation');
