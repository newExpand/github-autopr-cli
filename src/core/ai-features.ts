import { getAIClient } from "./ai-manager.js";
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

interface PRReviewResponse {
  review: string;
}

// 관련 이슈 정보 인터페이스
export interface RelatedIssue {
  id: number;
  title: string;
  url: string;
}

/**
 * API 호출을 통해 AI 기능을 제공하는 클래스
 */
export class AIFeatures {
  private defaultLanguage: SupportedLanguage;
  constructor(defaultLanguage: SupportedLanguage = "ko") {
    this.defaultLanguage = defaultLanguage;
  }

  /**
   * PR 설명을 생성합니다.
   * @param files 변경된 파일 목록
   * @param diffContent diff 내용
   * @param options 옵션 (템플릿, 관련 이슈 등)
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 생성된 PR 설명
   */
  async generatePRDescription(
    files: string[],
    diffContent: string,
    options?: {
      template?: string;
      relatedIssues?: RelatedIssue[];
    },
    language?: SupportedLanguage,
  ): Promise<string> {
    try {
      const lang = language || this.defaultLanguage;
      const result = await getAIClient().callAPI<PRDescriptionResponse>(
        "/ai/google/features/pr-description",
        {
          files,
          diffContent,
          template: options?.template || "",
          relatedIssues: options?.relatedIssues || [],
          language: lang,
        },
      );

      return result.description || "";
    } catch (error) {
      log.error(t("core.ai_features.error.pr_description_failed"), error);
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
    language?: SupportedLanguage,
  ): Promise<string> {
    try {
      const lang = language || this.defaultLanguage;
      const result = await getAIClient().callAPI<PRTitleResponse>(
        "/ai/google/features/pr-title",
        {
          files,
          diffContent,
          type: pattern.type,
          language: lang,
        },
      );

      // 서버에서 이미 [TYPE] 접두사를 추가하므로 그대로 반환
      return result.title || "";
    } catch (error) {
      log.error(t("core.ai_features.error.pr_title_failed"), error);
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
    language?: SupportedLanguage,
  ): Promise<string> {
    try {
      const lang = language || this.defaultLanguage;
      const result = await getAIClient().callAPI<CodeReviewResponse>(
        "/ai/google/features/code-review",
        {
          files,
          language: lang,
        },
      );

      return result.review || "";
    } catch (error) {
      log.error(t("core.ai_features.error.code_review_failed"), error);
      throw error;
    }
  }

  /**
   * 라인별 코드 리뷰를 수행합니다.
   * @param files 리뷰할 파일 목록
   * @param prContext PR 컨텍스트 정보 (선택적)
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns 라인별 코드 리뷰 결과
   */
  async lineByLineCodeReview(
    files: Array<{ path: string; content: string }>,
    prContext?: {
      owner: string;
      repo: string;
      pull_number: number;
      baseBranch?: string;
    },
    language?: SupportedLanguage,
  ): Promise<
    Array<{
      file: string;
      line: number;
      comment: string;
      severity?: "info" | "warning" | "error";
    }>
  > {
    try {
      const lang = language || this.defaultLanguage;
      const requestPayload: any = {
        files,
        language: lang,
        analyzers: ["typo", "security", "bug"],
      };

      // PR 컨텍스트가 제공된 경우 추가
      if (prContext) {
        // GitHub 토큰 정보 가져오기 (가능한 경우)
        let accessToken;
        try {
          const { loadConfig } = await import("./config.js");
          const { getInstallationToken } = await import("./github-app.js");

          // 설정에서 GitHub App 정보 가져오기
          const config = await loadConfig();
          if (config.githubApp?.installationId) {
            try {
              // GitHub App 설치 토큰 가져오기
              accessToken = await getInstallationToken(
                config.githubApp.installationId,
              );
              log.debug("GitHub App 인증 토큰을 생성했습니다.");
            } catch (tokenError) {
              log.debug("GitHub App 토큰 생성 실패:", tokenError);
            }
          }
        } catch (error) {
          log.debug(
            "GitHub 인증 정보를 가져오지 못했습니다. 자세한 오류:",
            error,
          );
        }

        requestPayload.pullRequestContext = {
          owner: prContext.owner,
          repo: prContext.repo,
          pullNumber: prContext.pull_number,
          diffOnly: true, // 변경된 라인만 분석
          baseBranch: prContext.baseBranch || "main", // 기본 브랜치 정보 추가
        };

        // 토큰이 있는 경우에만 추가
        if (accessToken) {
          requestPayload.pullRequestContext.accessToken = accessToken;
          log.debug("GitHub 토큰이 PR 컨텍스트에 추가되었습니다.");
        } else {
          log.debug("GitHub 토큰을 가져오지 못했습니다. 토큰 없이 요청합니다.");
        }

        log.debug(
          `PR #${prContext.pull_number} 컨텍스트 정보가 제공되었습니다.`,
        );
      }

      const result = await getAIClient().callAPI<LineByLineReviewResponse>(
        "/ai/google/features/line-by-line-review",
        requestPayload,
      );

      return result.comments || [];
    } catch (error) {
      log.error(t("core.ai_features.error.line_review_failed"), error);
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
      const result = await getAIClient().callAPI<ConflictResolutionResponse>(
        "/ai/google/features/conflict-resolution",
        {
          conflicts,
          prContext,
          language,
        },
      );

      return result.resolution || "";
    } catch (error) {
      log.error(t("core.ai_features.error.conflict_resolution_failed"), error);
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
      const result = await getAIClient().callAPI<CommitMessageResponse>(
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
      log.error(t("core.ai_features.error.commit_message_failed"), error);
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
      const result = await getAIClient().callAPI<DailyCommitSummaryResponse>(
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
      log.error(t("core.ai_features.error.daily_report_failed"), error);
      throw error;
    }
  }

  /**
   * PR 리뷰를 수행합니다.
   * @param context PR 리뷰 컨텍스트 정보
   * @param language 응답 언어 (ko 또는 en, 기본값: ko)
   * @returns PR 리뷰 텍스트
   */
  async reviewPR(
    context: {
      prNumber: number;
      title: string;
      changedFiles: Array<{
        path: string;
        content: string;
      }>;
      diffContent: string;
      repoOwner?: string;
      repoName?: string;
    },
    language: SupportedLanguage = "ko",
  ): Promise<string> {
    try {
      // 서버측 DTO의 PRReviewDto 및 PRReviewContextDto와 호환되는 구조로 전송
      const result = await getAIClient().callAPI<PRReviewResponse>(
        "/ai/google/features/pr-review",
        {
          context,
          language,
        },
      );

      return result.review;
    } catch (error) {
      log.error(t("core.ai_features.error.pr_review_failed"), error);
      throw error;
    }
  }

  /**
   * AI 기반 PR 전체 생성(제목, 본문, 주요 코드 구현사항, 릴리즈 노트, 키워드, 이슈 등)
   * @param files 변경된 파일 목록
   * @param diffContent diff 내용
   * @param type PR 타입 (feat, fix 등)
   * @param options 관련 이슈, 모델, 언어, 커스텀 지시사항 등
   * @returns 마크다운 string (서버에서 변환)
   */
  async generatePRContent(
    files: string[],
    diffContent: string,
    type: string,
    options?: {
      relatedIssues?: RelatedIssue[];
      modelId?: string;
      language?: SupportedLanguage;
      customInstructions?: string;
    },
  ): Promise<string> {
    try {
      const result = await getAIClient().callAPI<{ content: string }>(
        "/ai/google/features/pr-content",
        {
          files,
          diffContent,
          type,
          relatedIssues: options?.relatedIssues || [],
          modelId: options?.modelId,
          language: options?.language,
          customInstructions: options?.customInstructions,
        },
      );
      return result.content || "";
    } catch (error) {
      log.error(t("core.ai_features.error.pr_content_failed"), error);
      throw error;
    }
  }
}
