//! MasterSelects Native Helper
//!
//! A cross-platform video codec helper providing hardware-accelerated
//! video decoding/encoding and video downloads via WebSocket for the
//! MasterSelects web application.
//!
//! Supports Windows, Linux, and macOS.

mod cache;
mod decoder;
mod download;
mod encoder;
mod protocol;
mod server;
mod session;
mod utils;

use clap::Parser;
use tracing::{info, error, warn, Level};
use tracing_subscriber::FmtSubscriber;

/// MasterSelects Native Helper - Video codec acceleration for masterselects.app
#[derive(Parser, Debug)]
#[command(name = "masterselects-helper")]
#[command(about = "Cross-platform video codec helper for MasterSelects web application")]
#[command(version)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value = "9876")]
    port: u16,

    /// Run in background (minimal output)
    #[arg(long)]
    background: bool,

    /// Maximum cache size in MB
    #[arg(long, default_value = "2048")]
    cache_mb: usize,

    /// Maximum number of open decoder contexts
    #[arg(long, default_value = "8")]
    max_decoders: usize,

    /// Allowed origins (comma-separated, empty = allow all localhost)
    #[arg(long)]
    allowed_origins: Option<String>,

    /// Generate and print auth token, then exit
    #[arg(long)]
    generate_token: bool,

    /// Log level (trace, debug, info, warn, error)
    #[arg(long, default_value = "info")]
    log_level: String,
}

/// On Windows, add bundled DLL directory to the DLL search path
#[cfg(windows)]
fn setup_dll_search_path() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // Try to add the directory containing our executable to the DLL search path
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Check for DLLs directly next to the binary
            let avcodec = exe_dir.join("avcodec-61.dll");
            if avcodec.exists() {
                set_dll_directory(exe_dir);
                return;
            }

            // Check for ffmpeg/bin subdirectory
            let ffmpeg_bin = exe_dir.join("ffmpeg").join("bin");
            let avcodec_sub = ffmpeg_bin.join("avcodec-61.dll");
            if avcodec_sub.exists() {
                set_dll_directory(&ffmpeg_bin);
                return;
            }
        }
    }

    // Try FFMPEG_DIR environment variable
    if let Ok(ffmpeg_dir) = std::env::var("FFMPEG_DIR") {
        let bin_dir = std::path::PathBuf::from(&ffmpeg_dir).join("bin");
        if bin_dir.exists() {
            set_dll_directory(&bin_dir);
        }
    }
}

#[cfg(windows)]
fn set_dll_directory(dir: &std::path::Path) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let wide: Vec<u16> = OsStr::new(dir)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW(wide.as_ptr());
    }
    eprintln!("  DLL path: {}", dir.display());
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Handle token generation
    if args.generate_token {
        let token = session::generate_auth_token();
        println!("{}", token);
        return Ok(());
    }

    // Initialize logging
    if !args.background {
        let level = match args.log_level.to_lowercase().as_str() {
            "trace" => Level::TRACE,
            "debug" => Level::DEBUG,
            "info" => Level::INFO,
            "warn" => Level::WARN,
            "error" => Level::ERROR,
            _ => Level::INFO,
        };

        let _subscriber = FmtSubscriber::builder()
            .with_max_level(level)
            .with_target(false)
            .compact()
            .init();
    }

    // On Windows, set up DLL search paths before FFmpeg init
    #[cfg(windows)]
    setup_dll_search_path();

    // Initialize FFmpeg
    match ffmpeg_next::init() {
        Ok(()) => info!("FFmpeg initialized"),
        Err(e) => {
            error!("Failed to initialize FFmpeg: {}", e);
            #[cfg(windows)]
            {
                error!("Make sure FFmpeg DLLs are available. Options:");
                error!("  1. Place DLLs next to this executable");
                error!("  2. Set FFMPEG_DIR environment variable");
                error!("  3. Place FFmpeg in ffmpeg/win64/ relative to project");
                error!("Download from: https://github.com/BtbN/FFmpeg-Builds/releases");
            }
            return Err(anyhow::anyhow!("FFmpeg initialization failed: {}", e));
        }
    }

    // Parse allowed origins
    let allowed_origins: Vec<String> = args
        .allowed_origins
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_else(|| vec![
            "https://masterselects.app".to_string(),
            "https://app.masterselects.com".to_string(),
            "http://localhost:5173".to_string(),
            "http://localhost:3000".to_string(),
            "http://127.0.0.1:5173".to_string(),
            "http://127.0.0.1:3000".to_string(),
        ]);

    // Create server config
    let config = server::ServerConfig {
        port: args.port,
        cache_mb: args.cache_mb,
        max_decoders: args.max_decoders,
        allowed_origins,
    };

    // Detect capabilities for banner
    let hw_accel = decoder::detect_hw_accel();
    let ytdlp_path = download::get_ytdlp_command();
    let ytdlp_available = download::find_ytdlp().is_some();
    let deno_available = download::find_deno().is_some();

    // Print startup banner
    if !args.background {
        let os_name = if cfg!(windows) { "Windows" }
            else if cfg!(target_os = "linux") { "Linux" }
            else if cfg!(target_os = "macos") { "macOS" }
            else { "Unknown" };

        println!();
        println!("========================================================");
        println!("  MasterSelects Native Helper v{}", env!("CARGO_PKG_VERSION"));
        println!("  Platform: {}", os_name);
        println!("========================================================");
        println!("  WebSocket: ws://127.0.0.1:{}", args.port);
        println!("  HTTP File: http://127.0.0.1:{}", args.port + 1);
        println!("  Cache:     {} MB (max {} decoders)", args.cache_mb, args.max_decoders);
        println!("  FFmpeg:    initialized");
        println!("  HW Accel:  {}", if hw_accel.is_empty() { "none detected".to_string() } else { hw_accel.join(", ") });
        println!("  yt-dlp:    {} [{}]", ytdlp_path, if ytdlp_available { "OK" } else { "NOT FOUND" });
        println!("  deno:      {}", if deno_available { "OK" } else { "not found (optional)" });
        println!("  Downloads: {}", utils::get_download_dir().display());
        println!("========================================================");
        println!();
    }

    // Start server
    if let Err(e) = server::run(config).await {
        error!("Server error: {}", e);
        return Err(e);
    }

    Ok(())
}
