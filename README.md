# Knock

> AI 시대의 인간 증명 레이어. 첫 번째 적용 사례: 화상면접.
> c0mpiled-17 · "Proving you're human"

Knock은 **클라이언트 SDK + 검증 API**로 구성됩니다. SDK가 사용자 기기에서 챌린지를 실행하고
신호를 수집하면, 서버가 판정하고 서명된 **신뢰 토큰(JWT)** 을 발급합니다.
어떤 앱이든 이 토큰을 받아 "지금 화면 앞에 실제 사람이 있다"를 확인할 수 있습니다.

## 구조

```
packages/
  shared/   공통 스키마 (zod): 챌린지, 증거, 판정, API 계약
  sdk/      클라이언트 SDK: 챌린지 실행 + 신호 수집 (판정은 하지 않음)
  server/   검증 API (Hono): 챌린지 발급, 판정, 토큰 서명
apps/
  meet/        화상면접 데모 (Vite + React)
  login-demo/  두 번째 적용 사례 (예정)
```

## 검증 레이어

| 체크 | 막는 것 | 못 막는 것 |
|---|---|---|
| `environment` | 가상 카메라/오디오, 포커스 이탈, 다중 모니터 | 장치 이름 변경, 두 번째 기기 |
| `light` | 실시간 페이스스왑, 영상 재생 | 밝은 환경에서 신호 약화 |
| `sonar` | **사람 부재** — 영상 재생, AI 아바타 (앞에 물리적으로 움직이는 몸이 없음) | 실물이 앞에 있으면서 영상만 가짜인 경우 → `light`가 보완. 19kHz를 못 내는 기기는 판정 불가 |
| `voice` | 합성 음성(TTS/VC) | 최신 TTS 일반화 한계 |

## 보안 원칙

1. **챌린지는 서버가 매 세션 랜덤 발급** — 빛 색 순서, 초음파 캐리어 주파수, 읽을 문장. 녹화본은 이번 회차 값을 알 수 없음.
2. **판정은 서버에서만** — SDK는 원시 신호만 보냄. 조작된 SDK가 "pass"라고 보고해도 의미 없음.
3. **어느 하나라도 `fail`이면 거부** — 가중 점수와 별개로 veto.
4. **`inconclusive`는 점수에 섞지 않음** — "못 쟀다"를 "절반쯤 가짜"로 취급하면 미구현·미지원
   체크가 멀쩡한 세션을 끌어내립니다. 대신 판정에 도달한 체크의 가중치가 요청한 것의 절반
   이상이어야 통과 — 어려운 체크가 전부 inconclusive일 때 약한 체크 하나로 통과하는 걸 막습니다.

## API

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/v1/sessions` | `{ checks }` → 세션 + 챌린지 발급 |
| `POST` | `/v1/sessions/:id/evidence` | `{ evidence }` → 해당 체크 판정 |
| `POST` | `/v1/sessions/:id/verify` | 최종 판정 + 신뢰 토큰 |
| `POST` | `/v1/tokens/introspect` | 연동 앱 백엔드용 토큰 검증 |

## SDK 사용 예

```ts
import { createKnock } from '@knock/sdk'

const knock = createKnock({ apiUrl: 'http://localhost:8787' })
knock.watchEnvironment()

const { verdict, token } = await knock.verify(['environment', 'light', 'sonar'], {
  stream,
  video,
  onResult: (r) => console.log(r),
  // 사용자에게 보여줄 지시 (voice 등). sonar는 아무것도 요구하지 않습니다.
  onPrompt: (prompt) => setPrompt(prompt),
  // 마이크 거부처럼 한 체크가 실패해도 나머지는 계속 진행됩니다.
  onCheckError: (kind, err) => console.warn(kind, err),
  signal: controller.signal,
})
// token을 자기 백엔드로 보내 /v1/tokens/introspect로 검증
```

## 시작하기

```bash
cp .env.example .env
npm install
npm run dev          # server(:8787) + meet(:5173)
npm run typecheck
```

## sonar (SonarGuard)

> **무엇을 주장하는가**: "이 기기 앞에 물리적으로 움직이는 몸이 있다."
> 립싱크 일치는 **주장하지 않습니다** — 실측 결과 CW 단일 톤으로는 불가능합니다.
> 립 일치가 잡히면 점수를 0.75 → 1.0으로 올리지만, 없다고 떨어뜨리지는 않습니다.

서버가 세션마다 18–20kHz 캐리어를 뽑아 주고, SDK가 그 톤을 연속 송출하면서 마이크 입력을
AudioWorklet에서 I/Q 복조 → 1kHz 데시메이션 → 6–45Hz 대역통과 → 움직임 에너지로 바꿉니다.
영상에서는 MediaPipe Face Landmarker로 입 벌림(13–14 / 10–152)과 머리 위치를 재고,
`AudioContext.getOutputTimestamp`로 두 시계열을 같은 타임베이스에 올립니다.

- **에코가 정적이면 `fail`** — 화면 속 얼굴은 움직이는데 방은 조용하다는 뜻. 영상 재생·AI 아바타
- 에코가 움직이면 `pass` (0.75). 거기에 립 일치까지 확인되면 1.0
- 캐리어 SNR이 낮으면 `inconclusive` — 그 기기가 19kHz를 못 내는 것이지 위조 증거가 아님
- 사용자에게 **아무것도 요구하지 않습니다**. 면접 중 오가는 자연스러운 말을 그대로 관찰합니다

노트북별 송수신 확인은 meet 앱의 **Sonar Lab**에서 합니다 (주파수 스윕, 실시간 그래프,
캐리어 도달·톤 순도).

📄 **설계 근거·실측·틀렸던 가정·남은 일 → [docs/sonar.md](docs/sonar.md)**

## TODO

- [x] sonar: 사람 존재 판정 (도플러 움직임 에너지 + MediaPipe, 립 일치는 보너스)
- [ ] **sonar** 임계값 확정: 실제 재생 영상의 `echo variation` 측정 — 지금은 잠정값 (최우선)
      → [docs/sonar.md](docs/sonar.md#7-남은-일)
- [ ] light: 얼굴 피부 ROI, 시퀀스-반사광 상관(지연 탐색)
- [ ] voice: AASIST/RawNet2 Python 사이드카
- [ ] meet: WebRTC 통화 연결, 초음파 성분 송출 오디오에서 필터링
- [ ] login-demo
- [ ] 공격 데모 시나리오: OBS 가상캠 → 영상 재생 → 실시간 페이스스왑
