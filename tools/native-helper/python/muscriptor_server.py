#!/usr/bin/env python3
"""Persistent local MuScriptor sidecar used by the MasterSelects helper.

The HTTP surface is intentionally loopback-only and job based. A model stays
resident between jobs; progress is reported per five-second model chunk.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="[muscriptor] %(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("muscriptor_server")

model: Any = None
model_variant = "small"
model_device = "cpu"
model_error: str | None = None
model_loading = True
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = threading.Lock()
inference_lock = threading.Lock()

TERMINAL_JOB_TTL_SECONDS = 15 * 60
MAX_TERMINAL_JOBS = 32
TERMINAL_STATUSES = frozenset(("complete", "error", "cancelled"))


def _safe_error(exc: BaseException) -> str:
    message = str(exc).strip()
    return message if message else exc.__class__.__name__


def load_model(model_path: str, variant: str, requested_device: str | None) -> bool:
    """Load one already-downloaded model variant and keep it resident."""
    global model, model_device, model_error, model_loading
    model_loading = True
    try:
        import torch
        from muscriptor import TranscriptionModel

        if requested_device and requested_device.lower() != "auto":
            model_device = requested_device
        elif torch.cuda.is_available():
            model_device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            model_device = "mps"
        else:
            model_device = "cpu"
        log.info("Loading MuScriptor %s on %s", variant, model_device)
        model = TranscriptionModel.load_model(
            weights_path=model_path,
            device=model_device,
        )
        model_error = None
        return True
    except Exception as exc:
        model = None
        model_error = _safe_error(exc)
        log.exception("MuScriptor model load failed")
        return False
    finally:
        model_loading = False


def _cleanup_terminal_jobs_locked(now: float | None = None) -> None:
    """Keep completed job metadata bounded without disturbing active work."""
    current = time.monotonic() if now is None else now
    expired = [
        job_id
        for job_id, job in jobs.items()
        if job["status"] in TERMINAL_STATUSES
        and current - float(job.get("finished_at", current)) >= TERMINAL_JOB_TTL_SECONDS
    ]
    for job_id in expired:
        jobs.pop(job_id, None)

    terminal = sorted(
        (
            (float(job.get("finished_at", current)), job_id)
            for job_id, job in jobs.items()
            if job["status"] in TERMINAL_STATUSES
        ),
        key=lambda value: value[0],
    )
    for _, job_id in terminal[: max(0, len(terminal) - MAX_TERMINAL_JOBS)]:
        jobs.pop(job_id, None)


def _set_terminal(job_id: str, status: str, **values: Any) -> None:
    with jobs_lock:
        job = jobs[job_id]
        job["status"] = status
        job["finished_at"] = time.monotonic()
        job.update(values)
        _cleanup_terminal_jobs_locked()


def _run_transcription(
    job_id: str,
    audio_path: str,
    instruments: list[str] | None,
) -> None:
    job = jobs[job_id]
    cancel: threading.Event = job["cancel"]
    if cancel.is_set():
        _set_terminal(job_id, "cancelled", message="Cancelled")
        return

    try:
        with inference_lock:
            if cancel.is_set():
                _set_terminal(job_id, "cancelled", message="Cancelled")
                return
            with jobs_lock:
                job["status"] = "processing"

            from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent

            starts: dict[int, NoteStartEvent] = {}
            notes: list[dict[str, Any]] = []
            for event in model.transcribe(audio_path, instruments=instruments or None):
                if cancel.is_set():
                    _set_terminal(job_id, "cancelled", message="Cancelled")
                    return
                if isinstance(event, ProgressEvent):
                    with jobs_lock:
                        job["completed"] = int(event.completed)
                        job["total"] = int(event.total)
                elif isinstance(event, NoteStartEvent):
                    starts[int(event.index)] = event
                elif isinstance(event, NoteEndEvent):
                    start = starts.pop(int(event.start_event_index), event.start_event)
                    notes.append(
                        {
                            "pitch": int(start.pitch),
                            "start_time": float(start.start_time),
                            "end_time": float(event.end_time),
                            "instrument": str(start.instrument),
                        }
                    )

            notes.sort(key=lambda n: (n["start_time"], n["pitch"], n["instrument"]))
            with jobs_lock:
                total = int(job["total"])
                job["completed"] = total
            _set_terminal(job_id, "complete", notes=notes)
    except Exception as exc:
        log.exception("Transcription job %s failed", job_id)
        _set_terminal(job_id, "error", message=_safe_error(exc))


class Handler(BaseHTTPRequestHandler):
    server_version = "MasterSelects-MuScriptor/1"

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug(fmt, *args)

    def do_GET(self) -> None:
        if self.path == "/health":
            status = "loading" if model_loading else (
                "ready" if model is not None else "model_error"
            )
            self._json(
                200,
                {
                    "status": status,
                    "model_loaded": model is not None,
                    "variant": model_variant,
                    "device": model_device,
                    "error": model_error,
                },
            )
            return
        if self.path.startswith("/progress/"):
            self._progress(self.path.removeprefix("/progress/"))
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/transcribe":
            self._transcribe()
            return
        if self.path.startswith("/cancel/"):
            self._cancel(self.path.removeprefix("/cancel/"))
            return
        self._json(404, {"error": "Not found"})

    def _transcribe(self) -> None:
        body = self._read_json()
        if body is None:
            return
        audio_path = body.get("audio_path")
        instruments = body.get("instruments")
        if not isinstance(audio_path, str) or not Path(audio_path).is_file():
            self._json(400, {"error": "audio_path must reference an existing file"})
            return
        if instruments is not None and not (
            isinstance(instruments, list)
            and all(isinstance(value, str) for value in instruments)
        ):
            self._json(400, {"error": "instruments must be a string array"})
            return
        if model is None:
            self._json(503, {"error": model_error or "Model is not loaded"})
            return

        job_id = f"mus_{uuid.uuid4().hex[:12]}"
        cancel = threading.Event()
        with jobs_lock:
            _cleanup_terminal_jobs_locked()
            jobs[job_id] = {
                "status": "queued",
                "completed": 0,
                "total": 0,
                "notes": None,
                "message": None,
                "cancel": cancel,
                "created_at": time.monotonic(),
                "finished_at": None,
            }
        thread = threading.Thread(
            target=_run_transcription,
            args=(job_id, audio_path, instruments),
            name=f"muscriptor-{job_id}",
            daemon=True,
        )
        thread.start()
        self._json(202, {"job_id": job_id})

    def _progress(self, job_id: str) -> None:
        with jobs_lock:
            _cleanup_terminal_jobs_locked()
            job = jobs.get(job_id)
            if job is None:
                self._json(404, {"error": "Unknown job"})
                return
            response = {
                "status": job["status"],
                "completed": job["completed"],
                "total": job["total"],
            }
            if job["status"] == "complete":
                response["notes"] = job["notes"]
            if job["status"] in ("error", "cancelled"):
                response["message"] = job["message"]
        self._json(200, response)

    def _cancel(self, job_id: str) -> None:
        with jobs_lock:
            _cleanup_terminal_jobs_locked()
            job = jobs.get(job_id)
            if job is None:
                self._json(404, {"error": "Unknown job"})
                return
            if job["status"] in ("complete", "error", "cancelled"):
                self._json(200, {"cancelled": False, "status": job["status"]})
                return
            job["cancel"].set()
        self._json(200, {"cancelled": True})

    def _read_json(self) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("Invalid request size")
            value = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("JSON body must be an object")
            return value
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
            return None

    def _json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    global model_variant
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--variant", choices=("small", "medium", "large"), default="small")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--device")
    parser.add_argument("--cache-dir", required=True)
    args = parser.parse_args()

    os.environ["HF_HOME"] = str(Path(args.cache_dir).resolve())
    model_variant = args.variant
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    loader = threading.Thread(
        target=load_model,
        args=(args.model_path, args.variant, args.device),
        name="muscriptor-model-loader",
        daemon=True,
    )
    loader.start()
    log.info("Listening on http://127.0.0.1:%d", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
