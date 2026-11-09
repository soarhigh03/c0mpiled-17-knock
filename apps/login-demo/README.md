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
- `?role=candidate` — 자리표시자 (예정)
- 참가자마다 `KnockClient` 하나 (`src/knock/types.ts`). 지금은 `src/knock/mockClient.ts`, 나중에 `@knock/sdk` 기반 구현으로 교체 — UI는 인터페이스만 사용
- 판정: fail 하나라도 있으면 Not verified, 그다음 unable, 전부 pass면 Verified (30초 후 자동으로 "result expired")
- 통화 전송 계층이 없어서 You와 Amara(후보자) 타일 모두 로컬 카메라를 씀 (`TODO(webrtc)`)
- 개발 모드 전용: `⌘⇧D` 시나리오 스위처 (프로덕션 빌드에는 포함되지 않음)
