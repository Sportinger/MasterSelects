//! MatAnyone2 video matting integration
//!
//! This module handles model weight management (download, verification, cleanup)
//! and Python environment setup for the MatAnyone2 neural network.

pub mod env;
pub mod inference;
pub mod model;
pub mod process;

pub use env::{
    detect_cuda, get_data_dir, get_env_info, get_venv_python, setup_environment, CudaInfo,
    EnvInfo, SetupStep,
};
pub use model::{
    delete_model, download_model, get_model_info, get_models_dir, DownloadProgress, ModelInfo,
};
