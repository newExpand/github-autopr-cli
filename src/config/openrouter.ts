/**
 * OpenRouter 설정 파일 (개발 전용)
 *
 * 이 파일은 .gitignore에 포함되어 있어 Git에 추적되지 않습니다.
 * API 키와 같은 민감한 정보를 포함하고 있습니다.
 *
 * 개발 환경에서만 사용되며, 프로덕션 환경에서는 이 파일의 내용이
 * 자동으로 처리되어 사용자에게 노출되지 않습니다.
 */

// 환경 변수를 통한 디버깅 모드 설정 (DEBUG_OPENROUTER=true)
const DEBUG_MODE = process.env.DEBUG_OPENROUTER === "true";

// 대체 API 엔드포인트 (테스트용)
const FALLBACK_API_URL = "https://api.openrouter.ai/api/v1";

export const OPENROUTER_CONFIG = {
  // 디버깅 모드가 활성화된 경우 기본 URL을 출력
  BASE_URL: "https://openrouter.ai/api/v1",
  API_KEY:
    "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",
  DEFAULT_MODEL: "google/gemini-2.0-flash-exp:free",
  API_KEY_HASH:
    "6322e214e01c6c2e39e5dd5df755b8e22743cf2036235b7d431c1f223620e2d5",
  // 디버깅 관련 설정
  DEBUG: DEBUG_MODE,
  FALLBACK_API_URL: FALLBACK_API_URL,
  // 안정성 개선을 위한 설정
  TIMEOUT_MS: 30000, // 30초 타임아웃
  RETRY_COUNT: 2, // 최대 재시도 횟수
  // HTTP 헤더 설정
  HTTP_HEADERS: {
    "HTTP-Referer": "https://github.com/auto-pr", // OpenRouter 랭킹용 사이트 URL
    "X-Title": "GitHub AutoPR", // OpenRouter 랭킹용 사이트 이름
  },
} as const;
