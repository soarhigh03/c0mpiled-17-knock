"""Trusted server -> loopback sidecar only. No candidate-facing endpoint or CORS."""
import asyncio
from contextlib import asynccontextmanager
import io
import logging
import os
from pathlib import Path
import re
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
import numpy as np
from scipy.io import wavfile

from .analyzer import Analyzer
from .backend import PellaBackend

MAX_BYTES = 1_000_000
MAX_SECONDS = 12
ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def decode_segment(data):
    try:
        if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError("WAV required")
        sr, wav = wavfile.read(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(422, "invalid_wav") from exc
    if sr != 16000 or wav.ndim != 1 or wav.dtype != np.int16:
        raise HTTPException(422, "require_16000hz_mono_pcm16_wav")
    if len(wav) > MAX_SECONDS * sr:
        raise HTTPException(422, "segment_too_long_max_12_seconds")
    return sr, wav.astype(np.float32) / 32768.0


def create_app(analyzer=None):
    analyzer = analyzer or Analyzer(PellaBackend(os.getenv("KNOCK_ARTIFACTS", "artifacts"), os.getenv("KNOCK_DEVICE", "auto")))

    @asynccontextmanager
    async def lifespan(app):
        try:
            await asyncio.to_thread(analyzer.start)
        except Exception:
            # Health stays 503; analysis can only yield Unable, never a fabricated Pass.
            logging.getLogger(__name__).exception("Voice analyzer startup failed")
        yield

    app = FastAPI(title="Knock voice sidecar", version="0.1.0", lifespan=lifespan)
    app.state.analyzer = analyzer
    app.state.accepting = False

    @app.get("/health")
    def health():
        return JSONResponse({"ready": analyzer.ready, "model": "pella-v2",
                             "startup_error": analyzer.startup_error}, status_code=200 if analyzer.ready else 503)

    @app.get("/v1/diagnostics")
    def diagnostics():
        return {"ready": analyzer.ready, "startup": analyzer.backend.startup}

    @app.post("/v1/analyze")
    async def analyze(audio: UploadFile = File(...), room_code: str = Form(...),
                      session_id: str = Form(...), segment_id: str = Form(...)):
        # Fail fast instead of buffering many concurrent uploads on a 16 GB machine.
        if app.state.accepting:
            await audio.close()
            raise HTTPException(429, "analyzer_busy")
        app.state.accepting = True
        try:
            if not all(ID.fullmatch(s) for s in (room_code, session_id, segment_id)):
                raise HTTPException(422, "invalid_session_identifiers")
            data = await audio.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise HTTPException(413, "audio_too_large")
            sr, wav = decode_segment(data)
            with tempfile.TemporaryDirectory(prefix="knock-voice-") as tmp:
                path = Path(tmp) / "segment.wav"
                path.write_bytes(data)
                return await asyncio.to_thread(analyzer.analyze, path, wav, sr, room_code, session_id, segment_id)
        finally:
            app.state.accepting = False
            await audio.close()
    return app


app = create_app()
