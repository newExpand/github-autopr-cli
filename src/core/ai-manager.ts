import { createFetch } from "next-type-fetch";
import { log } from "../utils/logger.js";

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

  constructor(baseUrl: string = "https://api.newextend.com/api") {
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
      log.error(`API 호출 실패 (${endpoint}):`, error);
      throw new Error(
        `API 호출 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      );
    }
  }
}

// API 클라이언트 기본 인스턴스 생성
export const aiClient = new AIClient();
