import { APP_VERSION } from '../../version';
import {
  sanitizeProductAnalyticsProperties,
  type ProductAnalyticsEventName,
  type ProductAnalyticsProperties,
} from './catalog';
import {
  isProductAnalyticsEnabled,
  subscribeProductAnalyticsPreference,
} from './privacy';

const ANALYTICS_ENDPOINT = '/api/analytics/events';
const FLUSH_DELAY_MS = 4_000;
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const MAX_DELIVERY_ATTEMPTS = 2;

interface QueuedProductAnalyticsEvent {
  appVersion: string;
  attempts: number;
  eventVersion: number;
  id: string;
  name: ProductAnalyticsEventName;
  occurredAt: string;
  properties: ProductAnalyticsProperties;
  sessionId: string;
}
function createEventId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${id}`;
}

export class ProductAnalyticsService {
  private readonly sessionId = createEventId('session');
  private readonly queue: QueuedProductAnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private disposed = false;
  private readonly unsubscribePreference: () => void;

  constructor() {
    this.unsubscribePreference = subscribeProductAnalyticsPreference(() => {
      if (!isProductAnalyticsEnabled()) {
        this.queue.splice(0);
        this.clearFlushTimer();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  track(
    name: ProductAnalyticsEventName,
    properties: ProductAnalyticsProperties = {},
  ): void {
    if (this.disposed || !isProductAnalyticsEnabled()) return;

    this.queue.push({
      appVersion: APP_VERSION,
      attempts: 0,
      eventVersion: 2,
      id: createEventId('event'),
      name,
      occurredAt: new Date().toISOString(),
      properties: sanitizeProductAnalyticsProperties(name, properties),
      sessionId: this.sessionId,
    });

    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
    }

    if (this.queue.length >= MAX_BATCH_SIZE) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.queue.length === 0 || !isProductAnalyticsEnabled()) return Promise.resolve();
    this.clearFlushTimer();

    const batch = this.queue.splice(0, MAX_BATCH_SIZE);
    this.flushPromise = this.deliver(batch, options.keepalive === true)
      .finally(() => {
        this.flushPromise = null;
        if (this.queue.length > 0) this.scheduleFlush();
      });
    return this.flushPromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFlushTimer();
    this.unsubscribePreference();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private readonly handlePageHide = (): void => {
    void this.flush({ keepalive: true });
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.flush({ keepalive: true });
    }
  };

  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async deliver(batch: QueuedProductAnalyticsEvent[], keepalive: boolean): Promise<void> {
    try {
      const response = await fetch(ANALYTICS_ENDPOINT, {
        body: JSON.stringify({
          events: batch.map(({ attempts: _attempts, ...event }) => event),
        }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        keepalive,
        method: 'POST',
      });
      if (!response.ok && response.status >= 500) {
        this.requeue(batch);
      }
    } catch {
      this.requeue(batch);
    }
  }

  private requeue(batch: QueuedProductAnalyticsEvent[]): void {
    const retryable = batch
      .map((event) => ({ ...event, attempts: event.attempts + 1 }))
      .filter((event) => event.attempts <= MAX_DELIVERY_ATTEMPTS);
    this.queue.unshift(...retryable);
    if (this.queue.length > MAX_QUEUE_SIZE) this.queue.splice(MAX_QUEUE_SIZE);
  }
}
