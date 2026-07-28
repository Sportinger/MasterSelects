import {
  calculateHostedDeepgramTranscriptionCredits,
  createHostedDeepgramTranscription,
} from './deepgramTranscription';
import {
  handleHostedTranscriptionRequest,
  type HostedTranscriptionRouteInput,
} from './hostedTranscriptionRoute';

export function handleHostedDeepgramTranscriptionRequest(input: HostedTranscriptionRouteInput): Promise<Response> {
  return handleHostedTranscriptionRequest({
    calculateCredits: calculateHostedDeepgramTranscriptionCredits,
    create: createHostedDeepgramTranscription,
    displayName: 'Deepgram',
    id: 'deepgram',
    ledgerSource: 'hosted:deepgram_transcription',
    model: 'nova-3',
  }, input);
}
