# Knock voice sidecar — Pella v2

수신 음성 자체의 합성 흔적을 점수화하는 서버 전용 Python HTTP 분석기입니다. 목소리 등록·추가 학습·통화 연결·영상/음성 전송·본인 인증을 구현하지 않습니다. **판정은 서버에서만** 수행합니다.

**상태:** 분석기와 평가 도구를 구현했습니다. 이 환경에는 기존 저장소·팀원 음성·Mac이 없어 실제 Pella 추론, 오탐·미탐, 16GB Mac 동시 실행 메모리는 아직 검증하지 못했습니다. [VERIFICATION.md](VERIFICATION.md)를 먼저 확인하세요. `packages/server`, `packages/shared`는 만들거나 수정하지 않았습니다.

## 1. Mac에서 설치 및 실행

Apple Silicon Mac, Python 3.12 권장. `ffmpeg`도 필요합니다. Intel Mac은 MPS 없이 CPU 대상이며 이 bootstrap의 대상에서 제외했습니다.

```bash
cd knock-voice
bash scripts/bootstrap_mac.sh
# weights + code + backbone을 내려받고 manifest/환경 버전을 기록합니다.

.venv/bin/knock-voice analyze human.wav tts.wav vc.wav --device auto
# JSONL: report.model_score.value = p_fake, report.inference_ms = 실제 forward 시간
# 최초 다운로드는 artifacts/manifest.json, 모델 로딩은 stderr의 startup에 별도 기록

.venv/bin/knock-voice serve
# 127.0.0.1:8765, 단일 worker. 이 프로세스를 켜둔 채 반복 호출합니다.
```

`KNOCK_DEVICE=cpu` 또는 `KNOCK_DEVICE=mps`로 지정할 수 있습니다. 기본 `auto`는 MPS가 있으면 먼저 시도합니다. MPS 전송/추론 중 RuntimeError 또는 NotImplementedError가 발생하면 **같은 모델을 CPU로 이동해 한 번 재시도**하고 이후 CPU를 유지합니다. CPU도 실패하면 `Unable`입니다. CUDA·fp16·양자화·학습은 사용하지 않습니다.

`requirements.txt`는 후보 의존성 명세입니다. 이 환경에서는 네트워크 제한으로 전체 설치·모델 호환성을 확인하지 못했습니다. Mac 설치가 성공하면 `artifacts/environment.freeze.txt`와 manifest에 **실제 설치 버전**이 남습니다. Torch와 torchaudio는 공식 설치 표에 있는 동일한 `2.8.0`으로 맞췄습니다.

## 2. 공식 코드와 모델 버전

| 항목 | 고정 버전 / 확인 내용 |
|---|---|
| Pella v2 가중치·공식 Python 코드 | `Sadanie/pellav2-audio-deepfake-detector` @ `b668eb4dfe4719665692c73c1d70383680afff6b` |
| 백본 | `facebook/w2v-bert-2.0` @ `da985ba0987f70aaeb84a80f2851cfac8c697a7b` |
| 래퍼 | `knock-voice 0.1.0` |
| 가중치 라이선스 | 두 저장소 모두 모델 카드 메타데이터에 `mit` 표시, 2026-11-09 확인 |
| 라이선스 근거 보존 | 다운로드한 각 저장소의 `README.md`와 커밋·해시를 manifest에 보존. 확인한 파일 목록에는 별도 LICENSE가 표시되지 않았음 |
| 기본 임계값 | 공식 CLI: `sigmoid(logit) >= 0.5`이면 FAKE |

