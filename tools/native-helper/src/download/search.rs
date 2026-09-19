use std::process::Stdio;

use tokio::process::Command as TokioCommand;
use tracing::info;

use super::ytdlp::{find_ytdlp, get_deno_args, get_ytdlp_command};
use crate::protocol::{error_codes, Response};

const YTDLP_NOT_FOUND_MESSAGE: &str =
    "yt-dlp not found. Install or update the Native Helper MSI, or install yt-dlp on PATH.";

/// Search YouTube through the user's local yt-dlp installation.
pub async fn handle_search_videos(id: &str, query: &str, max_results: u8) -> Response {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Response::error(id, error_codes::INVALID_URL, "Search query is required");
    }
    if find_ytdlp().is_none() {
        return Response::error(id, error_codes::YTDLP_NOT_FOUND, YTDLP_NOT_FOUND_MESSAGE);
    }

    let result_limit = max_results.clamp(1, 20);
    let result_limit_arg = result_limit.to_string();
    let search_target = format!("ytsearch{}:{}", result_limit, clean_query);
    let ytdlp_cmd = get_ytdlp_command();
    let deno_args = get_deno_args();

    for use_cookies in [false, true] {
        let mut cmd = TokioCommand::new(&ytdlp_cmd);
        crate::utils::no_window(&mut cmd);
        for arg in &deno_args {
            cmd.arg(arg);
        }
        if use_cookies {
            info!("Retrying search_videos with --cookies-from-browser chrome");
            cmd.args(["--cookies-from-browser", "chrome"]);
        }

        let output = cmd
            .args([
                "--dump-json",
                "--flat-playlist",
                "--force-ipv4",
                "--playlist-end",
                &result_limit_arg,
                &search_target,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(output) if output.status.success() => {
                let results = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                    .filter_map(build_search_result)
                    .collect::<Vec<_>>();
                return Response::ok(
                    id,
                    serde_json::json!({
                        "query": clean_query,
                        "results": results,
                    }),
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                if !use_cookies
                    && (stderr.contains("Sign in to confirm") || stderr.contains("not a bot"))
                {
                    continue;
                }
                let error_lines = stderr
                    .lines()
                    .filter(|line| line.contains("ERROR:"))
                    .collect::<Vec<_>>();
                let message = if error_lines.is_empty() {
                    stderr
                } else {
                    error_lines.join("\n")
                };
                return Response::error(id, error_codes::DOWNLOAD_FAILED, message);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Response::error(id, error_codes::YTDLP_NOT_FOUND, YTDLP_NOT_FOUND_MESSAGE)
            }
            Err(error) => {
                return Response::error(id, error_codes::DOWNLOAD_FAILED, error.to_string())
            }
        }
    }

    Response::error(
        id,
        error_codes::DOWNLOAD_FAILED,
        "Search failed after retries",
    )
}

fn build_search_result(info: serde_json::Value) -> Option<serde_json::Value> {
    let video_id = info.get("id")?.as_str()?;
    let url = info
        .get("webpage_url")
        .and_then(|value| value.as_str())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", video_id));
    let thumbnail = info
        .get("thumbnail")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            info.get("thumbnails")
                .and_then(|value| value.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .rev()
                        .find_map(|item| item.get("url")?.as_str())
                })
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", video_id));

    Some(serde_json::json!({
        "id": video_id,
        "title": info.get("title").and_then(|value| value.as_str()).unwrap_or("Untitled video"),
        "thumbnail": thumbnail,
        "channelTitle": info.get("channel").and_then(|value| value.as_str())
            .or_else(|| info.get("uploader").and_then(|value| value.as_str()))
            .unwrap_or("Unknown channel"),
        "durationSeconds": info.get("duration").and_then(|value| value.as_f64()).unwrap_or(0.0),
        "viewCount": info.get("view_count").and_then(|value| value.as_u64()),
        "url": url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_result_uses_canonical_youtube_url_and_thumbnail_fallback() {
        let result = build_search_result(serde_json::json!({
            "id": "abcdefghijk",
            "title": "Reaction",
            "channel": "Example",
            "duration": 83,
            "view_count": 1250,
        }))
        .expect("search result");

        assert_eq!(result["url"], "https://www.youtube.com/watch?v=abcdefghijk");
        assert_eq!(
            result["thumbnail"],
            "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"
        );
        assert_eq!(result["durationSeconds"], 83.0);
        assert_eq!(result["viewCount"], 1250);
    }
}
