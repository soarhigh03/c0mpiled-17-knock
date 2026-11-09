# @knock/login-demo (예정)

같은 `@knock/sdk`를 화상면접이 아닌 다른 앱(로그인/본인확인 페이지)에 붙여
"어떤 앱에도 붙는 신뢰 레이어"임을 보여주는 두 번째 적용 사례.

- 프론트: SDK `verify()` → 신뢰 토큰 획득
- 백엔드: `POST /v1/tokens/introspect`로 토큰 검증 후 로그인 허용
