#!/usr/bin/env python3
"""
MatAnyone2 Video Matting Server for MasterSelects.

Standalone HTTP server that runs MatAnyone2 inference.
Spawned as a subprocess by the Rust native helper.

Usage:
    python matanyone2_server.py --port 9878 --models-dir /path/to/models

Endpoints:
    GET  /health            - Server & model status
    POST /matte             - Submit a matting job
    GET  /progress/<job_id> - Query job progress
    POST /cancel/<job_id>   - Cancel a running job
"""

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Optional

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[matanyone2] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("matanyone2_server")

model: Any = None
model_device: str = "cuda"
gpu_name: str = "N/A"
cuda_version: str = "N/A"
models_dir: str = ""

jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()

TERMINAL_JOB_STATUSES = frozenset({"complete", "error", "cancelled"})
TERMINAL_JOB_TTL_SECONDS = 30 * 60
MAX_TERMINAL_JOBS = 32

inference_lock = threading.Lock()


def _mark_job_terminal_locked(
    job: dict[str, Any], status: str, message: Optional[str] = None
) -> None:
    """Mark a job terminal while `jobs_lock` is held."""
    job["status"] = status
    job["finished_at"] = time.monotonic()
    job["thread"] = None
    if message is not None:
        job["message"] = message


def _prune_terminal_jobs_locked(now: Optional[float] = None) -> int:
    """Bound retained terminal jobs by age and count while `jobs_lock` is held."""
    current_time = time.monotonic() if now is None else now
    terminal = [
        (job_id, float(job.get("finished_at") or current_time))
        for job_id, job in jobs.items()
        if job.get("status") in TERMINAL_JOB_STATUSES
    ]

    remove_ids = {
        job_id
        for job_id, finished_at in terminal
        if current_time - finished_at >= TERMINAL_JOB_TTL_SECONDS
    }
    retained = sorted(
        (item for item in terminal if item[0] not in remove_ids),
        key=lambda item: item[1],
        reverse=True,
    )
    remove_ids.update(job_id for job_id, _ in retained[MAX_TERMINAL_JOBS:])

    for job_id in remove_ids:
        jobs.pop(job_id, None)
    return len(remove_ids)


