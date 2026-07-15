import { reserveKieAiGenerationStart } from './slotScheduler';

const NEXT_START_AT_KEY = 'next-start-at';

interface GenerationStartReservation {
  nextStartAt: number;
  scheduledAt: number;
}

export default {
  fetch(): Response {
    return new Response('Not found', { status: 404 });
  },
};

export class KieAiGenerationRateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let reservation: GenerationStartReservation | null = null;

    await this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const nextStartAt = (await this.state.storage.get<number>(NEXT_START_AT_KEY)) ?? now;
      reservation = reserveKieAiGenerationStart(nextStartAt, now);
      await this.state.storage.put(NEXT_START_AT_KEY, reservation.nextStartAt);
    });

    if (!reservation) {
      return new Response('Unable to reserve a generation start', { status: 500 });
    }

    return Response.json({ delayMs: Math.max(0, reservation.scheduledAt - Date.now()) });
  }
}
