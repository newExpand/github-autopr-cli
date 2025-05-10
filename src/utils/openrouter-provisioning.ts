/**
 * OpenRouter API 키 프로비저닝 유틸리티 (개발 전용)
 *
 * 이 파일은 .gitignore에 포함되어 있어 Git에 추적되지 않습니다.
 * API 키와 같은 민감한 정보를 포함하고 있습니다.
 *
 * 개발 환경에서만 사용되며, 프로덕션 환경에서는 이 파일의 내용이
 * 자동으로 처리되어 사용자에게 노출되지 않습니다.
 */
import { OPENROUTER_CONFIG } from "../config/openrouter.js";
import { log } from "./logger.js";

// 프로비저닝 API 키 (이 파일은 .gitignore에 추가되어 있음)
const PROVISIONING_API_KEY =
  "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";
const BASE_URL = "https://openrouter.ai/api/v1/keys";

// 마지막 API 키 상태 확인 시간 및 결과 캐싱
let lastKeyCheckTime = 0;
let lastKeyStatus: boolean | null = null;
const KEY_CHECK_CACHE_DURATION = 5 * 60 * 1000; // 5분 캐시 유효 시간

/**
 * OpenRouter API 키 정보를 가져옵니다.
 * @param keyHash API 키 해시 (지정하지 않으면 기본 API 키의 해시 사용)
 * @returns API 키 정보
 */
export async function getKey(keyHash?: string): Promise<any> {
  try {
    // 키 해시가 제공되지 않은 경우 기본 API 키 해시 사용
    const hash = keyHash || OPENROUTER_CONFIG.API_KEY_HASH;

    log.debug(`API 키 정보 조회 시도 중...`);
    const response = await fetch(`${BASE_URL}/${hash}`, {
      headers: {
        Authorization: `Bearer ${PROVISIONING_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `API 요청 실패: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    log.error("OpenRouter API 키 정보 조회 실패:", error);
    throw error;
  }
}

/**
 * 모든 OpenRouter API 키 목록을 가져옵니다.
 * @param offset 페이지네이션 오프셋 (기본값: 0)
 * @returns API 키 목록
 */
export async function listKeys(offset = 0) {
  try {
    const url = offset > 0 ? `${BASE_URL}?offset=${offset}` : BASE_URL;
    log.debug(`API 키 목록 조회 시도 중...`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${PROVISIONING_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `API 요청 실패: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    log.error("OpenRouter API 키 목록 조회 실패:", error);
    throw error;
  }
}

/**
 * OpenRouter API 키를 활성화/비활성화합니다.
 * @param keyHash API 키 해시
 * @param disabled 비활성화 여부
 * @returns 업데이트된 API 키 정보
 */
export async function updateKeyStatus(keyHash: string, disabled: boolean) {
  try {
    log.debug(
      `API 키 상태 업데이트 시도 중... (${disabled ? "비활성화" : "활성화"})`,
    );
    const response = await fetch(`${BASE_URL}/${keyHash}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${PROVISIONING_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        disabled,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `API 요청 실패: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    log.error("OpenRouter API 키 상태 업데이트 실패:", error);
    throw error;
  }
}

/**
 * API 키 상태를 확인하고 필요한 경우 활성화합니다.
 * @returns 활성화 여부 (true: 활성화됨, false: 이미 활성화 상태)
 */
export async function ensureKeyActive(): Promise<boolean> {
  try {
    const now = Date.now();

    // 캐시된 결과가 있고 유효 시간 내라면 캐시된 결과 반환
    if (
      lastKeyStatus !== null &&
      now - lastKeyCheckTime < KEY_CHECK_CACHE_DURATION
    ) {
      return lastKeyStatus;
    }

    // 기본 API 키 상태 확인
    const keyInfo = await getKey(OPENROUTER_CONFIG.API_KEY_HASH);

    interface KeyResponse {
      data: {
        disabled: boolean;
        [key: string]: any;
      };
    }

    const typedKeyInfo = keyInfo as KeyResponse;

    // 키가 비활성화된 경우 활성화
    if (typedKeyInfo.data.disabled) {
      // 로그 출력 없이 조용히 활성화
      await updateKeyStatus(OPENROUTER_CONFIG.API_KEY_HASH, false);

      // 결과 캐싱
      lastKeyCheckTime = now;
      lastKeyStatus = true;
      return true;
    }

    // 결과 캐싱
    lastKeyCheckTime = now;
    lastKeyStatus = false;
    return false;
  } catch (error) {
    // 에러 발생 시 조용히 실패 처리
    return false;
  }
}
