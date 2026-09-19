//! FLV tag body construction for RTMP video and audio messages.

use bytes::Bytes;

pub(super) fn video_body(payload: &[u8], keyframe: bool, sequence_header: bool) -> Bytes {
    let mut body = Vec::with_capacity(payload.len() + 5);
    body.push(if keyframe { 0x17 } else { 0x27 });
    body.push(if sequence_header { 0 } else { 1 });
    body.extend_from_slice(&[0, 0, 0]);
    body.extend_from_slice(payload);
    Bytes::from(body)
}

pub(super) fn audio_body(payload: &[u8], sequence_header: bool) -> Bytes {
    let mut body = Vec::with_capacity(payload.len() + 2);
    body.push(0xaf);
    body.push(if sequence_header { 0 } else { 1 });
    body.extend_from_slice(payload);
    Bytes::from(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_avc_sequence_header_body() {
        assert_eq!(
            video_body(&[1, 2, 3], true, true).as_ref(),
            &[0x17, 0, 0, 0, 0, 1, 2, 3]
        );
    }

    #[test]
    fn builds_inter_video_body() {
        assert_eq!(
            video_body(&[4, 5], false, false).as_ref(),
            &[0x27, 1, 0, 0, 0, 4, 5]
        );
    }

    #[test]
    fn builds_aac_sequence_and_raw_bodies() {
        assert_eq!(
            audio_body(&[0x12, 0x10], true).as_ref(),
            &[0xaf, 0, 0x12, 0x10]
        );
        assert_eq!(audio_body(&[9], false).as_ref(), &[0xaf, 1, 9]);
    }
}
