import { requestJson } from './cloud/transport';

interface SupportNoteResponse {
  ok: boolean;
}

export async function submitSupportNote(message: string): Promise<void> {
  await requestJson<SupportNoteResponse>('/api/support/note', {
    body: JSON.stringify({
      message,
      page: window.location.href,
    }),
    method: 'POST',
  });
}
