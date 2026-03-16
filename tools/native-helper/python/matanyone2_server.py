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
import sys
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Logging — write to stderr so the Rust parent process can capture it.
# ---------------------------------------------------------------------------
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="[matanyone2] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("matanyone2_server")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
model: Any = None
model_device: str = "cpu"
gpu_name: str = "N/A"
cuda_version: str = "N/A"
models_dir: str = ""

# Job registry: job_id -> JobInfo dict
# Each job contains: status, current_frame, total_frames, foreground_path,
# alpha_path, message, cancel_event, thread
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()

# Serialize GPU access — only one inference job at a time.
inference_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def load_model(models_directory: str) -> bool:
    """Load the MatAnyone2 model into GPU (or CPU fallback).

    Returns True on success, False on failure.
    """
    global model, model_device, gpu_name, cuda_version

    try:
        import torch

        if torch.cuda.is_available():
            model_device = "cuda"
            gpu_name = torch.cuda.get_device_name(0)
            cuda_version = torch.version.cuda or "unknown"
            log.info("CUDA available: %s (CUDA %s)", gpu_name, cuda_version)
        else:
            model_device = "cpu"
            gpu_name = "N/A (CPU mode)"
            cuda_version = "N/A"
            log.warning("CUDA not available — running on CPU (will be slow)")

    except ImportError:
        log.error("PyTorch is not installed. Cannot proceed.")
        return False

    try:
        from matanyone2 import MatAnyone2

        log.info("Loading MatAnyone2 model from %s ...", models_directory)
        model = MatAnyone2.from_pretrained(
            "PeiqingYang/MatAnyone2",
            local_dir=models_directory,
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

    video_name = Path(video_path).stem
    fg_output = os.path.join(output_dir, f"{video_name}_foreground.mp4")
    alpha_output = os.path.join(output_dir, f"{video_name}_alpha.mp4")

    try:
        os.makedirs(output_dir, exist_ok=True)

        # ---- Acquire the GPU lock (one job at a time) ----
        log.info("[%s] Waiting for GPU lock ...", job_id)
        inference_lock.acquire()
        if cancel_event.is_set():
            _set_job_cancelled(job_id)
            return
        log.info("[%s] GPU lock acquired. Starting inference.", job_id)

        try:
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
            job["status"] = "error"
            job["message"] = str(exc)


def _do_inference(job_id: str, video_path: str, mask_path: str,
                  output_dir: str, fg_output: str, alpha_output: str,
                  start_frame: Optional[int], end_frame: Optional[int],
                  cancel_event: threading.Event) -> None:
    """Core inference logic. Tries the high-level API first, then falls back
    to manual frame-by-frame processing."""

    job = jobs[job_id]

    # ------------------------------------------------------------------
    # Attempt 1: High-level API (model.process / model.run / model.__call__)
    # ------------------------------------------------------------------
    try:
        log.info("[%s] Trying high-level MatAnyone2 API ...", job_id)

        with jobs_lock:
            job["status"] = "processing"

        # Different versions of the library may expose different names.
        process_fn = (
            getattr(model, "process", None)
            or getattr(model, "run", None)
            or getattr(model, "__call__", None)
        )
        if process_fn is None:
            raise AttributeError("No high-level API found on model object")

        kwargs: dict[str, Any] = {
            "video_path": video_path,
            "mask_path": mask_path,
            "output_dir": output_dir,
        }
        # Only pass frame range if explicitly specified.
        if start_frame is not None:
            kwargs["start_frame"] = start_frame
        if end_frame is not None:
            kwargs["end_frame"] = end_frame

        result = process_fn(**kwargs)

        # Determine output paths from result or use defaults.
        if isinstance(result, dict):
            fg_output = result.get("foreground_path", fg_output)
            alpha_output = result.get("alpha_path", alpha_output)

        if not os.path.isfile(fg_output) or not os.path.isfile(alpha_output):
            raise FileNotFoundError(
                f"Expected outputs not found: {fg_output}, {alpha_output}"
            )

        with jobs_lock:
            job["status"] = "complete"
            job["foreground_path"] = fg_output
            job["alpha_path"] = alpha_output
        log.info("[%s] High-level API completed successfully.", job_id)
        return

    except Exception as api_exc:
        log.warning(
            "[%s] High-level API failed (%s). Falling back to manual "
            "frame-by-frame processing.",
            job_id, api_exc,
        )

    # ------------------------------------------------------------------
    # Attempt 2: Manual frame-by-frame processing with OpenCV
    # ------------------------------------------------------------------
    _manual_frame_processing(
        job_id, video_path, mask_path, fg_output, alpha_output,
        start_frame, end_frame, cancel_event,
    )


def _manual_frame_processing(
    job_id: str, video_path: str, mask_path: str,
    fg_output: str, alpha_output: str,
    start_frame: Optional[int], end_frame: Optional[int],
    cancel_event: threading.Event,
) -> None:
    """Frame-by-frame fallback using OpenCV + torch."""
    import cv2
    import numpy as np
    import torch

    job = jobs[job_id]

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    actual_start = start_frame if start_frame is not None else 0
    actual_end = end_frame if end_frame is not None else total_frames

    with jobs_lock:
        job["status"] = "processing"
        job["current_frame"] = 0
        job["total_frames"] = actual_end - actual_start

    # Read the initial mask (binary, single channel).
    mask_img = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if mask_img is None:
        raise RuntimeError(f"Cannot read mask image: {mask_path}")
    mask_img = cv2.resize(mask_img, (width, height))
    # Binarize: threshold at 128.
    _, mask_binary = cv2.threshold(mask_img, 128, 255, cv2.THRESH_BINARY)

    # Prepare mask tensor for the model (1, 1, H, W) float in [0, 1].
    mask_tensor = (
        torch.from_numpy(mask_binary.astype(np.float32) / 255.0)
        .unsqueeze(0)
        .unsqueeze(0)
        .to(model_device)
    )

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    fg_writer = cv2.VideoWriter(fg_output, fourcc, fps, (width, height))
    alpha_writer = cv2.VideoWriter(alpha_output, fourcc, fps, (width, height), False)

    if not fg_writer.isOpened() or not alpha_writer.isOpened():
        cap.release()
        raise RuntimeError("Failed to open output video writers")

    # Seek to start frame if needed.
    if actual_start > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, actual_start)

    # Model state for temporal propagation (if supported).
    recurrent_state = None
    frame_index = 0

    try:
        for abs_frame in range(actual_start, actual_end):
            if cancel_event.is_set():
                _set_job_cancelled(job_id)
                return

            ret, frame = cap.read()
            if not ret:
                log.warning("[%s] Video ended at frame %d", job_id, abs_frame)
                break

            # Convert BGR -> RGB, normalize to [0, 1], shape (1, 3, H, W).
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_tensor = (
                torch.from_numpy(frame_rgb.astype(np.float32) / 255.0)
                .permute(2, 0, 1)
                .unsqueeze(0)
                .to(model_device)
            )

            with torch.no_grad():
                # Try different model inference signatures.
                try:
                    if recurrent_state is not None:
                        # Propagation mode: use previous state.
                        result = model(
                            frame_tensor,
                            mask_tensor if frame_index == 0 else None,
                            recurrent_state,
                        )
                    else:
                        result = model(frame_tensor, mask_tensor)

                    # Parse result — adapt to whatever the model returns.
                    if isinstance(result, tuple):
                        if len(result) == 3:
                            alpha_pred, fg_pred, recurrent_state = result
                        elif len(result) == 2:
                            alpha_pred, fg_pred = result
                        else:
                            alpha_pred = result[0]
                            fg_pred = None
                    elif isinstance(result, dict):
                        alpha_pred = result.get("alpha", result.get("matte"))
                        fg_pred = result.get("foreground", result.get("fg"))
                        recurrent_state = result.get("state", result.get("memory"))
                    else:
                        alpha_pred = result
                        fg_pred = None

                except Exception as model_exc:
                    log.error(
                        "[%s] Model forward pass failed at frame %d: %s",
                        job_id, frame_index, model_exc,
                    )
                    raise

            # Convert alpha prediction to numpy uint8.
            alpha_np = (
                alpha_pred.squeeze().cpu().clamp(0, 1).numpy() * 255
            ).astype(np.uint8)
            alpha_np = cv2.resize(alpha_np, (width, height))

            # Foreground: either from model or composited.
            if fg_pred is not None:
                fg_np = (
                    fg_pred.squeeze().cpu().clamp(0, 1)
                    .permute(1, 2, 0).numpy() * 255
                ).astype(np.uint8)
                fg_np = cv2.resize(fg_np, (width, height))
                fg_bgr = cv2.cvtColor(fg_np, cv2.COLOR_RGB2BGR)
            else:
                # Composite foreground: original * alpha.
                alpha_3ch = cv2.merge([alpha_np, alpha_np, alpha_np])
                fg_bgr = (
                    frame.astype(np.float32) * (alpha_3ch.astype(np.float32) / 255.0)
                ).astype(np.uint8)

            fg_writer.write(fg_bgr)
            alpha_writer.write(alpha_np)

            frame_index += 1
            with jobs_lock:
                job["current_frame"] = frame_index

            # Log progress periodically.
            if frame_index % 50 == 0:
                log.info(
                    "[%s] Progress: %d / %d frames",
                    job_id, frame_index, job["total_frames"],
                )

    finally:
        cap.release()
        fg_writer.release()
        alpha_writer.release()

    # If we were cancelled, the status is already set.
    if cancel_event.is_set():
        return

    with jobs_lock:
        job["status"] = "complete"
        job["foreground_path"] = fg_output
        job["alpha_path"] = alpha_output

    log.info(
        "[%s] Inference complete. %d frames processed.", job_id, frame_index
    )


def _set_job_cancelled(job_id: str) -> None:
    with jobs_lock:
        jobs[job_id]["status"] = "cancelled"
        jobs[job_id]["message"] = "Job cancelled by user"
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
        self._send_json(200, {
            "status": "ready" if model is not None else "model_not_loaded",
            "model_loaded": model is not None,
            "gpu": gpu_name,
            "cuda": cuda_version,
            "device": model_device,
            "active_jobs": sum(
                1 for j in jobs.values() if j["status"] == "processing"
            ),
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
            jobs[job_id] = {
                "status": "queued",
                "current_frame": 0,
                "total_frames": 0,
                "foreground_path": None,
                "alpha_path": None,
                "message": None,
                "cancel_event": cancel_event,
                "thread": None,
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

    # Load the model (non-fatal: server starts even if model fails to load,
    # so the /health endpoint can report the problem).
    success = load_model(model_dir)
    if not success:
        log.warning(
            "Model failed to load. Server will start but /matte will return 503."
        )

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
