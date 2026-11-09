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
| `sonar` | 사람 부재(영상 재생, AI 아바타), 입 움직임 불일치 | 실제 대리인 + 페이스스왑 → `light`가 보완 |
| `voice` | 합성 음성(TTS/VC) | 최신 TTS 일반화 한계 |

## 보안 원칙

1. **챌린지는 서버가 매 세션 랜덤 발급** — 빛 색 순서, 초음파 패턴, 읽을 문장. 녹화본은 이번 회차 패턴을 알 수 없음.
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
  stream, video, onResult: (r) => console.log(r),
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

## TODO

- [ ] **sonar** 사전 검증: 팀 노트북별 18–21kHz 송수신 + 도플러 가시성 확인 (최우선)
- [ ] sonar: 사이드밴드 도플러 에너지, MediaPipe 입 벌림, 상관 판정
- [ ] light: 얼굴 피부 ROI, 시퀀스-반사광 상관(지연 탐색)
- [ ] voice: AASIST/RawNet2 Python 사이드카
- [ ] meet: WebRTC 통화 연결, 초음파 성분 송출 오디오에서 필터링
- [ ] login-demo
- [ ] 공격 데모 시나리오: OBS 가상캠 → 영상 재생 → 실시간 페이스스왑
