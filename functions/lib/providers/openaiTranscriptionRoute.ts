import {
  calculateHostedOpenAITranscriptionCredits,
  createHostedOpenAITranscription,
} from './openaiTranscription';
import {
  handleHostedTranscriptionRequest,
  type HostedTranscriptionRouteInput,
} from './hostedTranscriptionRoute';

export function handleHostedOpenAITranscriptionRequest(input: HostedTranscriptionRouteInput): Promise<Response> {
  return handleHostedTranscriptionRequest({
    calculateCredits: calculateHostedOpenAITranscriptionCredits,
    create: createHostedOpenAITranscription,
    displayName: 'OpenAI',
    id: 'openai',
    ledgerSource: 'hosted:openai_transcription',
    model: 'whisper-1',
    resolveModel: input => input.variant === 'diarized-speakers'
      ? 'gpt-4o-transcribe-diarize'
      : 'whisper-1',
  }, input);
}
