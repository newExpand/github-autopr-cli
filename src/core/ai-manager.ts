import { createFetch } from "next-type-fetch";
import { log } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import fs from "fs";
import path from "path";
import os from "os";

// 설정 및 토큰 저장 경로
const CONFIG_DIR = path.join(os.homedir(), ".autopr");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");

// 토큰 인터페이스
interface TokenData {
  token: string;
  expiresAt: number; // UNIX timestamp (milliseconds)
}

// 기본 fetch 인스턴스 생성
const createClient = (token?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-title": "github-autopr",
  };

  // JWT 토큰이 있을 때만 x-ai-api-key 헤더 설정
  if (token) {
    headers["x-ai-api-key"] = token;
  }

  return createFetch({ headers });
};

// 초기 기본 클라이언트 (토큰 없이)
let fetch = createClient();

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
  private tokenData: TokenData | null = null;

  constructor(baseUrl: string = "http://localhost:4000/api") {
    this.baseUrl = baseUrl;
    this.loadToken();
  }

  /**
   * 토큰 파일에서 JWT 토큰을 로드합니다.
   */
  private loadToken(): void {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));

        // 토큰 유효성 검증 (만료 여부)
        if (data && data.token && data.expiresAt > Date.now()) {
          this.tokenData = data;
          // 토큰으로 fetch 클라이언트 재생성
          fetch = createClient(data.token);
          log.debug(t("core.ai_manager.info.token_loaded"));
        } else {
          log.debug(t("core.ai_manager.info.token_expired"));
          this.tokenData = null;
          fetch = createClient(); // 토큰 없는 클라이언트로 초기화
        }
      }
    } catch (error) {
      log.error(t("core.ai_manager.error.token_load_failed"), error);
      this.tokenData = null;
      fetch = createClient(); // 오류 시 토큰 없는 클라이언트로 초기화
    }
  }

  /**
   * 토큰을 파일에 저장합니다.
   */
  private saveToken(tokenData: TokenData): void {
    try {
      // 디렉토리가 없으면 생성
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), "utf-8");

      log.debug(t("core.ai_manager.info.token_saved"));
    } catch (error) {
      log.error(t("core.ai_manager.error.token_save_failed"), error);
    }
  }

  /**
   * 서버에서 JWT 토큰을 발급받습니다.
   * @param title 클라이언트 식별용 타이틀
   */
  public async getAuthToken(title: string = "github-autopr"): Promise<boolean> {
    try {
      // 이미 유효한 토큰이 있으면 스킵
      if (this.tokenData && this.tokenData.expiresAt > Date.now()) {
        return true;
      }

      // 기본 클라이언트로 토큰 요청 (토큰 없음)
      const tempClient = createClient();
      const response = await tempClient.post<
        APIResponse<{ token: string; expiresIn: number }>
      >(`${this.baseUrl}/ai/google/auth/token`, {
        title,
      });

      if (response.data?.success && response.data?.data?.token) {
        const { token, expiresIn } = response.data.data;

        // 토큰 데이터 저장 (만료시간은 현재시간 + expiresIn초)
        this.tokenData = {
          token,
          expiresAt: Date.now() + expiresIn * 1000,
        };

        // 토큰 파일에 저장
        this.saveToken(this.tokenData);

        // 새 토큰으로 fetch 클라이언트 업데이트
        fetch = createClient(token);

        log.info(t("core.ai_manager.info.token_acquired"));
        return true;
      }

      return false;
    } catch (error) {
      log.error(t("core.ai_manager.error.token_acquisition_failed"), error);
      return false;
    }
  }

  /**
   * API 엔드포인트를 호출합니다.
   * @param endpoint API 엔드포인트 경로
   * @param data 요청 데이터
   * @returns API 응답 데이터
   */
  public async callAPI<T>(endpoint: string, data: any): Promise<T> {
    try {
      // API 호출 전에 토큰 유효성 확인 및 필요시 갱신
      const tokenValid = await this.ensureValidToken();
      if (!tokenValid) {
        log.error(t("core.ai_manager.error.no_valid_token"));
        throw new Error(t("core.ai_manager.error.authentication_required"));
      }

      // 토큰 정보 로깅 (테스트용)
      if (this.tokenData) {
        const timeToExpiry = this.tokenData.expiresAt - Date.now();
        log.info(
          `API 호출 (${endpoint}) - 토큰 만료까지 ${Math.round(timeToExpiry / 1000)}초 남음`,
        );
      }

      return await this.executeRequest<T>(endpoint, data);
    } catch (error) {
      // 인증 오류(401)인 경우 토큰 갱신 시도 후 재시도
      if (
        typeof error === "object" &&
        error !== null &&
        ((error as any).status === 401 ||
          (error as any).statusCode === 401 ||
          (error as Error).message?.includes("401"))
      ) {
        log.warn(t("core.ai_manager.warning.token_expired_retrying"));
        // 토큰 강제 만료 처리
        if (this.tokenData) {
          this.tokenData.expiresAt = 0;
        }

        // 토큰 새로 발급 시도
        const tokenRefreshed = await this.getAuthToken();
        if (tokenRefreshed) {
          log.info(t("core.ai_manager.info.token_refreshed_retrying"));
          // 토큰 갱신 성공 시 원래 요청 다시 시도
          return await this.executeRequest<T>(endpoint, data);
        }
      }

      // 다른 오류이거나 토큰 갱신 실패 시
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
   * 실제 API 요청을 실행합니다. (토큰 갱신 로직에서 재사용)
   */
  private async executeRequest<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch.post<APIResponse<T>>(
      `${this.baseUrl}${endpoint}`,
      data,
    );

    // 서버 응답 구조 처리
    if (response.data && response.data.data) {
      return response.data.data;
    }

    return response.data as unknown as T;
  }

  /**
   * 토큰이 유효한지 확인하고, 필요한 경우 갱신합니다.
   * @returns 유효한 토큰이 있으면 true, 없으면 false
   */
  private async ensureValidToken(): Promise<boolean> {
    const TEN_SECONDS = 10 * 1000; // 테스트용 - 10초 전에 만료되면 갱신

    // 토큰이 없거나 곧 만료되면 갱신
    if (!this.tokenData) {
      log.debug(t("core.ai_manager.info.no_token"));
      return await this.getAuthToken();
    }

    const timeToExpiry = this.tokenData.expiresAt - Date.now();
    log.debug(`토큰 만료까지 남은 시간: ${Math.round(timeToExpiry / 1000)}초`);

    if (timeToExpiry < TEN_SECONDS) {
      log.debug(t("core.ai_manager.info.token_expiring_soon"));
      return await this.getAuthToken();
    }

    return true;
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
      // API 호출 전에 토큰 유효성 확인
      const tokenValid = await this.ensureValidToken();
      if (!tokenValid) {
        throw new Error(t("core.ai_manager.error.authentication_required"));
      }

      const response = await fetch.get<
        APIResponse<{ appId: string; clientId: string }>
      >(`${this.baseUrl}/github/app-info`);

      // 서버 응답 구조 처리
      if (response.data && response.data.data) {
        return response.data.data;
      }

      throw new Error(t("core.ai_manager.error.github_app_info_missing"));
    } catch (error) {
      // 인증 오류(401)인 경우 토큰 갱신 시도 후 재시도
      if (
        typeof error === "object" &&
        error !== null &&
        ((error as any).status === 401 ||
          (error as any).statusCode === 401 ||
          (error as Error).message?.includes("401"))
      ) {
        // 토큰 강제 만료 처리 및 갱신
        if (this.tokenData) {
          this.tokenData.expiresAt = 0;
        }
        const tokenRefreshed = await this.getAuthToken();
        if (tokenRefreshed) {
          // 토큰 갱신 성공 시 원래 요청 다시 시도
          return await this.getGitHubAppInfo();
        }
      }

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
      // API 호출 전에 토큰 유효성 확인
      const tokenValid = await this.ensureValidToken();
      if (!tokenValid) {
        throw new Error(t("core.ai_manager.error.authentication_required"));
      }

      const response = await fetch.get<APIResponse<{ token: string }>>(
        `${this.baseUrl}/github/app-token/${installationId}`,
      );

      // 서버 응답 구조 처리
      if (response.data && response.data.data && response.data.data.token) {
        return response.data.data.token;
      }

      throw new Error(t("core.ai_manager.error.token_missing"));
    } catch (error) {
      // 인증 오류(401)인 경우 토큰 갱신 시도 후 재시도
      if (
        typeof error === "object" &&
        error !== null &&
        ((error as any).status === 401 ||
          (error as any).statusCode === 401 ||
          (error as Error).message?.includes("401"))
      ) {
        // 토큰 강제 만료 처리 및 갱신
        if (this.tokenData) {
          this.tokenData.expiresAt = 0;
        }
        const tokenRefreshed = await this.getAuthToken();
        if (tokenRefreshed) {
          // 토큰 갱신 성공 시 원래 요청 다시 시도
          return await this.getGitHubAppToken(installationId);
        }
      }

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
      // API 호출 전에 토큰 유효성 확인
      const tokenValid = await this.ensureValidToken();
      if (!tokenValid) {
        throw new Error(t("core.ai_manager.error.authentication_required"));
      }

      const response = await fetch.get<APIResponse<T>>(
        `${this.baseUrl}/github/app-installations`,
      );

      // 서버 응답 구조 처리
      if (response.data && response.data.data) {
        return response.data.data;
      }

      throw new Error(t("core.ai_manager.error.installations_missing"));
    } catch (error) {
      // 인증 오류(401)인 경우 토큰 갱신 시도 후 재시도
      if (
        typeof error === "object" &&
        error !== null &&
        ((error as any).status === 401 ||
          (error as any).statusCode === 401 ||
          (error as Error).message?.includes("401"))
      ) {
        // 토큰 강제 만료 처리 및 갱신
        if (this.tokenData) {
          this.tokenData.expiresAt = 0;
        }
        const tokenRefreshed = await this.getAuthToken();
        if (tokenRefreshed) {
          // 토큰 갱신 성공 시 원래 요청 다시 시도
          return await this.getGitHubAppInstallations<T>();
        }
      }

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
      // API 호출 전에 토큰 유효성 확인
      const tokenValid = await this.ensureValidToken();
      if (!tokenValid) {
        throw new Error(t("core.ai_manager.error.authentication_required"));
      }

      const response = await fetch.get<APIResponse<{ oauthClientId: string }>>(
        `${this.baseUrl}/github/oauth-client-info`,
      );
      if (response.data && response.data.data) {
        return response.data.data;
      }
      throw new Error(t("core.ai_manager.error.oauth_client_info_missing"));
    } catch (error) {
      // 인증 오류(401)인 경우 토큰 갱신 시도 후 재시도
      if (
        typeof error === "object" &&
        error !== null &&
        ((error as any).status === 401 ||
          (error as any).statusCode === 401 ||
          (error as Error).message?.includes("401"))
      ) {
        // 토큰 강제 만료 처리 및 갱신
        if (this.tokenData) {
          this.tokenData.expiresAt = 0;
        }
        const tokenRefreshed = await this.getAuthToken();
        if (tokenRefreshed) {
          // 토큰 갱신 성공 시 원래 요청 다시 시도
          return await this.getGitHubOAuthClientInfo();
        }
      }

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
