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
| `light` | **화면 속 얼굴이 가짜** — 영상 재생, 정지 사진, 실시간 페이스스왑 (주변은 조명판에 반응하는데 얼굴만 반응 없음) | 조명을 충실히 재현하는 모델. 주변광이 조명판을 압도하면 판정 불가 |
| `sonar` | **사람 부재** — 영상 재생, AI 아바타 (앞에 물리적으로 움직이는 몸이 없음) | 실물이 앞에 있으면서 영상만 가짜인 경우 → `light`가 보완. 19kHz를 못 내는 기기는 판정 불가 |
| `voice` | 합성 음성(TTS/VC) | 최신 TTS 일반화 한계 |

## 보안 원칙

1. **챌린지는 서버가 매 세션 랜덤 발급** — 빛 펄스의 색과 시각, 초음파 캐리어 주파수, 읽을 문장. 녹화본은 이번 회차 값을 알 수 없음.
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
  // 사용자에게 보여줄 지시. light는 "얼굴을 화면에 보이게", voice는 읽을 문장.
  // sonar는 아무것도 요구하지 않습니다.
  onPrompt: (prompt) => setPrompt(prompt),
  // light의 테두리 조명판을 걸 곳. 기본값은 창 전체 (데스크톱 셸에서는 앱 프레임).
  panelHost: callFrameRef.current ?? undefined,
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

## light

> **무엇을 주장하는가**: "화면에 보이는 얼굴은 지금 이 화면이 비추고 있는 물리적 표면이다."
> 신원은 **주장하지 않습니다** — 실제 표면인지까지만 말합니다.

화상회의 창 **가장자리를 따라 조명판**(상·하·좌·우 4개 스트립)을 달고, 서버가 세션마다 뽑은
색·시각으로 간헐적으로 빛을 쏩니다. 통화 화면은 가리지 않습니다 — 전체 화면 플래시는 면접
중에 쓸 수 없고, 테두리는 그 타협입니다. 펄스 사이에는 **검정으로 켜두어** 기준선을 고정합니다.

SDK는 MediaPipe 랜드마크로 같은 프레임에서 두 영역을 잽니다: **얼굴 피부**(이마 + 양 볼)와
**얼굴 바로 바깥 띠**(벽·머리카락·어깨). 서버는 둘 다 **색도**(채널/합)로 바꿔 펄스 스케줄과
상관시킵니다 — 비율은 램프·노출 이득·콘텐츠 밝기 변화에 불변이라, "이 화면이 비췄는가"와
"그냥 밝아졌는가"가 갈립니다.

- 얼굴과 주변이 **함께** 따라가면 `pass` 1.0
- 얼굴만 따라가면 `pass` 0.85 (뒤쪽 벽이 멀어 반응이 없는 흔한 경우)
- **주변은 따라가는데 얼굴만 반응 없으면 `fail`** — 얼굴이 렌더되고 있다는 뜻. `sonar`가
  구조적으로 못 보는 실시간 페이스스왑이 여기서 걸립니다
- 밝기는 변하는데 조명판의 **색**이 아니면 `fail` — 자체 점멸이 있는 재생 영상
- 과노출·주변광 압도·느린 랜드마커는 `inconclusive` — 기기 한계는 위조 증거가 아님
- 점멸은 약 1Hz, 화면 면적의 약 1/4 — WCAG 2.3.1의 3Hz 기준 아래

노트북·방별 반사량 확인은 meet 앱의 **Light Lab**에서 합니다 (펄스별 깊이, 노출 보정 감쇠,
포화 비율, 영상 클록).

📄 **설계 근거·틀렸던 가정·남은 일 → [docs/light.md](docs/light.md)**

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
- [x] light: 테두리 조명판 + 얼굴/주변 ROI, 색도 상관(지연 탐색) + 펄스별 응답
- [ ] **임계값 확정 (최우선)** — sonar의 `echo variation`, light의 `MIN_DEPTH`. 둘 다
      시뮬레이션 기반 잠정값입니다 → [docs/sonar.md](docs/sonar.md#7-남은-일),
      [docs/light.md](docs/light.md#6-임계값--전부-잠정값)
- [ ] light: 목 영역을 세 번째 ROI로 (피부라 깊이가 비교 가능, 얼굴 전용 모델은 안 건드림)
- [ ] light: 스트립을 따로 켜서 얼굴 좌/우 음영 기울기 비교 (모델이 재현하기 더 어려움)
- [ ] voice: AASIST/RawNet2 Python 사이드카
- [ ] meet: WebRTC 통화 연결, 초음파 성분 송출 오디오에서 필터링
- [ ] login-demo: mock 경로의 전체 화면 오버레이를 테두리 링으로 통일
- [ ] 공격 데모 시나리오: OBS 가상캠 → 영상 재생 → 실시간 페이스스왑