def _safe_filename_component(value: str, fallback: str) -> str:
    """Return an ASCII-only filename component for OpenCV output paths."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    if not cleaned:
        cleaned = fallback
    return cleaned[:120]


def _windows_short_path(path: str) -> str:
    """Return a Windows 8.3 short path when available, otherwise path."""
    if os.name != "nt":
        return path

    try:
        import ctypes

        get_short_path_name = ctypes.windll.kernel32.GetShortPathNameW
        required = get_short_path_name(path, None, 0)
        if required == 0:
            return path

        buffer = ctypes.create_unicode_buffer(required)
        result = get_short_path_name(path, buffer, required)
        return buffer.value if result else path
    except Exception:
        return path


def _opencv_path(path: str) -> str:
    """Normalize paths before handing them to OpenCV on Windows."""
    return _windows_short_path(path)


def _read_grayscale_image(path: str) -> Any:
    """Read a grayscale image with a Unicode-safe fallback for Windows paths."""
    import cv2
    import numpy as np

    image = cv2.imread(_opencv_path(path), cv2.IMREAD_GRAYSCALE)
    if image is not None:
        return image

    try:
        encoded = np.fromfile(path, dtype=np.uint8)
        if encoded.size == 0:
            return None
        return cv2.imdecode(encoded, cv2.IMREAD_GRAYSCALE)
    except Exception:
        log.warning("Unicode-safe mask read failed for %s", path, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def load_model(models_directory: str) -> bool:
    """Load the MatAnyone2 model into an NVIDIA CUDA GPU.

    Returns True on success, False on failure.
    """
    global model, model_device, gpu_name, cuda_version

    try:
        import torch

        if not torch.cuda.is_available():
            log.error(
                "MatAnyone2 requires an accessible NVIDIA CUDA GPU; "
                "CPU execution is disabled in MasterSelects."
            )
            return False

        model_device = "cuda"
        gpu_name = torch.cuda.get_device_name(0)
        cuda_version = torch.version.cuda or "unknown"
        log.info("CUDA available: %s (CUDA %s)", gpu_name, cuda_version)

    except ImportError:
        log.error("PyTorch is not installed. Cannot proceed.")
        return False

    try:
        from matanyone2 import MatAnyone2
        from omegaconf import OmegaConf

        model_path = Path(models_directory)
        log.info("Loading MatAnyone2 model from %s ...", model_path)

        config_path = model_path / "config.json"
        weights_path = model_path / "model.safetensors"
        if not config_path.is_file() or not weights_path.is_file():
            raise FileNotFoundError(
                "Local MatAnyone2 config.json/model.safetensors are missing; "
                "download the model through MasterSelects first"
            )

        # The final safetensors checkpoint already contains both encoders.
        # Upstream defaults to downloading ResNet18+50 from torch hub before
        # immediately overwriting them, which breaks offline startup.
        config_data = json.loads(config_path.read_text(encoding="utf-8"))
        cfg = OmegaConf.create(config_data["cfg"])
        cfg.model.pretrained_resnet = False
        model = MatAnyone2.from_pretrained(
            str(model_path),
            cfg=cfg,
            single_object=bool(config_data.get("single_object", True)),
            local_files_only=True,
        )
        model = model.to(model_device)
        log.info("Model loaded successfully on %s", model_device)
        return True

    except ImportError:
        log.error(
            "matanyone2 package is not installed. "
            "Install it with: pip install matanyone2"
        )
        return False
    except Exception as exc:
        log.error("Failed to load MatAnyone2 model: %s", exc, exc_info=True)
        return False


# ---------------------------------------------------------------------------
# Inference worker
# ---------------------------------------------------------------------------
def _run_inference(job_id: str, video_path: str, mask_path: str,
                   output_dir: str, start_frame: Optional[int],
                   end_frame: Optional[int]) -> None:
    """Run matting inference in a background thread.

    Updates the job dict in-place with progress and results.
    """
    job = jobs[job_id]
    cancel_event: threading.Event = job["cancel_event"]

    video_name = _safe_filename_component(Path(video_path).stem, f"matte_{job_id}")
    # VP9 WebM preserves an actual alpha plane; MP4/mp4v silently discarded it.
    fg_output = os.path.join(output_dir, f"{video_name}_foreground.webm")
    alpha_output = os.path.join(output_dir, f"{video_name}_alpha.webm")

    try:
        os.makedirs(output_dir, exist_ok=True)

        # ---- Acquire the GPU lock (one job at a time) ----
        log.info("[%s] Waiting for GPU lock ...", job_id)
        inference_lock.acquire()
        try:
            if cancel_event.is_set():
                _set_job_cancelled(job_id)
                return
            log.info("[%s] GPU lock acquired. Starting inference.", job_id)
            _do_inference(
                job_id, video_path, mask_path, output_dir,
                fg_output, alpha_output,
                start_frame, end_frame, cancel_event,
            )
        finally:
            inference_lock.release()

    except Exception as exc:
        log.error("[%s] Inference failed: %s", job_id, exc, exc_info=True)
        with jobs_lock:
            _mark_job_terminal_locked(job, "error", _exception_message(exc))
            _prune_terminal_jobs_locked()


def _exception_message(exc: BaseException) -> str:
    message = str(exc).strip()
    if message:
        return message
    return exc.__class__.__name__


def _do_inference(job_id: str, video_path: str, mask_path: str,
                  output_dir: str, fg_output: str, alpha_output: str,
                  start_frame: Optional[int], end_frame: Optional[int],
                  cancel_event: threading.Event) -> None:
    """Run the official InferenceCore state machine frame by frame.

    The upstream convenience method buffers the complete video and cannot
    expose cancellation/progress. This mirrors its warm-up/step semantics but
    streams frames into VP9 encoders instead.
    """
    _manual_frame_processing(
        job_id, video_path, mask_path, fg_output, alpha_output,
        start_frame, end_frame, cancel_event,
    )


def _manual_frame_processing_core(
    job_id: str, video_path: str, mask_path: str,
    fg_output: str, alpha_output: str,
    start_frame: Optional[int], end_frame: Optional[int],
    cancel_event: threading.Event,
) -> None:
    """Frame-by-frame inference using MatAnyone2's official InferenceCore."""
    import cv2
    import numpy as np
    import torch
    from matanyone2.inference.inference_core import InferenceCore
    from matanyone2.utils.device import safe_autocast

    job = jobs[job_id]

    cap = cv2.VideoCapture(_opencv_path(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    actual_start = start_frame if start_frame is not None else 0
    actual_end = end_frame if end_frame is not None else total_frames
    actual_end = min(actual_end, total_frames)
    frame_total = max(actual_end - actual_start, 0)
    if frame_total == 0:
        cap.release()
        raise RuntimeError("No video frames selected for matting")

    with jobs_lock:
        job["status"] = "processing"
        job["current_frame"] = 0
        job["total_frames"] = frame_total

    mask_img = _read_grayscale_image(mask_path)
    if mask_img is None:
        cap.release()
        raise RuntimeError(f"Cannot read mask image: {mask_path}")
    mask_img = cv2.resize(mask_img, (width, height))
    _, mask_binary = cv2.threshold(mask_img, 128, 255, cv2.THRESH_BINARY)
    mask_tensor = torch.from_numpy(mask_binary.astype(np.float32)).to(model_device)

    fg_writer, alpha_writer = _open_vp9_writers(
        fg_output, alpha_output, fps, width, height
    )

    if actual_start > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, actual_start)

    ret, first_frame = cap.read()
    if not ret:
        cap.release()
        _close_encoder(fg_writer, "foreground")
        _close_encoder(alpha_writer, "alpha")
        raise RuntimeError(f"Cannot read first video frame: {video_path}")

    processor = InferenceCore(model, cfg=model.cfg, device=model_device)
    objects = [1]
    n_warmup = 10
    frame_index = 0

    def prepare_frame(frame_bgr: np.ndarray) -> tuple[np.ndarray, torch.Tensor]:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = (
            torch.from_numpy(frame_rgb.astype(np.float32))
            .permute(2, 0, 1)
            .contiguous()
        )
        return frame_rgb, (image / 255.0).float().to(model_device)

    def write_outputs(frame_rgb: np.ndarray, output_prob: torch.Tensor) -> None:
        mask = processor.output_prob_to_mask(output_prob)
        pha = mask.unsqueeze(2).float().cpu().numpy()
        pha = np.clip(pha, 0.0, 1.0)

        # Store straight (unpremultiplied) RGB plus an actual alpha plane.
        rgba_u8 = np.dstack((frame_rgb, np.round(pha[:, :, 0] * 255.0).astype(np.uint8)))
        alpha_u8 = np.round(np.clip(pha[:, :, 0] * 255.0, 0, 255)).astype(np.uint8)
        fg_writer.stdin.write(rgba_u8.tobytes())
        alpha_writer.stdin.write(alpha_u8.tobytes())

    try:
        first_rgb, first_image = prepare_frame(first_frame)
        with torch.inference_mode(), safe_autocast():
            output_prob = processor.step(first_image, mask_tensor, objects=objects)
            output_prob = processor.step(first_image, first_frame_pred=True)
            for _ in range(1, n_warmup + 1):
                if cancel_event.is_set():
                    _set_job_cancelled(job_id)
                    return
                output_prob = processor.step(first_image, first_frame_pred=True)

        write_outputs(first_rgb, output_prob)
        frame_index = 1
        with jobs_lock:
            job["current_frame"] = frame_index

        for abs_frame in range(actual_start + 1, actual_end):
            if cancel_event.is_set():
                _set_job_cancelled(job_id)
                return

            ret, frame = cap.read()
            if not ret:
                log.warning("[%s] Video ended at frame %d", job_id, abs_frame)
                break

            frame_rgb, image = prepare_frame(frame)
            with torch.inference_mode(), safe_autocast():
                output_prob = processor.step(image)
            write_outputs(frame_rgb, output_prob)

            frame_index += 1
            with jobs_lock:
                job["current_frame"] = frame_index

            if frame_index % 50 == 0:
                log.info(
                    "[%s] Progress: %d / %d frames",
                    job_id, frame_index, job["total_frames"],
                )
    finally:
        cap.release()
        _close_encoder(fg_writer, "foreground")
        _close_encoder(alpha_writer, "alpha")

    if cancel_event.is_set():
        return

    with jobs_lock:
        _mark_job_terminal_locked(job, "complete")
        job["foreground_path"] = fg_output
        job["alpha_path"] = alpha_output
        _prune_terminal_jobs_locked()

    log.info("[%s] Inference complete. %d frames processed.", job_id, frame_index)


def _ffmpeg_executable() -> str:
    """Use imageio's bundled ffmpeg when available, then fall back to PATH."""
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        executable = shutil.which("ffmpeg")
        if executable:
            return executable
    raise RuntimeError("FFmpeg is required for transparent VP9 WebM output")


def _open_vp9_writers(
    foreground_path: str,
    alpha_path: str,
    fps: float,
    width: int,
    height: int,
) -> tuple[subprocess.Popen, subprocess.Popen]:
    ffmpeg = _ffmpeg_executable()
    common = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-video_size", f"{width}x{height}",
        "-framerate", str(fps),
    ]
    foreground = subprocess.Popen(
        common
        + [
            "-pixel_format", "rgba", "-i", "-", "-an",
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0", "-crf", "18", "-b:v", "0",
            foreground_path,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    alpha = subprocess.Popen(
        common
        + [
            "-pixel_format", "gray", "-i", "-", "-an",
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
            "-crf", "18", "-b:v", "0", alpha_path,
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return foreground, alpha


def _close_encoder(process: subprocess.Popen, label: str) -> None:
    if process.stdin and not process.stdin.closed:
        process.stdin.close()
    try:
        return_code = process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise RuntimeError(f"Timed out finalizing {label} VP9 output")
    if return_code != 0:
        stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
        raise RuntimeError(f"{label} VP9 encoder failed: {stderr.strip()}")


def _manual_frame_processing(
    job_id: str, video_path: str, mask_path: str,
    fg_output: str, alpha_output: str,
    start_frame: Optional[int], end_frame: Optional[int],
    cancel_event: threading.Event,
) -> None:
    """Frame-by-frame fallback using MatAnyone2 InferenceCore."""
    return _manual_frame_processing_core(
        job_id, video_path, mask_path, fg_output, alpha_output,
        start_frame, end_frame, cancel_event,
    )


def _set_job_cancelled(job_id: str) -> None:
    with jobs_lock:
        _mark_job_terminal_locked(
            jobs[job_id], "cancelled", "Job cancelled by user"
        )
        _prune_terminal_jobs_locked()
    log.info("[%s] Job cancelled.", job_id)


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------
class MattingHandler(BaseHTTPRequestHandler):
    """Handles HTTP requests for the matting server."""

    # Suppress default request logging (we log ourselves).
    def log_message(self, format: str, *args: Any) -> None:
        log.debug("HTTP %s", format % args)

    # ----- Routing -----

    def do_GET(self) -> None:
        if self.path == "/health":
            self._handle_health()
        elif self.path.startswith("/progress/"):
            job_id = self.path[len("/progress/"):]
            self._handle_progress(job_id)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/matte":
            self._handle_matte()
        elif self.path.startswith("/cancel/"):
            job_id = self.path[len("/cancel/"):]
            self._handle_cancel(job_id)
        else:
            self._send_json(404, {"error": "Not found"})

    # ----- Endpoint implementations -----

    def _handle_health(self) -> None:
        with jobs_lock:
            _prune_terminal_jobs_locked()
            active_jobs = sum(
                1 for job in jobs.values()
                if job["status"] in ("queued", "processing")
            )
        self._send_json(200, {
            "status": "ready" if model is not None else "model_not_loaded",
            "model_loaded": model is not None,
            "gpu": gpu_name,
            "cuda": cuda_version,
            "device": model_device,
            "active_jobs": active_jobs,
        })

    def _handle_matte(self) -> None:
        body = self._read_json_body()
        if body is None:
            return  # Error already sent.

        video_path = body.get("video_path")
        mask_path = body.get("mask_path")
        output_dir = body.get("output_dir")

        if not video_path or not mask_path or not output_dir:
            self._send_json(400, {
                "error": "Missing required fields: video_path, mask_path, output_dir"
            })
            return

        if not os.path.isfile(video_path):
            self._send_json(400, {"error": f"Video file not found: {video_path}"})
            return

        if not os.path.isfile(mask_path):
            self._send_json(400, {"error": f"Mask file not found: {mask_path}"})
            return

        if model is None:
            self._send_json(503, {"error": "Model not loaded"})
            return

        start_frame = body.get("start_frame")
        end_frame = body.get("end_frame")

        job_id = f"job_{uuid.uuid4().hex[:12]}"
        cancel_event = threading.Event()

        with jobs_lock:
            _prune_terminal_jobs_locked()
            jobs[job_id] = {
                "status": "queued",
                "current_frame": 0,
                "total_frames": 0,
                "foreground_path": None,
                "alpha_path": None,
                "message": None,
                "cancel_event": cancel_event,
                "thread": None,
                "created_at": time.monotonic(),
                "finished_at": None,
            }

        worker = threading.Thread(
            target=_run_inference,
            args=(job_id, video_path, mask_path, output_dir,
                  start_frame, end_frame),
            daemon=True,
            name=f"matting-{job_id}",
        )
        with jobs_lock:
            jobs[job_id]["thread"] = worker
        worker.start()

        log.info(
            "[%s] Job submitted: video=%s mask=%s output=%s",
            job_id, video_path, mask_path, output_dir,
        )
        self._send_json(202, {"job_id": job_id})

    def _handle_progress(self, job_id: str) -> None:
        with jobs_lock:
            _prune_terminal_jobs_locked()
            job = jobs.get(job_id)
            if job is None:
                self._send_json(404, {"error": f"Unknown job: {job_id}"})
                return
            # Build response without internal fields.
            response: dict[str, Any] = {
                "status": job["status"],
                "current_frame": job["current_frame"],
                "total_frames": job["total_frames"],
            }
            if job["status"] == "complete":
                response["foreground_path"] = job["foreground_path"]
                response["alpha_path"] = job["alpha_path"]
            if job["status"] in ("error", "cancelled"):
                response["message"] = job["message"]

        self._send_json(200, response)

    def _handle_cancel(self, job_id: str) -> None:
        with jobs_lock:
            job = jobs.get(job_id)
            if job is None:
                self._send_json(404, {"error": f"Unknown job: {job_id}"})
                return
            if job["status"] in ("complete", "error", "cancelled"):
                self._send_json(200, {
                    "cancelled": False,
                    "reason": f"Job already {job['status']}",
                })
                return
            job["cancel_event"].set()

        log.info("[%s] Cancel requested.", job_id)
        self._send_json(200, {"cancelled": True})

    # ----- Helpers -----

    def _read_json_body(self) -> Optional[dict]:
        """Read and parse JSON request body. Returns None on error
        (error response already sent)."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._send_json(400, {"error": "Empty request body"})
            return None
        try:
            raw = self.rfile.read(content_length)
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._send_json(400, {"error": f"Invalid JSON: {exc}"})
            return None

    def _send_json(self, status: int, data: dict) -> None:
        """Send a JSON HTTP response."""
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------------------------------------------------------------------------
# Server startup
# ---------------------------------------------------------------------------
def run_server(port: int, model_dir: str) -> None:
    """Initialize the model and start the HTTP server."""
    global models_dir
    models_dir = model_dir

    log.info("MatAnyone2 Server starting ...")
    log.info("  Port:       %d", port)
    log.info("  Models dir: %s", model_dir)

    # A model-less process cannot serve requests. Exit so the Rust supervisor
    # reports startup failure immediately instead of timing out on /health.
    success = load_model(model_dir)
    if not success:
        raise SystemExit(2)

    server = HTTPServer(("127.0.0.1", port), MattingHandler)
    log.info("Listening on http://127.0.0.1:%d", port)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down ...")
    finally:
        server.server_close()
        log.info("Server stopped.")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="MatAnyone2 video matting HTTP server for MasterSelects",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=9878,
        help="Port to listen on (default: 9878)",
    )
    parser.add_argument(
        "--models-dir",
        type=str,
        required=True,
        help="Directory containing MatAnyone2 model weights",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.models_dir):
        log.warning(
            "Models directory does not exist: %s  (will attempt download)",
            args.models_dir,
        )
        os.makedirs(args.models_dir, exist_ok=True)

    run_server(args.port, args.models_dir)


if __name__ == "__main__":
    main()
