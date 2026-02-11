//! Build script for cross-platform FFmpeg discovery
//!
//! On Windows: Uses FFMPEG_DIR env var or bundled ffmpeg/win64/ directory
//! On Linux:   Uses pkg-config (system FFmpeg)
//! On macOS:   Uses pkg-config or Homebrew FFmpeg

fn main() {
    // On Windows, help ffmpeg-sys-next find the libraries
    #[cfg(target_os = "windows")]
    {
        // Check if FFMPEG_DIR is already set
        if std::env::var("FFMPEG_DIR").is_ok() {
            println!("cargo:warning=Using FFMPEG_DIR from environment");
            return;
        }

        // Try bundled FFmpeg in project directory
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let bundled = std::path::PathBuf::from(&manifest_dir).join("ffmpeg").join("win64");

        if bundled.join("lib").exists() && bundled.join("include").exists() {
            println!("cargo:warning=Using bundled FFmpeg from {}", bundled.display());
            println!("cargo:rustc-env=FFMPEG_DIR={}", bundled.display());
            // Also set for ffmpeg-sys-next build script
            std::env::set_var("FFMPEG_DIR", &bundled);
            return;
        }

        println!("cargo:warning=No FFmpeg found! Set FFMPEG_DIR or place pre-built FFmpeg in ffmpeg/win64/");
        println!("cargo:warning=Download from: https://github.com/BtbN/FFmpeg-Builds/releases");
        println!("cargo:warning=Expected structure: ffmpeg/win64/{{bin,include,lib}}/");
    }
}
