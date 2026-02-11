//! Video decoder module

mod ffmpeg;
mod hwaccel;
mod pool;

pub use ffmpeg::{VideoDecoder, DecodedFrameData};
pub use hwaccel::detect_hw_accel;
pub use pool::{DecoderPool, SharedDecoderPool};
