import { Octokit } from "@octokit/rest";
import { log } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { AIFeatures, PRReviewResult } from "../../core/ai-features.js";

interface PREvent {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string;
    user: {
      login: string;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
}

interface CommentEvent {
  action: string;
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
    };
    created_at: string;
  };
  pull_request: {
    number: number;
    title: string;
    body: string;
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
}

/**
 * PR 이벤트를 처리합니다.
 */
async function handlePREvent(event: PREvent, octokit: Octokit): Promise<void> {
  try {
    const { pull_request, repository } = event;
    const prNumber = pull_request.number;
    const owner = repository.owner.login;
    const repo = repository.name;

    log.info(t("commands.review_bot.info.processing_pr", { number: prNumber }));

    // PR 파일 정보 가져오기
    const filesResponse = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // 변경된 파일 내용 가져오기
    const changedFiles = await Promise.all(
      filesResponse.data.map(async (file) => {
        let content = "";
        if (file.status !== "removed") {
          try {
            const contentResponse = await octokit.repos.getContent({
              owner,
              repo,
              path: file.filename,
              ref: pull_request.head.ref,
            });

            if ("content" in contentResponse.data) {
              const base64Content = contentResponse.data.content;
              content = Buffer.from(base64Content, "base64").toString("utf-8");
            }
          } catch (error) {
            log.debug(`파일 내용을 가져오는데 실패했습니다: ${file.filename}`);
          }
        }

        return {
          path: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          content,
        };
      }),
    );

    // PR diff 가져오기
    const diffResponse = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: "diff",
      },
    });

    const diffContent = String(diffResponse.data);

    // AI를 사용하여 PR 리뷰 생성
    const ai = new AIFeatures();
    await ai.initialize();

    // 이제 reviewPR은 요약과 라인별 코멘트를 반환
    const reviewResult = await ai.reviewPR({
      prNumber,
      title: pull_request.title,
      description: pull_request.body || "",
      author: pull_request.user.login,
      changedFiles,
      diffContent,
    });

    // PR에 리뷰 요약 코멘트 작성
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: reviewResult.summary,
    });

    // 라인별 코멘트 추가
    if (reviewResult.lineComments && reviewResult.lineComments.length > 0) {
      log.info(
        `${reviewResult.lineComments.length}개의 라인별 코멘트를 추가합니다...`,
      );

      try {
        // 가장 최근 커밋 SHA 가져오기
        const commitsResponse = await octokit.pulls.listCommits({
          owner,
          repo,
          pull_number: prNumber,
        });

        const latestCommit =
          commitsResponse.data[commitsResponse.data.length - 1];
        const commitSha = latestCommit.sha;

        // PR 리뷰 코멘트 구성
        const comments = reviewResult.lineComments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          body: comment.comment,
        }));

        // PR 리뷰 생성
        await octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: commitSha,
          event: "COMMENT",
          comments: comments,
        });

        log.info(`${comments.length}개의 라인별 코멘트가 PR에 추가되었습니다.`);
      } catch (reviewError) {
        log.error(`라인별 코멘트 추가 중 오류가 발생했습니다: ${reviewError}`);
      }
    }

    log.info(
      t("commands.review_bot.success.review_created", { number: prNumber }),
    );
  } catch (error) {
    log.error(t("commands.review_bot.error.review_failed"), error);
  }
}

/**
 * PR 코멘트 이벤트를 처리합니다.
 */
async function handleCommentEvent(
  event: CommentEvent,
  octokit: Octokit,
): Promise<void> {
  try {
    const { comment, pull_request, repository } = event;
    const prNumber = pull_request.number;
    const owner = repository.owner.login;
    const repo = repository.name;
    const commentId = comment.id;

    // 봇 사용자 계정명 가져오기 (현재 인증된 사용자)
    const { data: currentUser } = await octokit.users.getAuthenticated();
    const botUsername = currentUser.login;

    // 자신의 코멘트는 무시
    if (comment.user.login === botUsername) {
      return;
    }

    log.info(
      t("commands.review_bot.info.processing_comment", { id: commentId }),
    );

    // 모든, 코멘트 가져오기 - 대화 컨텍스트 구성
    const commentsResponse = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // 대화 히스토리 구성
    const conversationHistory = commentsResponse.data
      .filter((c) => c.id <= commentId) // 현재 코멘트까지만 포함
      .map((c) => ({
        author: c.user?.login || "unknown",
        content: c.body || "",
        timestamp: c.created_at,
      }));

    // AI를 사용하여 코멘트 응답 생성
    const ai = new AIFeatures();
    await ai.initialize();

    const response = await ai.generateCommentResponse({
      prNumber,
      commentId,
      commentBody: comment.body,
      author: comment.user.login,
      replyTo: comment.user.login,
      conversationHistory,
    });

    // PR에 응답 코멘트 작성
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: response,
    });

    log.info(
      t("commands.review_bot.success.comment_response_created", {
        id: commentId,
      }),
    );
  } catch (error) {
    log.error(t("commands.review_bot.error.comment_response_failed"), error);
  }
}

/**
 * GitHub Actions에서 실행되는 PR 리뷰 봇 명령어
 */
export async function reviewBotCommand(options: {
  event?: string;
  payload?: string;
}): Promise<void> {
  try {
    // GitHub 토큰 가져오기
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      log.error(t("commands.review_bot.error.no_github_token"));
      process.exit(1);
    }

    // Octokit 인스턴스 생성
    const octokit = new Octokit({
      auth: githubToken,
    });

    // 이벤트와 페이로드 처리
    let event = options.event;
    let payload: any = null;

    // GITHUB_EVENT_NAME과 GITHUB_EVENT_PATH 환경 변수 확인
    if (!event && process.env.GITHUB_EVENT_NAME) {
      event = process.env.GITHUB_EVENT_NAME;
    }

    if (options.payload) {
      try {
        payload = JSON.parse(options.payload);
      } catch (error) {
        log.error(t("commands.review_bot.error.invalid_payload"), error);
        process.exit(1);
      }
    } else if (process.env.GITHUB_EVENT_PATH) {
      // GitHub Actions에서 제공하는 이벤트 파일 읽기
      const fs = await import("fs/promises");
      try {
        const eventPath = process.env.GITHUB_EVENT_PATH;
        const eventData = await fs.readFile(eventPath, "utf-8");
        payload = JSON.parse(eventData);
      } catch (error) {
        log.error(t("commands.review_bot.error.event_file_read"), error);
        process.exit(1);
      }
    }

    if (!event || !payload) {
      log.error(t("commands.review_bot.error.missing_event_or_payload"));
      process.exit(1);
    }

    // 이벤트 유형에 따라 적절한 핸들러 호출
    switch (event) {
      case "pull_request":
        await handlePREvent(payload as PREvent, octokit);
        break;
      case "issue_comment":
      case "pull_request_review_comment":
        await handleCommentEvent(payload as CommentEvent, octokit);
        break;
      default:
        log.warn(t("commands.review_bot.warning.unsupported_event", { event }));
        break;
    }
  } catch (error) {
    log.error(t("commands.review_bot.error.execution_failed"), error);
    process.exit(1);
  }
}
