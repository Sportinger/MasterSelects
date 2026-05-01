export const KEYFRAME_RECORDING_FEEDBACK_EVENT = 'keyframe-recording-feedback';

export type KeyframeRecordingFeedbackDetail = {
  clipId: string;
  property: string;
};

export function getKeyframeRecordingFeedbackId(clipId: string, property: string): string {
  return `${clipId}:${property}`;
}

export function dispatchKeyframeRecordingFeedback(clipId: string, property: string) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;

  window.dispatchEvent(new CustomEvent<KeyframeRecordingFeedbackDetail>(
    KEYFRAME_RECORDING_FEEDBACK_EVENT,
    { detail: { clipId, property } },
  ));
}
