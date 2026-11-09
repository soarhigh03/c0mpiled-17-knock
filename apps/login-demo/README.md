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
