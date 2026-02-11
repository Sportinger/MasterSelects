//! FFmpeg video decoder wrapper

use anyhow::{anyhow, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::format::Pixel;
use ffmpeg_next::software::scaling::{Context as ScalingContext, Flags as ScalingFlags};
use ffmpeg_next::util::frame::video::Video as VideoFrame;
use std::path::Path;
use std::time::Instant;
use tracing::{debug, trace, warn};

use crate::protocol::{FileMetadata, PixelFormat};

/// Video decoder wrapping FFmpeg
pub struct VideoDecoder {
    input: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    stream_index: usize,
    time_base: ffmpeg::Rational,
    fps: f64,
    frame_count: u64,
    duration_ms: u64,
    width: u32,
    height: u32,
    codec_name: String,
    profile: Option<String>,
    audio_tracks: u32,

    // Seek state
    last_decoded_frame: Option<u32>,

    // Output format settings (scaler created on demand, not stored)
    target_format: Pixel,
    target_width: u32,
    target_height: u32,

    // Hardware acceleration info
    hw_accel: Option<String>,

    // Stats
    pub decode_time_us: u64,
}

impl VideoDecoder {
    /// Open a video file
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();

        if !path.exists() {
            return Err(anyhow!("File not found: {}", path.display()));
        }

        let input = ffmpeg::format::input(path)?;

        // Find best video stream
        let stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or_else(|| anyhow!("No video stream found"))?;

        let stream_index = stream.index();
        let time_base = stream.time_base();

        // Get stream parameters
        let parameters = stream.parameters();
        let context = ffmpeg::codec::context::Context::from_parameters(parameters)?;
        let decoder = context.decoder().video()?;

        let width = decoder.width();
        let height = decoder.height();
        let codec_name = decoder
            .codec()
            .map(|c| c.name().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Get profile if available
        let profile = decoder.codec().and_then(|_c| {
            let profile_id = unsafe { (*decoder.as_ptr()).profile };
            if profile_id >= 0 {
                Some(format!("profile_{}", profile_id))
            } else {
                None
            }
        });

        // Calculate FPS
        let fps = stream.avg_frame_rate();
        let fps_f64 = if fps.1 != 0 {
            fps.0 as f64 / fps.1 as f64
        } else {
            30.0 // Default
        };

        // Calculate duration and frame count
        let duration = input.duration();
        let duration_ms = if duration > 0 {
            (duration as f64 / ffmpeg::ffi::AV_TIME_BASE as f64 * 1000.0) as u64
        } else {
            0
        };

        let frame_count = stream.frames() as u64;
        let frame_count = if frame_count == 0 {
            // Estimate from duration
            (duration_ms as f64 * fps_f64 / 1000.0) as u64
        } else {
            frame_count
        };

        // Count audio tracks
        let audio_tracks = input
            .streams()
            .filter(|s| s.parameters().medium() == ffmpeg::media::Type::Audio)
            .count() as u32;

        debug!(
            "Opened video: {}x{} @ {:.2} fps, {} frames, codec: {}",
            width, height, fps_f64, frame_count, codec_name
        );

        Ok(Self {
            input,
            decoder,
            stream_index,
            time_base,
            fps: fps_f64,
            frame_count,
            duration_ms,
            width,
            height,
            codec_name,
            profile,
            audio_tracks,
            last_decoded_frame: None,
            target_format: Pixel::RGBA,
            target_width: width,
            target_height: height,
            hw_accel: None,
            decode_time_us: 0,
        })
    }

    /// Get file metadata
    pub fn metadata(&self, file_id: &str) -> FileMetadata {
        FileMetadata {
            file_id: file_id.to_string(),
            width: self.width,
            height: self.height,
            fps: self.fps,
            duration_ms: self.duration_ms,
            frame_count: self.frame_count,
            codec: self.codec_name.clone(),
            profile: self.profile.clone(),
            color_space: None,
            audio_tracks: self.audio_tracks,
            hw_accel: self.hw_accel.clone(),
        }
    }

    /// Set output format and scale
    pub fn set_output(&mut self, format: PixelFormat, scale: f32) -> Result<()> {
        let target_format = match format {
            PixelFormat::Rgba8 => Pixel::RGBA,
            PixelFormat::Rgb8 => Pixel::RGB24,
            PixelFormat::Yuv420 => Pixel::YUV420P,
        };

        let target_width = ((self.width as f32 * scale) as u32).max(1);
        let target_height = ((self.height as f32 * scale) as u32).max(1);

        self.target_format = target_format;
        self.target_width = target_width;
        self.target_height = target_height;

        Ok(())
    }

    /// Decode a specific frame
    pub fn decode_frame(&mut self, target_frame: u32) -> Result<DecodedFrameData> {
        let start = Instant::now();

        if target_frame as u64 >= self.frame_count {
            return Err(anyhow!(
                "Frame {} out of range (max {})",
                target_frame,
                self.frame_count - 1
            ));
        }

        // Determine if we need to seek
        let should_seek = match self.last_decoded_frame {
            Some(last) => {
                let distance = (target_frame as i64 - last as i64).abs();
                // Seek if going backward or jumping more than 10 frames forward
                target_frame < last || distance > 10
            }
            None => true,
        };

        if should_seek {
            self.seek_to_frame(target_frame)?;
        }

        // Pre-calculate PTS conversion factors (avoids borrow conflict in loop)
        let tb_num = self.time_base.0 as f64;
        let tb_den = self.time_base.1 as f64;
        let fps = self.fps;

        // Decode frames until we reach target
        let mut decoded_frame = None;
        let mut frames_decoded = 0u32;
        let mut last_known = self.last_decoded_frame;
        let max_frames = 300; // Safety limit to prevent infinite loops

        'decode: loop {
            // Read packets
            for (stream, packet) in self.input.packets() {
                if stream.index() != self.stream_index {
                    continue;
                }

                self.decoder.send_packet(&packet)?;

                // Receive frames
                let mut frame = VideoFrame::empty();
                while self.decoder.receive_frame(&mut frame).is_ok() {
                    // Use PTS to determine actual frame number
                    let current_frame = if let Some(pts) = frame.pts() {
                        let time_sec = pts as f64 * tb_num / tb_den;
                        (time_sec * fps).round() as u32
                    } else {
                        // Fallback: sequential counting from last known position
                        last_known.map(|f| f + 1).unwrap_or(0)
                    };

                    trace!("Decoded frame {} (target: {}, pts: {:?})", current_frame, target_frame, frame.pts());

                    last_known = Some(current_frame);
                    frames_decoded += 1;

                    if current_frame >= target_frame {
                        decoded_frame = Some(frame.clone());
                        self.last_decoded_frame = Some(current_frame);
                        break 'decode;
                    }

                    if frames_decoded >= max_frames {
                        warn!("Hit max decode limit ({}) seeking to frame {}", max_frames, target_frame);
                        break 'decode;
                    }
                }
            }

            // End of file
            break;
        }

        // Update tracking for sequential decode optimization
        if decoded_frame.is_some() {
            self.last_decoded_frame = last_known;
        }

        let frame = decoded_frame.ok_or_else(|| anyhow!("Frame {} not found (decoded {} frames)", target_frame, frames_decoded))?;

        // Convert to target format
        let output = self.convert_frame(&frame)?;

        self.decode_time_us = start.elapsed().as_micros() as u64;

        Ok(output)
    }

    /// Seek to a specific frame
    fn seek_to_frame(&mut self, target_frame: u32) -> Result<()> {
        // Calculate timestamp in stream time base
        let frame_duration = 1.0 / self.fps;
        let target_time = target_frame as f64 * frame_duration;

        // Convert to stream time base
        let target_ts = (target_time * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

        // Seek to keyframe before target
        unsafe {
            let ret = ffmpeg::ffi::av_seek_frame(
                self.input.as_mut_ptr(),
                self.stream_index as i32,
                target_ts,
                ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
            );

            if ret < 0 {
                warn!("Seek failed, trying file-level seek");
                let file_ts = (target_time * ffmpeg::ffi::AV_TIME_BASE as f64) as i64;
                ffmpeg::ffi::av_seek_frame(
                    self.input.as_mut_ptr(),
                    -1,
                    file_ts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD,
                );
            }
        }

        // Flush decoder
        self.decoder.flush();

        // Update frame tracking
        self.last_decoded_frame = None;

        debug!("Seeked to frame {} (ts={})", target_frame, target_ts);

        Ok(())
    }

    /// Convert frame to target pixel format
    fn convert_frame(&self, frame: &VideoFrame) -> Result<DecodedFrameData> {
        let mut scaler = ScalingContext::get(
            frame.format(),
            frame.width(),
            frame.height(),
            self.target_format,
            self.target_width,
            self.target_height,
            ScalingFlags::BILINEAR,
        )?;

        let mut output = VideoFrame::empty();
        scaler.run(frame, &mut output)?;

        // Copy data to contiguous buffer
        let bytes_per_pixel = match self.target_format {
            Pixel::RGBA => 4,
            Pixel::RGB24 => 3,
            Pixel::YUV420P => 1,
            _ => 4,
        };

        let data = if self.target_format == Pixel::YUV420P {
            output.data(0).to_vec()
        } else {
            let stride = output.stride(0) as usize;
            let width_bytes = self.target_width as usize * bytes_per_pixel;

            if stride == width_bytes {
                output.data(0).to_vec()
            } else {
                let mut data = Vec::with_capacity(width_bytes * self.target_height as usize);
                let src = output.data(0);

                for y in 0..self.target_height as usize {
                    let row_start = y * stride;
                    let row_end = row_start + width_bytes;
                    data.extend_from_slice(&src[row_start..row_end]);
                }

                data
            }
        };

        Ok(DecodedFrameData {
            width: self.target_width,
            height: self.target_height,
            data,
        })
    }

    /// Get decoder info
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn fps(&self) -> f64 {
        self.fps
    }

    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    pub fn codec_name(&self) -> &str {
        &self.codec_name
    }
}

/// Decoded frame data
#[derive(Debug, Clone)]
pub struct DecodedFrameData {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}
