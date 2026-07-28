//! Local MuScriptor audio-to-MIDI transcription provider.
//!
//! The provider owns an isolated Python environment and HuggingFace cache,
//! while reusing the native helper's managed `uv` bootstrap. Model credentials
//! are accepted only by the explicit download command and never persisted by
//! the helper.

pub mod control;
pub mod env;
pub mod inference;
pub mod process;
pub mod websocket;

pub use env::{
    download_model, ensure_server_script, get_env_info, get_venv_python, setup_environment,
    validate_variant,
};
