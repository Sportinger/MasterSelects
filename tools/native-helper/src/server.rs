//! Native Helper server orchestration.

use anyhow::Result;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{error, info};

#[cfg(windows)]
use std::sync::atomic::Ordering;

use crate::session::AppState;

/// Server configuration
pub struct ServerConfig {
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub auth_token: Option<String>,
}

/// Run the WebSocket server and HTTP file server
pub async fn run(config: ServerConfig) -> Result<()> {
    let ws_addr = format!("127.0.0.1:{}", config.port);
    let http_port = config.port + 1;

    let listener = TcpListener::bind(&ws_addr).await?;
    info!("WebSocket server listening on ws://{}", ws_addr);

    let state = Arc::new(AppState::new(config.auth_token.clone()));
    let allowed_origins = Arc::new(config.allowed_origins.clone());

    let http_state = state.clone();
    let http_origins = allowed_origins.clone();
    tokio::spawn(async move {
        crate::http_server::run(http_port, http_state, http_origins).await;
    });

    while let Ok((stream, addr)) = listener.accept().await {
        let state = state.clone();
        let allowed_origins = allowed_origins.clone();

        tokio::spawn(async move {
            if let Err(e) =
                crate::websocket_server::handle_connection(stream, addr, state, allowed_origins)
                    .await
            {
                error!("Connection error from {}: {}", addr, e);
            }
        });
    }

    Ok(())
}

/// Run the server with graceful shutdown support (Windows tray mode).
#[cfg(windows)]
pub async fn run_with_shutdown(
    config: ServerConfig,
    tray_state: Arc<crate::tray::TrayState>,
) -> Result<()> {
    let ws_addr = format!("127.0.0.1:{}", config.port);
    let http_port = config.port + 1;

    let listener = TcpListener::bind(&ws_addr).await?;
    info!("WebSocket server listening on ws://{}", ws_addr);

    let state = Arc::new(AppState::new(config.auth_token.clone()));
    let allowed_origins = Arc::new(config.allowed_origins.clone());

    tray_state.running.store(true, Ordering::Relaxed);

    let http_state = state.clone();
    let http_origins = allowed_origins.clone();
    tokio::spawn(async move {
        crate::http_server::run(http_port, http_state, http_origins).await;
    });

    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        let state = state.clone();
                        let allowed_origins = allowed_origins.clone();
                        let ts = tray_state.clone();

                        ts.connection_count.fetch_add(1, Ordering::Relaxed);

                        tokio::spawn(async move {
                            if let Err(e) = crate::websocket_server::handle_connection(
                                stream,
                                addr,
                                state,
                                allowed_origins,
                            )
                            .await
                            {
                                error!("Connection error from {}: {}", addr, e);
                            }
                            ts.connection_count.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(e) => {
                        error!("Accept error: {}", e);
                    }
                }
            }
            _ = wait_for_quit(&tray_state) => {
                info!("Shutdown requested, stopping server...");
                break;
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
async fn wait_for_quit(tray_state: &Arc<crate::tray::TrayState>) {
    loop {
        if tray_state.quit_requested.load(Ordering::Relaxed) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
