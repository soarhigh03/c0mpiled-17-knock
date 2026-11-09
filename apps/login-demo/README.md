# @knock/login-demo (예정)

같은 `@knock/sdk`를 화상면접이 아닌 다른 앱(로그인/본인확인 페이지)에 붙여
"어떤 앱에도 붙는 신뢰 레이어"임을 보여주는 두 번째 적용 사례.

- 프론트: SDK `verify()` → 신뢰 토큰 획득
- 백엔드: `POST /v1/tokens/introspect`로 토큰 검증 후 로그인 허용

## Electron 데스크탑 셸

`npm run dev:desktop` (루트) → server(:8787) + login-demo(:5174), login-demo가 Electron 창으로 뜹니다.

- preload가 `window.knockNative.listVideoDevices()` 하나만 노출 (메인 프로세스에서 `system_profiler SPCameraDataType -json` 결과 반환)
- 카메라 원본 정보 디버그 페이지: `?debug=devices`
- Electron 바이너리가 없으면: `node node_modules/electron/install.js` (루트)

## 면접관 통화 화면 (mock)

- `?role=interviewer` (기본) — 2x2 비디오 그리드 + 컨트롤 바의 **Knock** 버튼으로 여닫는 380px 패널
- `?role=candidate` — 후보자 입장 전 장치 점검 화면 (Electron: `KNOCK_ROLE=candidate` 또는 Demo ▸ Candidate View)
- 참가자마다 `KnockClient` 하나 (`src/knock/types.ts`). 지금은 `src/knock/mockClient.ts`, 나중에 `@knock/sdk` 기반 구현으로 교체 — UI는 인터페이스만 사용
- 판정: fail 하나라도 있으면 Not verified, 그다음 unable, 전부 pass면 Verified (30초 후 자동으로 "result expired")
- 통화 전송 계층이 없어서 You와 Amara(후보자) 타일 모두 로컬 카메라를 씀 (`TODO(webrtc)`)
- 개발 모드 전용: `⌘⇧D` 시나리오 스위처 (프로덕션 빌드에는 포함되지 않음)

## 환경 점검 (macOS)

- 장치 정보: `native/knock-devices.swift` (AVCaptureDevice의 `transportType`/`deviceType`). `npm run dev`가 자동으로 빌드하고, 빌드할 수 없으면 `system_profiler`로 대체 (이 경우 이름으로 차단되지 않은 장치는 모두 review)
  - `system_profiler SPCameraDataType`에는 transport가 없어 OBS Virtual Camera를 이름으로만 구분할 수 있음. AVFoundation은 `transportType: "virt"`, `manufacturer: "OBS Project"`를 보고함
- 분류: `src/environment/classify.ts` — built-in/USB만 allowed, `virt` 또는 알려진 가상 장치 이름은 blocked, 나머지는 review. 실제 출력 기반 샘플: `src/environment/samples.ts`, 테스트: `npm test`
- 의심 프로세스: `ps -axo comm=` 3초 폴링 (OBS 카메라 확장 프로세스는 앱 종료 후에도 남아 있으므로 앱 자체만 매칭)
- 화면 캡처 보호: dev에서는 기본 꺼짐. `KNOCK_CONTENT_PROTECTION=1` 또는 Demo ▸ Block Screen Capture로 켬. 후보자 화면은 기본 켜짐이며 `KNOCK_CONTENT_PROTECTION=0`이면 녹화 가능
  - macOS에서는 ScreenCaptureKit 기반 녹화 앱이 보호된 창도 캡처할 수 있음 (Electron 문서). UI는 "capture blocked"라고 주장하지 않음

## 방 코드 + 실제 SDK 연결

- 방은 데모 데이터 (`src/rooms.ts`): `QX7-M4K` (Acme Design 면접), `R9T-2HF` (Orbit Finance 송금 승인 통화). 서버 API 없음
- 면접관: 방 목록 → Start room. 후보자: Demo ▸ Open Candidate Window (⌘⇧N) → 코드 입력 → 장치 점검 → Join (전체 화면)
- 두 창은 `BroadcastChannel('knock-room-<code>')`로 결과를 주고받음. 면접관은 받은 토큰을 `POST /v1/tokens/introspect`로 확인한 뒤에만 Verified 표시
- 후보자 창은 `SdkKnockClient`(`@knock/sdk`)를 씀. mock은 ⌘⇧D → "Use mock data"로만 켜지고 프로덕션 빌드에는 포함되지 않음
- 서버 CORS: `.env`의 `KNOCK_ALLOWED_ORIGINS`에 `http://localhost:5174` 필요 (`.env.example` 참고)

### SDK/서버에 아직 없는 것 (packages/* — 이 앱에서는 수정하지 않음)

지금은 environment만 실제로 실행하고, 나머지는 "Not run"으로 표시 (가짜 pass 없음).

1. **SDK가 챌린지를 외부에 노출하지 않음** — `verify()`가 세션 생성·챌린지 실행을 내부에서 모두 처리. 서버가 발급한 색 순서·문구를 앱이 받아 자체 화면(C)에 그릴 방법이 없음. 필요: `startSession(checks)` → challenges 반환 + `submitEvidence(kind, evidence)` 같은 저수준 API, 또는 `KnockApi` export
2. **light**: SDK `runLight`가 자체 오버레이를 그림. 필요: 외부 렌더러 훅 (예: `onStep(index, color, performance.now())` 타임스탬프를 받아 같은 시계로 비디오 프레임을 샘플링). 서버 `verifiers/light.ts`는 "not implemented yet"
3. **voice**: SDK `runVoice`가 빈 오디오를 보냄. 필요: 녹음 Blob(+ startedAt/endedAt/sampleRate)을 받아 16 kHz mono WAV base64로 변환하는 입력. 서버 `verifiers/voice.ts` 미구현. 서버 문구(7–9 단어)는 ~4초 음성에 비해 짧음 (앱은 10–14 단어 사용)
4. **sonar**: SDK가 Doppler 에너지·입 벌림을 0으로 보냄. 자체 마이크를 따로 열어 통화 마이크/녹음과 충돌 가능. 서버 `verifiers/sonar.ts` 미구현
5. **environment**: 서버가 *목록에 있는* 가상 장치를 모두 실패 처리 (선택된 장치가 아니라). OBS 카메라 확장이 설치된 Mac은 OBS를 꺼도 항상 fail. 필요: EnvironmentEvidence에 선택된 장치 id/label + 네이티브 분류(transport) 필드
6. **집계**: `inconclusive`가 점수 0.5로 집계에 들어가 부분 구현 상태에서는 `human=true`가 될 수 없음 (그래서 미구현 체크는 아예 보내지 않음)
7. **shared 스키마**: `CheckStatus`에 `review`/`not_run` 없음. introspect 응답의 claims에 `exp`가 빠짐 (zod가 제거)
