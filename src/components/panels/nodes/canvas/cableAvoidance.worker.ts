import { routeAroundCards, type AvoidCable, type AvoidRect } from './cableAvoidance';

/** Routes cables around cards off the main thread; replies are tagged with the request revision. */
self.onmessage = (event: MessageEvent<{ revision: number; obstacles: AvoidRect[]; cables: AvoidCable[] }>) => {
  const { revision, obstacles, cables } = event.data;
  let routes: Array<[string, Array<{ x: number; y: number }>]> = [];
  try { routes = [...routeAroundCards(obstacles, cables)]; } catch { /* keep direct routes */ }
  self.postMessage({ revision, routes });
};
