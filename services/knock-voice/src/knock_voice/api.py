"""Authenticated loopback only; bounded raw bodies, no multipart or disk audio."""
import asyncio
from contextlib import asynccontextmanager
import hmac
import io
import os
import wave
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import numpy as np
from .analyzer import Analyzer, unable
from .backend import PellaBackend

MAX_BYTES = 136000
MAX_SAMPLES = 65600  # 4.1 seconds; never arbitrary-length uploads


def decode_segment(data):
    try:
        if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError("WAV required")
        with wave.open(io.BytesIO(data), "rb") as reader:
            if (reader.getframerate(), reader.getnchannels(), reader.getsampwidth(), reader.getcomptype()) != (16000, 1, 2, "NONE"):
                raise ValueError("require_16000hz_mono_pcm16_wav")
            frames = reader.getnframes()
            if frames > MAX_SAMPLES:
                raise ValueError("window_too_long")
            raw = reader.readframes(frames)
            if len(raw) != frames * 2:
                raise ValueError("truncated_wav")
        return 16000, np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    except Exception as exc:
        raise HTTPException(422, "invalid_or_unsupported_wav") from exc


def create_app(analyzer=None, token=None):
    analyzer = analyzer or Analyzer(PellaBackend(os.getenv("KNOCK_ARTIFACTS", "artifacts"), os.getenv("KNOCK_DEVICE", "auto")))
    token = os.getenv("KNOCK_VOICE_TOKEN", "") if token is None else token

    @asynccontextmanager
    async def lifespan(app):
        async def initialize():
            try:
                await asyncio.to_thread(analyzer.start)
            except Exception:
                pass  # Detailed error remains local; no diagnostics in logs/telemetry.
        task = asyncio.create_task(initialize())
        yield
        # Native process termination owns cancellation of a long model startup.
        if not task.done():
            task.cancel()

    app = FastAPI(title="Knock local voice", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.analyzer = analyzer
    app.state.accepting = False

    @app.middleware("http")
    async def local_only(request, call_next):
        if request.client and request.client.host not in ("127.0.0.1", "::1", "testclient"):
            return JSONResponse(unable("loopback_only"), status_code=403)
        if request.headers.get("origin"):
            return JSONResponse(unable("browser_http_forbidden"), status_code=403)
        if token and not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse(unable("unauthorized"), status_code=401)
        return await call_next(request)

    @app.get("/health")
    def health():
        return JSONResponse({"status": analyzer.status, "ready": analyzer.ready}, status_code=200 if analyzer.ready else 503)

    @app.post("/analyze-window")
    async def analyze(request: Request):
        if app.state.accepting:
            return JSONResponse(unable("analyzer_busy"), status_code=429)
        app.state.accepting = True
        data = bytearray()
        try:
            length = request.headers.get("content-length")
            if length and (not length.isdecimal() or int(length) > MAX_BYTES):
                return JSONResponse(unable("audio_too_large"), status_code=413)
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    return JSONResponse(unable("audio_too_large"), status_code=413)
                data.extend(chunk)
            try:
                sr, wav = decode_segment(data)
            except HTTPException:
                return JSONResponse(unable("invalid_or_unsupported_wav"), status_code=422)
            return await asyncio.to_thread(analyzer.analyze, wav, sr)
        finally:
            data.clear()
            app.state.accepting = False
    return app


app = create_app()
