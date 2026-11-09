# @knock/login-demo (예정)

같은 `@knock/sdk`를 화상면접이 아닌 다른 앱(로그인/본인확인 페이지)에 붙여
"어떤 앱에도 붙는 신뢰 레이어"임을 보여주는 두 번째 적용 사례.

- 프론트: SDK `verify()` → 신뢰 토큰 획득
- 백엔드: `POST /v1/tokens/introspect`로 토큰 검증 후 로그인 허용

## Electron 데스크탑 셸

`npm run dev:desktop` (루트) → server(:8787) + login-demo(:5174), login-demo가 Electron 창으로 뜹니다.

- preload가 `window.knockNative.listVideoDevices()` 하나만 노출 (메인 프로세스에서 `system_profiler SPCameraDataType -json` 결과 반환)
- 지금 화면은 카메라 목록 + 원본 정보를 그대로 보여주는 임시 페이지 (판정 로직 없음)
- Electron 바이너리가 없으면: `node node_modules/electron/install.js` (루트)