출처: [모델 카드](https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector), [공식 코드](https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector/blob/main/pellav2_infer.py), [Pella 커밋](https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector/commit/b668eb4dfe4719665692c73c1d70383680afff6b), [백본 카드](https://huggingface.co/facebook/w2v-bert-2.0), [백본 커밋](https://huggingface.co/facebook/w2v-bert-2.0/commit/da985ba0987f70aaeb84a80f2851cfac8c697a7b), [PyTorch 설치 표](https://pytorch.org/get-started/previous-versions/).

공식 코드가 백본을 먼저 로드한 뒤 detector state를 덮어쓰므로 설치 도구도 백본을 함께 받습니다. 현재 파일 목록상 Pella 가중치는 약 2.32GB, 백본 safetensors도 약 2.32GB이며, 다운로드 크기는 실제 manifest의 `artifact_bytes`를 기준으로 확인하세요. 이 수치는 실행 메모리와 다릅니다. 일부 검색 캐시에 과거 가중치 크기가 남아 있어 과거 파일의 해시를 현재 버전에 사용하지 않았습니다.

공식 `Detector`를 상속하고 초기화만 로컬의 고정 백본으로 연결합니다. `forward`, Kaldi fbank, hidden-layer 가중 결합, 풀링, head는 내려받은 공식 구현을 그대로 상속합니다. `.pt`는 `weights_only=True`, `mmap=True`, strict state loading으로 읽습니다. 코드·가중치·백본 파일 해시가 manifest와 다르면 시작을 중단합니다. 정상 실행 중 Hub에 접근하지 않습니다.

## 3. 전처리와 판단 보류

모델 입력은 공식 `load_clip`에 위임합니다: 모노 평균 → torchaudio로 16kHz resample → DC 제거 → 2차 20Hz high-pass(`sosfiltfilt`) → 중앙 64,000 samples → −23 LUFS 정규화(이득 ±40dB, 샘플 clipping) → 짧으면 뒤에 0 padding. fbank는 공식 코드의 80 mel, Povey window, dither 0, 주파수별 표준화 및 두 프레임 결합을 유지합니다.

서비스 정책은 정규화 전 원신호를 검사하며, **4초 미만은 모델에 보내지 않으므로** 짧은 입력에 점수를 만들기 위해 padding하지 않습니다. 다음은 실측 전 임시 기준입니다.

| 보류 조건 | 임시 기준 / 사유 |
|---|---|
| 짧음 | 전체 음성 < 4.0초 → `too_short` |
| 무음·매우 작음 | 중앙 4초의 DC 제거 RMS < −55dBFS |
| 유효 에너지 부족 | 30ms 프레임 중 RMS ≥ −45dBFS인 구간 합 < 2.5초 |
| 심한 clipping | 중앙 구간에서 절댓값 ≥ 0.999인 샘플 비율 ≥ 2% |
| 정상성 광대역 잡음 | 중앙 구간의 median spectral flatness ≥ 0.45 이고 프레임 에너지 p90−p10 < 6dB |
| 기타 | 비유한 입력, 모델 미준비·오류, 분석기 혼잡 |

에너지·flatness는 VAD나 검증된 SNR이 아닙니다. 비정상성 잡음·반주·잔향까지 모두 걸러내지 못합니다. 실제 사람·TTS·VC와 소음 혼합 샘플을 확보한 후 임계값 및 보류율을 조정해야 합니다. `Pass`는 이 품질 검사를 통과한 구간에 뚜렷한 합성 신호가 없다는 뜻이며, 사람/본인/실시간 응답 인증이 아닙니다.

## 4. HTTP 계약과 서버 연결안

`GET /health`: 준비 완료 200, 모델 미준비 503. `GET /v1/diagnostics`: 다운로드/로딩 시간과 버전. `POST /v1/analyze`: 아래 multipart 계약입니다.

| 필드 | 내용 |
|---|---|
| `audio` | 16kHz·모노·PCM16 WAV. 최대 12초, 업로드 최대 1,000,000 bytes |
| `room_code` | 서버에서 확인한 방 코드 |
| `session_id` | 활성 검증 세션 ID |
| `segment_id` | 서버에서 확인한 분석 구간 ID |

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/v1/analyze \
  -F room_code=abc123 -F session_id=session1 -F segment_id=segment1 \
  -F audio=@human-16k-mono.wav
```

출력은 `schema_version`, 동일한 세 ID, `decision`, `label`, `reason`, `report`입니다. `reason`은 정상 판정에서 null, 보류에서 사유 코드입니다. **`report.model_score`에만** `{name: "p_fake", value: …, calibrated_probability: false}`를 기록합니다. 보류 시 점수는 null입니다. 리포트에는 `threshold`, quality 정책·측정값, `preprocess_ms`, `inference_ms`, `first_inference`, `device`, MPS fallback 사유, 프로세스/시스템 메모리도 포함됩니다. 오디오 내용은 로그에 기록하지 않고, HTTP 업로드의 임시 파일은 호출 종료 시 삭제합니다.

| `label` | `decision` | 처리 |
|---|---|---|
| 합성 의심 | `Review` | 다른 확인 절차로 검토. 오탐률 검증 전 단독 거부 금지 |
| 뚜렷한 합성 신호 없음 | `Pass` | 해당 구간의 음성 분석 결과로만 표시 |
| 판단 보류 | `Unable` | 재수집 또는 다른 절차 안내 |

형식/식별자 오류는 422, 용량 초과는 413, 동시 HTTP 요청은 429입니다. 서버 어댑터는 이 오류와 timeout을 `Unable`로 바꿉니다. 리포트는 서버에만 남기고 메인 UI에는 여섯 필드(ID 3개·decision·label·reason)만 전달합니다. 제안 어댑터는 [integration/voice-client.proposed.mjs](integration/voice-client.proposed.mjs)에 있으며 기존 프로젝트에 설치하지 않았습니다.

연결 순서: 면접관 방 생성 → 후보자 코드 입장 → 후보자 SDK가 실제 마이크 구간 수집 → **기존 서버가 인증·방/세션/챌린지 소속·중복/만료를 검증** → 사이드카 호출 → 리포트 저장 → 같은 방 면접관에 공개 결과만 전달. 방에는 미디어 연결을 추가하지 않습니다. SDK에서 보낸 문자열만으로 방/세션 소속을 신뢰하면 안 됩니다. 요청 취소·기한 초과 후의 늦은 결과는 서버가 활성 세션/구간을 다시 확인하고 폐기해야 합니다.

사이드카는 localhost의 신뢰된 서버용이며 자체 방 생성·권한 검증·결과 저장·구독 기능은 없습니다. `--workers 1`로만 실행합니다. 향후 AASIST/RawNet2는 `model_id`, `threshold`, `score_name`, `start()`, `startup`, `infer(path) -> (score, detail)` 어댑터를 구현해 바꿀 수 있습니다. 각 모델의 전처리와 점수 방향을 어댑터에서 맞추고 합성 의심 방향의 [0, 1] 점수로 반환합니다. `threshold`에는 그 모델의 기준을 넣으며 **0.5를 다른 모델에 무조건 적용하지 마세요**. HTTP의 점수·판정·보류 사유 계약은 유지합니다.

## 5. 팀원 샘플 평가

팀원 본인 목소리로 동의하에 만든 human/TTS/VC만 사용합니다. manifest 예시는 경로와 동의 필드 작성 형식이며 실제 동의가 있었다는 기록이 아닙니다. 각 샘플의 실제 동의를 확인한 후 복사·수정하세요. VC는 원 화자와 목표 화자 모두 동의해야 합니다. 공개 타인 음성·무단 복제 샘플은 내려받지 않습니다.

```bash
# evaluation/manifest.example.json을 복사해 실제 파일/메타데이터를 작성
.venv/bin/python scripts/prepare_opus.py evaluation/manifest.json
# 원본 + Opus 16/24kbps 인코딩 후 16k mono PCM16 WAV로 복원된 manifest 생성

# Electron 앱, 서버, OBS를 함께 켠 상태에서만 이 확인 플래그를 사용
.venv/bin/python scripts/evaluate.py evaluation/opus/manifest.json \
  --companion-apps-running --repeats 3 --output evaluation/run-mps
.venv/bin/python scripts/evaluate.py evaluation/opus/manifest.json \
  --companion-apps-running --device cpu --repeats 3 --output evaluation/run-cpu
```

각 실행에서 모델은 한 번 로드합니다. `results.csv`/`results.json`은 입력별 model score·판정·시간·보류와 메모리를 저장합니다. `summary_first_repeat_only`는 **첫 반복만** 오탐(human → Review)·미탐(TTS/VC → Pass)을 세고, 점수가 나온 표본 수를 분모로 기록합니다. Unable 및 전체 coverage를 별도 기록해 보류를 성공으로 계산하지 않습니다. 원본/코덱·direct/speaker_mic별로 나누며 반복·코덱 파생 파일을 독립 표본으로 주장하지 않습니다.

**Opus 변환은 통화 코덱 영향에 대한 대체 시험**입니다. 실제 통화의 패킷 손실·PLC·AEC·AGC·잡음 제거까지 재현하지 않습니다. 이번 구현에서는 요구대로 실제 통화 연결을 만들지 않습니다.

앱의 가상 마이크 차단을 유지한 채 TTS/VC를 **스피커로 재생 → 후보자 기기의 실제 마이크 → 기존 SDK 수집** 경로로 녹음하고 `capture: "speaker_mic"`로 추가하세요. 같은 경로의 human 기준 녹음도 넣습니다. 장치 점검을 통과한 앱 경로의 검증은 Mac과 기존 저장소에서 별도로 수행해야 합니다.

## 6. 발화 길이와 메모리 측정

챌린지는 예를 들어 “오늘 확인할 문장은 파란 우산과 노란 기차입니다. 화면에 나온 숫자는 칠, 둘, 아홉입니다.”처럼 5–7초를 목표로 설계합니다. 문장만으로 길이를 보장하지 말고 **실측 ≥4초 및 유효 에너지 ≥2.5초**가 될 때 제출합니다. 실패하면 새 구간을 요청합니다. 3단어 챌린지는 4초보다 짧을 수 있습니다.

같은 세션·같은 챌린지의 연속된 구간만 원래 시간축으로 이어 붙이고, 구간 순서·누락·중복을 서버에서 검증하세요. 서로 다른 챌린지나 재시도 오디오를 결합하거나 같은 음성을 반복 복제해 길이를 채우지 않습니다. 현재 파일 분석기는 구간 결합을 구현하지 않습니다. 4초 이상 파일은 공식 중앙 crop을 쓰므로, 중앙 창에 발화가 충분히 들어오도록 녹음하세요.

시간은 `download_or_cache_ms`(설치), `integrity_check_ms`, `load_ms`, `startup_wall_ms`, `preprocess_ms`, `inference_ms`, `failed_mps_attempt_ms`, 분석 호출 `total_ms`로 구분합니다. 첫 forward는 `first_inference=true`이며 steady-state latency와 섞지 마세요. HTTP 업로드·UI 전달 시간은 `total_ms`에 포함되지 않습니다.

메모리는 로딩/추론 중 50ms 간격 RSS 표본 최고값, 시스템 available/used 및 swap을 기록합니다. MPS 사용 시 current/driver allocation도 기록하며 RSS와 합산하지 않습니다. 프로세스 이름으로 Electron/Node/OBS 후보를 기록하지만 실제 앱이 켜졌는지는 운영자가 확인해야 합니다. `--companion-apps-running`은 그 확인 기록입니다. 16GB Mac에서 앱·서버·OBS 동시 실행 시 Activity Monitor의 Memory Pressure, swap 증가, 오디오 드롭과 응답 지연도 확인하세요. 아직 이 조건의 측정값은 없습니다.

## 7. 검증 후 통합 조건

1. Mac에서 human/TTS 파일에 실제 점수·추론 시간 출력, 가능하면 VC도 확보.
2. 원본/Opus와 스피커→실제 마이크 경로에서 오탐·미탐·보류 기록.
3. Electron·서버·OBS 동시 실행 메모리·처리 지연 확인.
4. 은우와 HTTP/DTO·리포트 저장·세션 만료 처리에 합의한 뒤 `packages/server` voice 판정에 연결. 그 전에는 해당 패키지를 수정하지 않음.
