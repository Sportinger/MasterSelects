import { handleConsumerRequest } from '../../lib/consumerRequests';
import type { AppContext, AppRouteHandler } from '../../lib/env';

/** Online withdrawal form (Widerruf, §355 BGB) reachable from /widerruf and /withdrawal. */
export const onRequest: AppRouteHandler = (context: AppContext): Promise<Response> =>
  handleConsumerRequest(context, 'withdrawal');
