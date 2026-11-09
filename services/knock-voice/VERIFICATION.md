# 실제 확인 결과 — 2026-11-09

| 항목 | 결과 |
|---|---|
| 작업 공간 | 기존 Git 저장소·README·오디오 파일 없음. 별도 사이드카 패키지 생성 |
| 호스트 | Linux x86_64, Python 3.12.14. 사용자 Mac에 접근하지 못함 |
| 공식 코드 검토 | 웹으로 `pellav2_infer.py` 전체 및 모델 카드·커밋·파일 목록 확인 |
| 최초 설치 시도 | 별도 `.venv` 생성, pip install 시 numpy 후보를 받지 못해 실패 |
| 모델 다운로드 시도 | Python urllib의 Hugging Face API/raw 파일 요청 모두 HTTP 403 |
| 실제 모델 추론 | **미실행**. Torch/torchaudio/transformers/가중치가 없고 설치 네트워크 차단 |
| 기능 검증 환경 | 별도 `.venv-check`에 기존 런타임 패키지를 노출. 새 의존성 설치/전체 모델 환경 검증으로 간주하지 않음 |
| 자동 검증 | Python unittest 14개 + Node 테스트 3개 통과. 모델 대역·수학 신호 기반 계약/품질/장애 처리 및 집계 검사 |
| 사람/TTS/VC 오탐·미탐 | **미측정**, 동의된 팀원 샘플 없음 |
| MPS 실행·메모리 | **미측정**, Mac/MPS 없음. CPU fallback 제어 흐름만 대역으로 검사 |
| Electron·서버·OBS 동시 실행 | **미측정** |
| 실제 localhost HTTP | 별도 uvicorn 프로세스와 HTTP 클라이언트: health 503, 무음 Unable, 미준비 모델 Unable 확인 |
| Opus 인코딩/복원 | ffmpeg 7.1.5로 수학 신호를 16/24kbps 변환 후 16kHz·mono·PCM16·64,000 samples 복원 확인. 음성 탐지 시험 아님 |
| 기존 서버/공유 패키지 변경 | 없음. 제안 어댑터만 별도 파일로 제공 |

검사 내용: 임계값 0.5 경계·비유한 점수 보류, 중앙 구간의 품질 판정, 무음/짧음/잡음/clipping 보류, HTTP의 WAV 형식·용량·방/세션 ID 보존, 메인 UI 점수 차단용 allowlist, 모델 미준비·실패·혼잡의 보류, 단일 모델 재사용, MPS 실패 후 같은 모델 CPU 이동 및 유지.

모델 대역이 돌려준 `.8`/`.9`는 **테스트 상수**이며 Pella의 측정값이 아닙니다. tone/noise fixture도 사람·TTS·VC 샘플이 아닙니다. 실제 파일 테스트가 통과했다고 보고하지 않습니다.

재실행:

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
node --test tests/test_voice_client.mjs
```

검증에 사용한 라이브러리: numpy 2.3.5, scipy 1.17.0, FastAPI 0.141.1, httpx 0.28.1, uvicorn 0.52.1, python-multipart 0.0.32, psutil 7.2.2. 이는 Mac의 후보 의존성 환경과 별개입니다.

남은 입력: 기존 저장소 URL/압축 파일, 실제 동의를 받은 팀원 human/TTS/가능하면 VC 음성, 16GB Mac의 실행 결과. 현재 README와 공유 DTO를 읽지 못했으므로 기존 코드와의 정확한 형식 일치는 아직 확인되지 않았습니다. 현재 요청의 프로젝트 맥락을 기준으로 계약을 작성했습니다.

실행 로그는 `checks/python-tests.txt`, `checks/node-tests.txt`, 실제 HTTP/코덱 점검은 `checks/live-http-and-codec.json`에 기록했습니다.
