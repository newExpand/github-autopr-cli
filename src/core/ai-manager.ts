import { createFetch } from "next-type-fetch";
import { log } from "../utils/logger.js";
import { t } from "../i18n/index.js";

// 기본 fetch 인스턴스 생성
const fetch = createFetch({
  headers: {
    "Content-Type": "application/json",
    "x-ai-api-key": "EnnVP5DatEta2Tv6D0nklXEB",
    "x-title": "github-autopr",
  },
});

// 서버 응답 타입 정의
interface APIResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: string;
}

/**
 * AI API 클라이언트
 * 외부 API 서버를 호출하여 AI 기능을 제공합니다.
 */
export class AIClient {
  private baseUrl: string;

  // constructor(baseUrl: string = "https://api.newextend.com/api") {
  //   this.baseUrl = baseUrl;
  // }
  constructor(baseUrl: string = "http://localhost:4000/api") {
    this.baseUrl = baseUrl;
  }

  /**
   * API 엔드포인트를 호출합니다.
   * @param endpoint API 엔드포인트 경로
   * @param data 요청 데이터
   * @returns API 응답 데이터
   */
  public async callAPI<T>(endpoint: string, data: any): Promise<T> {
    try {
      const response = await fetch.post<APIResponse<T>>(
        `${this.baseUrl}${endpoint}`,
        data,
      );

      // 서버 응답 구조 처리
      // 서버는 { success, statusCode, message, data: { 실제 데이터 }, error } 형식으로 응답
      if (response.data && response.data.data) {
        return response.data.data;
      }

      return response.data as unknown as T;
    } catch (error) {
      process.stdout.write(JSON.stringify(error, null, 2));
      log.error(
        t("core.ai_manager.error.api_call_failed", { endpoint }),
        error,
      );
      throw new Error(
        t("core.ai_manager.error.api_call_error", {
          message:
            error instanceof Error
              ? error.message
              : t("core.ai_manager.error.unknown_error"),
        }),
      );
    }
  }

  /**
   * GitHub App 기본 정보를 가져옵니다.
   * @returns GitHub App 정보 (appId, clientId)
   */
  public async getGitHubAppInfo(): Promise<{
    appId: string;
    clientId: string;
  }> {
    try {
      const response = await fetch.get<
        APIResponse<{ appId: string; clientId: string }>
      >(`${this.baseUrl}/github/app-info`);

      // 서버 응답 구조 처리
      if (response.data && response.data.data) {
        return response.data.data;
      }

      throw new Error(t("core.ai_manager.error.github_app_info_missing"));
    } catch (error) {
      log.error(t("core.ai_manager.error.github_app_info_failed"), error);
      throw new Error(
        t("core.ai_manager.error.github_app_info_error", {
          message:
            error instanceof Error
              ? error.message
              : t("core.ai_manager.error.unknown_error"),
        }),
      );
    }
  }

  /**
   * GitHub App 설치 토큰을 획득합니다.
   * @param installationId GitHub App 설치 ID
   * @returns 설치 토큰
   */
  public async getGitHubAppToken(installationId: number): Promise<string> {
    try {
      const response = await fetch.get<APIResponse<{ token: string }>>(
        `${this.baseUrl}/github/app-token/${installationId}`,
      );

      // 서버 응답 구조 처리
      if (response.data && response.data.data && response.data.data.token) {
        return response.data.data.token;
      }

      throw new Error(t("core.ai_manager.error.token_missing"));
    } catch (error) {
      log.error(t("core.ai_manager.error.app_token_failed"), error);
      throw new Error(
        t("core.ai_manager.error.app_token_error", {
          message:
            error instanceof Error
              ? error.message
              : t("core.ai_manager.error.unknown_error"),
        }),
      );
    }
  }

  /**
   * GitHub App 설치 목록을 조회합니다.
   * @returns 설치 목록
   */
  public async getGitHubAppInstallations<T>(): Promise<T> {
    try {
      const response = await fetch.get<APIResponse<T>>(
        `${this.baseUrl}/github/app-installations`,
      );

      // 서버 응답 구조 처리
      if (response.data && response.data.data) {
        return response.data.data;
      }

      throw new Error(t("core.ai_manager.error.installations_missing"));
    } catch (error) {
      log.error(t("core.ai_manager.error.installations_failed"), error);
      throw new Error(
        t("core.ai_manager.error.installations_error", {
          message:
            error instanceof Error
              ? error.message
              : t("core.ai_manager.error.unknown_error"),
        }),
      );
    }
  }

  /**
   * GitHub OAuth Client 정보를 가져옵니다.
   * @returns OAuth Client 정보 (oauthClientId)
   */
  public async getGitHubOAuthClientInfo(): Promise<{ oauthClientId: string }> {
    try {
      const response = await fetch.get<APIResponse<{ oauthClientId: string }>>(
        `${this.baseUrl}/github/oauth-client-info`,
      );
      if (response.data && response.data.data) {
        return response.data.data;
      }
      throw new Error(t("core.ai_manager.error.oauth_client_info_missing"));
    } catch (error) {
      log.error(t("core.ai_manager.error.oauth_client_info_failed"), error);
      throw new Error(
        t("core.ai_manager.error.oauth_client_info_error", {
          message:
            error instanceof Error
              ? error.message
              : t("core.ai_manager.error.unknown_error"),
        }),
      );
    }
  }
}

// API 클라이언트 기본 인스턴스 생성
export const aiClient = new AIClient();
