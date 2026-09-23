import { InspectorGraphQueue, type InspectorGraphWorker } from './inspectorGraphQueue';

type Factory = () => InspectorGraphWorker;
const client: { create?: Factory; queue: InspectorGraphQueue } = import.meta.hot?.data?.inspectorGraphClient ?? {
  queue: new InspectorGraphQueue(() => {
    if (!client.create) throw new Error('Inspector graph worker is not initialized.');
    return client.create();
  }),
};
if (import.meta.hot) import.meta.hot.dispose(data => { data.inspectorGraphClient = client; });

// Only the browser entry registers the URL. Shared graph/registry imports also
// reach worker bundles and must not recursively import another worker entry.
export function configureInspectorGraphWorker(create: Factory): void { client.create = create; }
export const inspectorGraphQueue = client.queue;
