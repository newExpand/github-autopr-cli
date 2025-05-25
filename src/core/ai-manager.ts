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
  private fetch;

  constructor(baseUrl: string = "https://api.newextend.com/api") {
    this.baseUrl = baseUrl;
    this.loadToken();
    // fetch 인스턴스 한 번만 생성 (authRetry 옵션 적용)
    this.fetch = createFetch({
      authRetry: {
        statusCodes: [401, 403],
        handler: async () => {
          const ok = await this.getAuthToken();
          return ok;
        },
      },
    });
    // 요청 인터셉터: 토큰 만료/갱신 로직 제거, 항상 현재 토큰만 헤더에 주입
    this.fetch.interceptors.request.use(async (config) => {
      config.headers = config.headers || {};
      config.headers["x-ai-api-key"] = this.tokenData?.token || "";
      config.headers["x-title"] = "github-autopr";
      return config;
    });
  }

  /**
   * 토큰 파일에서 JWT 토큰을 로드합니다.
   */
  private loadToken(): void {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
        if (data && data.token && data.expiresAt > Date.now()) {
          this.tokenData = data;
          log.debug(t("core.ai_manager.info.token_loaded"));
        } else {
          log.debug(t("core.ai_manager.warning.token_expired_retrying"));
          this.tokenData = null;
        }
      }
    } catch (error) {
      log.error(t("core.ai_manager.error.token_load_failed"), error);
      this.tokenData = null;
    }
  }

  /**
   * 토큰을 파일에 저장합니다.
   */
  private saveToken(tokenData: TokenData): void {
    try {
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
      const tempFetch = createFetch();
      const response = await tempFetch.post<
        APIResponse<{ token: string; expiresIn: number }>
      >(`${this.baseUrl}/ai/google/auth/token`, {
        title,
      });
      if (response.data?.success && response.data?.data?.token) {
        const { token, expiresIn } = response.data.data;
        this.tokenData = {
          token,
          expiresAt: Date.now() + expiresIn * 1000,
        };
        this.saveToken(this.tokenData);
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
    return await this.executeRequest<T>(endpoint, data);
  }

  /**
   * 실제 API 요청을 실행합니다. (토큰 갱신 로직에서 재사용)
   */
  private async executeRequest<T>(endpoint: string, data: any): Promise<T> {
    const response = await this.fetch.post<APIResponse<T>>(
      `${this.baseUrl}${endpoint}`,
      data,
    );
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data as unknown as T;
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
      const response = await this.fetch.get<
        APIResponse<{ appId: string; clientId: string }>
      >(`${this.baseUrl}/github/app-info`);
      if (response.data && response.data.data) {
        return response.data.data;
      }
      throw new Error(t("core.ai_manager.error.github_app_info_missing"));
    } catch (error: unknown) {
      log.error(t("core.ai_manager.error.github_app_info_failed"), error);
      throw error;
    }
  }

  /**
   * GitHub App 설치 토큰을 획득합니다.
   * @param installationId GitHub App 설치 ID
   * @returns 설치 토큰
   */
  public async getGitHubAppToken(installationId: number): Promise<string> {
    try {
      const response = await this.fetch.get<APIResponse<{ token: string }>>(
        `${this.baseUrl}/github/app-token/${installationId}`,
      );
      if (response.data && response.data.data && response.data.data.token) {
        return response.data.data.token;
      }
      throw new Error(t("core.ai_manager.error.token_missing"));
    } catch (error: unknown) {
      log.error(t("core.ai_manager.error.app_token_failed"), error);
      throw error;
    }
  }

  /**
   * GitHub App 설치 목록을 조회합니다.
   * @returns 설치 목록
   */
  public async getGitHubAppInstallations<T>(): Promise<T> {
    try {
      const response = await this.fetch.get<APIResponse<T>>(
        `${this.baseUrl}/github/app-installations`,
      );
      if (response.data && response.data.data) {
        return response.data.data;
      }
      throw new Error(t("core.ai_manager.error.installations_missing"));
    } catch (error: unknown) {
      log.error(t("core.ai_manager.error.installations_failed"), error);
      throw error;
    }
  }

  /**
   * GitHub OAuth Client 정보를 가져옵니다.
   * @returns OAuth Client 정보 (oauthClientId)
   */
  public async getGitHubOAuthClientInfo(): Promise<{ oauthClientId: string }> {
    try {
      const response = await this.fetch.get<
        APIResponse<{ oauthClientId: string }>
      >(`${this.baseUrl}/github/oauth-client-info`);
      if (response.data && response.data.data) {
        return response.data.data;
      }
      throw new Error(t("core.ai_manager.error.oauth_client_info_missing"));
    } catch (error: unknown) {
      log.error(t("core.ai_manager.error.oauth_client_info_failed"), error);
      throw error;
    }
  }
}

let aiClientInstance: AIClient | null = null;

export function getAIClient(): AIClient {
  if (!aiClientInstance) {
    aiClientInstance = new AIClient();
  }
  return aiClientInstance;
}
