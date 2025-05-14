import { aiClient } from "./ai-manager.js";
import { log } from "../utils/logger.js";
import { t } from "../i18n/index.js";

// 지원 언어 타입 정의
export type SupportedLanguage = "ko" | "en";

// API 응답 타입 정의
interface PRDescriptionResponse {
  description: string;
}

interface PRTitleResponse {
  title: string;
}

interface CodeReviewResponse {
  review: string;
}

interface LineByLineReviewResponse {
  comments: Array<{
    file: string;
    line: number;
    comment: string;
    severity?: "info" | "warning" | "error";
  }>;
}

interface ConflictResolutionResponse {
  resolution: string;
}

interface CommitMessageResponse {
  message: string;
}

interface DailyCommitSummaryResponse {
  summary: string;
}

/**
 * API 호출을 통해 AI 기능을 제공하는 클래스
 */
export class AIFeatures {
  constructor() {
    // 생성자 간소화
  }

  /**
   * PR 설명을 생성합니다.
   * @param files 변경된 파일 목록
   * @param diffContent diff 내용
   * @param options 옵션 (템플릿 등)
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 생성된 PR 설명
   */
  async generatePRDescription(
    files: string[],
    diffContent: string,
    options?: { template?: string },
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<PRDescriptionResponse>(
        "/ai/google/features/pr-description",
        {
          files,
          diffContent,
          template: options?.template || "",
          language,
        },
      );

      return result.description || "";
    } catch (error) {
      log.error(t("ai.error.pr_description_failed"), error);
      throw error;
    }
  }

  /**
   * PR 제목을 생성합니다.
   * @param files 변경된 파일 목록
   * @param diffContent diff 내용
   * @param pattern 제목 패턴 정보
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 생성된 PR 제목
   */
  async generatePRTitle(
    files: string[],
    diffContent: string,
    pattern: { type: string },
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<PRTitleResponse>(
        "/ai/google/features/pr-title",
        {
          files,
          diffContent,
          type: pattern.type,
          language,
        },
      );

      return `[${pattern.type.toUpperCase()}] ${result.title || ""}`;
    } catch (error) {
      log.error(t("ai.error.pr_title_failed"), error);
      throw error;
    }
  }

  /**
   * 코드 리뷰를 수행합니다.
   * @param files 리뷰할 파일 목록
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 코드 리뷰 결과
   */
  async reviewCode(
    files: Array<{ path: string; content: string }>,
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<CodeReviewResponse>(
        "/ai/google/features/code-review",
        {
          files,
          language,
        },
      );

      return result.review || "";
    } catch (error) {
      log.error(t("ai.error.code_review_failed"), error);
      throw error;
    }
  }

  /**
   * 라인별 코드 리뷰를 수행합니다.
   * @param files 리뷰할 파일 목록
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 라인별 코드 리뷰 결과
   */
  async lineByLineCodeReview(
    files: Array<{ path: string; content: string }>,
    language: SupportedLanguage = "ko",
  ): Promise<
    Array<{
      file: string;
      line: number;
      comment: string;
      severity?: "info" | "warning" | "error";
    }>
  > {
    try {
      const result = await aiClient.callAPI<LineByLineReviewResponse>(
        "/ai/google/features/line-by-line-review",
        {
          files,
          language,
          analyzers: ["typo", "security", "bug"],
        },
      );

      return result.comments || [];
    } catch (error) {
      log.error(t("ai.error.line_review_failed"), error);
      throw error;
    }
  }

  /**
   * 병합 충돌 해결 제안을 생성합니다.
   * @param conflicts 충돌 정보 목록
   * @param prContext PR 컨텍스트 정보
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 충돌 해결 제안
   */
  async suggestConflictResolution(
    conflicts: Array<{ file: string; conflict: string }>,
    prContext?: {
      title: string;
      description: string;
      changedFiles: Array<{
        filename: string;
        additions: number;
        deletions: number;
        changes: number;
      }>;
    },
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<ConflictResolutionResponse>(
        "/ai/google/features/conflict-resolution",
        {
          conflicts,
          prContext,
          language,
        },
      );

      return result.resolution || "";
    } catch (error) {
      log.error(t("ai.error.conflict_resolution_failed"), error);
      throw error;
    }
  }

  /**
   * 커밋 메시지를 개선합니다.
   * @param message 현재 커밋 메시지
   * @param diff diff 내용
   * @param changedFiles 변경된 파일 목록
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 개선된 커밋 메시지
   */
  async improveCommitMessage(
    message: string,
    diff: string,
    changedFiles?: string[],
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<CommitMessageResponse>(
        "/ai/google/features/improve-commit-message",
        {
          message,
          diff,
          changedFiles: changedFiles || [],
          language,
        },
      );

      return result.message || "";
    } catch (error) {
      log.error(t("ai.error.commit_message_failed"), error);
      throw error;
    }
  }

  /**
   * 일일 커밋 보고서 요약을 생성합니다.
   * @param commits 커밋 정보 배열
   * @param username 사용자 이름
   * @param date 보고서 날짜 또는 날짜 범위
   * @param stats 커밋 통계 정보
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 생성된 보고서 요약
   */
  async generateDailyCommitSummary(
    commits: Array<{
      sha: string;
      message: string;
      date: string;
      files?: Array<{
        filename: string;
        additions: number;
        deletions: number;
      }>;
    }>,
    username: string,
    date: string,
    stats: {
      totalCommits: number;
      filesChanged: number;
      additions: number;
      deletions: number;
      branches?: Record<string, number>;
      fileTypes?: Record<string, number>;
    },
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      const result = await aiClient.callAPI<DailyCommitSummaryResponse>(
        "/ai/google/features/daily-commit-summary",
        {
          commits,
          username,
          date,
          stats,
          language,
        },
      );

      return result.summary || "";
    } catch (error) {
      log.error(t("ai.error.daily_report_failed"), error);
      throw error;
    }
  }
}
