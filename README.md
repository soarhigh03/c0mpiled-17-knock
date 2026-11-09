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
| `sonar` | 사람 부재(영상 재생, AI 아바타), 입 움직임 불일치 | 실제 대리인 + 페이스스왑 → `light`가 보완. 19kHz를 못 내는 기기는 판정 불가 |
| `voice` | 합성 음성(TTS/VC) | 최신 TTS 일반화 한계 |

## 보안 원칙

1. **챌린지는 서버가 매 세션 랜덤 발급** — 빛 색 순서, 초음파 캐리어 주파수, 읽을 문장. 녹화본은 이번 회차 값을 알 수 없음.
2. **판정은 서버에서만** — SDK는 원시 신호만 보냄. 조작된 SDK가 "pass"라고 보고해도 의미 없음.
3. **어느 하나라도 `fail`이면 거부** — 가중 점수와 별개로 veto.

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
  // 사용자가 해야 할 동작 ("1부터 10까지 소리 내어 세어주세요"). 표시는 앱 책임.
  onPrompt: (prompt) => setPrompt(prompt),
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

서버가 세션마다 18–20kHz 캐리어를 뽑아 주고, SDK가 그 톤을 연속 송출하면서 마이크 입력을
AudioWorklet에서 I/Q 복조 → 1kHz 데시메이션 → DC(직접 경로 + 정적 반사) 제거 → 움직임 에너지로
바꿉니다. 영상에서는 MediaPipe Face Landmarker로 입 벌림(13–14 / 10–152)을 재고,
`AudioContext.getOutputTimestamp`로 오디오 시계를 `performance.now`에 맞춰 두 시계열을 같은
타임베이스에 올립니다. 서버는 도플러 에너지와 `|d(입 벌림)/dt|`를 20Hz로 리샘플해 z-score 후
±300ms 지연을 탐색하며 상호상관합니다.

- 캐리어 SNR이 낮으면 `inconclusive` — 그 노트북이 19kHz를 못 내거나 못 듣는 것이지 위조 증거가 아님
- 에코가 정적이거나 상관이 낮으면 `fail` — 영상 재생·AI 아바타는 물리적 움직임이 없음
- 온/오프 키잉은 쓰지 않음: DC 제거와 충돌하고, 게이팅 트랜지언트가 입 도플러보다 큼.
  재생 방지는 세션마다 바뀌는 캐리어 주파수가 담당

노트북별 송수신 확인은 meet 앱의 **Sonar Lab**에서 합니다 (도플러 에너지·입 벌림 실시간 그래프,
캐리어 SNR, 디버그용 상관 수치).

## TODO

- [ ] **sonar** 사전 검증: 팀 노트북별로 Sonar Lab 돌려서 캐리어 SNR·도플러 가시성 기록 (최우선)
- [x] sonar: 도플러 움직임 에너지, MediaPipe 입 벌림, 지연 탐색 상관 판정
- [ ] light: 얼굴 피부 ROI, 시퀀스-반사광 상관(지연 탐색)
- [ ] voice: AASIST/RawNet2 Python 사이드카
- [ ] meet: WebRTC 통화 연결, 초음파 성분 송출 오디오에서 필터링
- [ ] login-demo
- [ ] 공격 데모 시나리오: OBS 가상캠 → 영상 재생 → 실시간 페이스스왑
