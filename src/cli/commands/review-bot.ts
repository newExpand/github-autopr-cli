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
  pull_request?: {
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
  issue?: {
    number: number;
    title: string;
    body?: string;
    pull_request?: any; // PR 관련 이슈인지 확인하기 위한 필드
  };
}

// PR 라인 코멘트 이벤트를 위한 인터페이스 추가
interface PRReviewCommentEvent {
  action: string;
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
    };
    created_at: string;
    path: string; // 코멘트가 달린 파일 경로
    line: number; // 코멘트가 달린 라인 번호
    commit_id: string; // 코멘트가 달린 커밋 ID
    position: number; // diff에서의 위치
    html_url?: string; // 코멘트의 HTML URL
  };
  pull_request: {
    number: number;
    title: string;
    body: string;
    head: {
      sha: string;
    };
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
  pull_request_review?: {
    // 리뷰의 일부인 코멘트인 경우 존재
    id: number;
  };
}

// PR 리뷰 이벤트를 위한 인터페이스 추가
interface PRReviewEvent {
  action: string;
  review: {
    id: number;
    body?: string;
    user: {
      login: string;
    };
    state: string;
  };
  pull_request: {
    number: number;
    title: string;
    body: string;
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

        // 유효한 코멘트만 필터링하여 배열 생성
        interface ValidComment {
          path: string;
          position: number;
          body: string;
          line?: number;
        }

        const comments: ValidComment[] = [];

        // 코멘트 필터링 및 변환
        reviewResult.lineComments.forEach((comment) => {
          if (comment.position && comment.position > 0) {
            comments.push({
              path: comment.path,
              position: comment.position,
              body: comment.comment,
              line: comment.line,
            });
          }
        });

        // 코멘트가 없는 경우 리뷰를 건너뜀
        if (comments.length === 0) {
          log.warn("유효한 라인 코멘트가 없어 라인 리뷰를 생성하지 않습니다.");
          return;
        }

        // 디버깅을 위한 코멘트 정보 로깅
        log.debug(`유효한 라인 코멘트 ${comments.length}개를 제출합니다.`);
        if (comments.length > 0) {
          log.debug(`첫 번째 코멘트 예시: ${JSON.stringify(comments[0])}`);
          log.debug(
            `생성된 모든 코멘트의 position 값: ${comments.map((c) => c.position).join(", ")}`,
          );
        }

        try {
          // 개별 라인 코멘트로 분리하여 추가
          log.debug("라인별 개별 코멘트로 추가하는 방식으로 전환합니다.");

          let successCount = 0;
          for (const comment of comments) {
            try {
              await octokit.pulls.createReviewComment({
                owner,
                repo,
                pull_number: prNumber,
                commit_id: commitSha,
                path: comment.path,
                position: comment.position,
                body: comment.body,
              });
              successCount++;
              log.debug(
                `성공적으로 추가된 라인 코멘트: ${comment.path}:${comment.position}`,
              );
            } catch (commentError) {
              log.debug(`개별 코멘트 추가 실패: ${commentError}`);
            }
          }

          log.info(
            `${successCount}/${comments.length}개의 라인별 코멘트가 PR에 추가되었습니다.`,
          );
        } catch (reviewError) {
          log.error(
            `라인별 코멘트 추가 중 오류가 발생했습니다: ${reviewError}`,
          );
          // 오류 메시지 상세 로깅
          if (reviewError instanceof Error) {
            log.debug(`오류 상세 정보: ${reviewError.message}`);
            if (
              typeof reviewError === "object" &&
              reviewError !== null &&
              "response" in reviewError
            ) {
              const errorWithResponse = reviewError as {
                response?: { data?: unknown };
              };
              if (errorWithResponse.response?.data) {
                log.debug(
                  `API 응답: ${JSON.stringify(errorWithResponse.response.data)}`,
                );
              }
            }
          }

          // 백업 계획: 일반 댓글로 리뷰 피드백 추가
          log.debug("라인별 코멘트 추가 실패로 인해 일반 코멘트로 변환합니다.");

          let commentBody = "## 코드 리뷰 피드백\n\n";
          for (const comment of comments) {
            commentBody += `### ${comment.path}:${comment.line || "라인 정보 없음"}\n\n${comment.body}\n\n---\n\n`;
          }

          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: commentBody,
          });

          log.info("일반 코멘트로 리뷰 피드백이 추가되었습니다.");
        }
      } catch (error) {
        log.error(`PR #${prNumber} 처리 중 오류 발생: ${error}`);
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
    const { comment, pull_request, repository, issue } = event;

    // PR 번호 확인 (pull_request 또는 issue.pull_request에서)
    let prNumber: number | undefined;

    if (pull_request) {
      // pull_request_review_comment 이벤트인 경우
      prNumber = pull_request.number;
    } else if (issue?.pull_request) {
      // issue_comment 이벤트이면서 PR 관련 이슈인 경우
      prNumber = issue.number;
    }

    // PR 번호가 없는 경우 (일반 이슈 댓글인 경우) 처리하지 않음
    if (!prNumber) {
      log.debug("PR 관련 댓글이 아니므로 무시합니다.");
      return;
    }

    const owner = repository.owner.login;
    const repo = repository.name;
    const commentId = comment.id;

    log.info(
      t("commands.review_bot.info.processing_comment", { id: commentId }),
    );

    // Conversation 탭의 코멘트임을 로깅
    log.debug(
      `"Conversation" 탭에서 작성된 코멘트 ID ${commentId}를 처리합니다.`,
    );

    // 봇 사용자 계정명 가져오기 (권한 문제를 방지하기 위해 try-catch로 감싸기)
    let botUsername = "github-actions[bot]"; // 기본값 설정
    try {
      const { data: currentUser } = await octokit.users.getAuthenticated();
      botUsername = currentUser.login;
      log.debug(`인증된 사용자: ${botUsername}`);
    } catch (error) {
      // 권한 문제로 사용자 정보를 가져올 수 없는 경우 기본값 사용
      log.debug(
        `인증된 사용자 정보를 가져올 수 없습니다. 기본값 사용: ${error}`,
      );
    }

    // 자신의 코멘트 또는 다른 봇의 코멘트는 무시
    if (
      comment.user.login === botUsername ||
      comment.user.login === "github-actions[bot]" ||
      comment.user.login.includes("bot")
    ) {
      log.debug("봇의 코멘트는 무시합니다.");
      return;
    }

    // 이미 이 코멘트에 응답했는지 확인
    const commentsResponse = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // 봇이 이미 응답한 코멘트 확인 (코멘트 ID 참조)
    const alreadyResponded = commentsResponse.data.some(
      (existingComment) =>
        (existingComment.user?.login === botUsername ||
          existingComment.user?.login === "github-actions[bot]") &&
        existingComment.body?.includes(`원본 코멘트 ID: ${commentId}`),
    );

    if (alreadyResponded) {
      log.debug(`이미 코멘트 ID ${commentId}에 응답했습니다.`);
      return;
    }

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

    // PR에 응답 코멘트 작성 (코멘트 ID 포함)
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `@${comment.user.login} ${response}\n\n<!-- 원본 코멘트 ID: ${commentId} -->`,
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
 * PR 라인 코멘트 이벤트를 처리합니다. 특정 파일의 특정 라인에 대한 코멘트에 응답합니다.
 */
async function handlePRReviewCommentEvent(
  event: PRReviewCommentEvent,
  octokit: Octokit,
): Promise<void> {
  try {
    const { comment, pull_request, repository, pull_request_review } = event;
    const prNumber = pull_request.number;
    const owner = repository.owner.login;
    const repo = repository.name;
    const commentId = comment.id;

    // 리뷰의 일부인 코멘트인지 확인
    // "Start a review" 기능으로 코멘트를 남긴 경우 pull_request_review 필드가 존재함
    if (pull_request_review) {
      log.debug(
        `리뷰 ID: ${pull_request_review.id}의 일부인 코멘트입니다. 이 코멘트는 리뷰가 제출될 때 처리됩니다.`,
      );
      return;
    }

    log.info(
      t("commands.review_bot.info.processing_review_comment", {
        id: commentId,
      }),
    );

    // "Files changed" 탭의 개별 코멘트임을 로깅
    log.debug(
      `"Files changed" 탭에서 작성된 단일 코멘트 ID ${commentId}를 처리합니다.`,
    );

    // 봇 사용자 계정명 가져오기 (권한 문제를 방지하기 위해 try-catch로 감싸기)
    let botUsername = "github-actions[bot]"; // 기본값 설정
    try {
      const { data: currentUser } = await octokit.users.getAuthenticated();
      botUsername = currentUser.login;
      log.debug(`인증된 사용자: ${botUsername}`);
    } catch (error) {
      // 권한 문제로 사용자 정보를 가져올 수 없는 경우 기본값 사용
      log.debug(
        `인증된 사용자 정보를 가져올 수 없습니다. 기본값 사용: ${error}`,
      );
    }

    // 자신의 코멘트 또는 다른 봇의 코멘트는 무시
    if (
      comment.user.login === botUsername ||
      comment.user.login === "github-actions[bot]" ||
      comment.user.login.includes("bot")
    ) {
      log.debug("봇의 코멘트는 무시합니다.");
      return;
    }

    // PR의 기존 코멘트 확인
    const commentsResponse = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // 이미 이 코멘트에 응답했는지 확인
    const alreadyResponded = commentsResponse.data.some(
      (existingComment) =>
        (existingComment.user?.login === botUsername ||
          existingComment.user?.login === "github-actions[bot]") &&
        existingComment.body?.includes(`라인 코멘트 ID: ${commentId}`),
    );

    if (alreadyResponded) {
      log.debug(`이미 라인 코멘트 ID ${commentId}에 응답했습니다.`);
      return;
    }

    // 해당 PR의 모든 리뷰 코멘트 가져오기
    const reviewCommentsResponse = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
    });

    // 대화 히스토리 구성
    const conversationHistory = reviewCommentsResponse.data
      .filter((c) => c.id <= commentId) // 현재 코멘트까지만 포함
      .map((c) => ({
        author: c.user?.login || "unknown",
        content: c.body || "",
        timestamp: c.created_at,
      }));

    // 코드 컨텍스트 정보 가져오기
    let codeContext = "";
    try {
      // 해당 파일의 내용 가져오기
      const fileContentResponse = await octokit.repos.getContent({
        owner,
        repo,
        path: comment.path,
        ref: pull_request.head.sha,
      });

      if ("content" in fileContentResponse.data) {
        const fileContent = Buffer.from(
          fileContentResponse.data.content,
          "base64",
        ).toString("utf-8");

        // 코멘트가 달린 라인 주변 코드 추출 (5줄 전후)
        const lines = fileContent.split("\n");
        const startLine = Math.max(0, comment.line - 5);
        const endLine = Math.min(lines.length, comment.line + 5);

        codeContext = `File: ${comment.path}, Line ${comment.line}\n\`\`\`\n${lines
          .slice(startLine, endLine)
          .join("\n")}\n\`\`\``;
      }
    } catch (error) {
      log.debug(`코드 컨텍스트를 가져오는데 실패했습니다: ${error}`);
    }

    // AI를 사용하여 코멘트 응답 생성
    const ai = new AIFeatures();
    await ai.initialize();

    const response = await ai.generateCommentResponse({
      prNumber,
      commentId,
      commentBody: comment.body,
      author: comment.user.login,
      replyTo: comment.user.login,
      codeContext,
      conversationHistory,
    });

    // 원본 코멘트의 정보 추가
    let replyPrefix = `**${comment.user.login}님의 코드 리뷰 코멘트에 대한 응답:**\n\n`;

    // 코멘트 URL이 있으면 링크 추가
    if (comment.html_url) {
      replyPrefix = `**${comment.user.login}님의 [코드 리뷰 코멘트](${comment.html_url})에 대한 응답:**\n\n`;
    }

    replyPrefix += `> ${comment.body}\n\n`;
    const fullResponse =
      replyPrefix + response + `\n\n<!-- 라인 코멘트 ID: ${commentId} -->`;

    // PR 리뷰 코멘트에 대한 응답을 일반 PR 코멘트로 작성
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: fullResponse,
    });

    log.info(
      t("commands.review_bot.success.review_comment_response_created", {
        id: commentId,
      }),
    );
  } catch (error) {
    log.error(
      t("commands.review_bot.error.review_comment_response_failed"),
      error,
    );
  }
}

/**
 * PR 리뷰 이벤트를 처리합니다. 이는 PR 전체에 대한 리뷰를 담당합니다.
 */
async function handlePRReviewEvent(
  event: PRReviewEvent,
  octokit: Octokit,
): Promise<void> {
  try {
    const { review, pull_request, repository } = event;
    const prNumber = pull_request.number;
    const owner = repository.owner.login;
    const repo = repository.name;

    // 리뷰 상태가 submitted가 아니면 무시
    if (event.action !== "submitted") {
      log.debug(
        `리뷰 이벤트 action이 submitted가 아니므로 무시합니다: ${event.action}`,
      );
      return;
    }

    log.info(`PR #${prNumber}에 대한 리뷰 이벤트를 처리합니다.`);

    // 봇 사용자 정보 확인 (권한 문제를 방지하기 위해 try-catch로 감싸기)
    let botUsername = "github-actions[bot]"; // 기본값 설정
    try {
      const { data: currentUser } = await octokit.users.getAuthenticated();
      botUsername = currentUser.login;
      log.debug(`인증된 사용자: ${botUsername}`);
    } catch (error) {
      // 권한 문제로 사용자 정보를 가져올 수 없는 경우 기본값 사용
      log.debug(
        `인증된 사용자 정보를 가져올 수 없습니다. 기본값 사용: ${error}`,
      );
    }

    // 자신의 리뷰는 무시
    if (review.user.login === botUsername) {
      log.debug("자신의 리뷰는 무시합니다.");
      return;
    }

    // 이미 코드 리뷰 봇이 응답했는지 확인
    const commentsResponse = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // 봇이 이미 응답한 코멘트 확인
    const botComments = commentsResponse.data.filter(
      (comment) =>
        comment.user?.login === botUsername ||
        comment.user?.login === "github-actions[bot]",
    );

    // 리뷰 ID에 기반한 응답 체크
    const alreadyResponded = botComments.some((comment) =>
      comment.body?.includes(`리뷰 ID: ${review.id}`),
    );

    if (alreadyResponded) {
      log.debug(`이미 리뷰 ID ${review.id}에 응답했습니다.`);
      return;
    }

    // AI를 사용하여 리뷰에 대한 응답 생성
    const ai = new AIFeatures();
    await ai.initialize();

    const contextPrompt = `
PR #${prNumber} "${pull_request.title}"에 대한 리뷰에 응답합니다.
리뷰어: ${review.user.login}
리뷰 내용: ${review.body || "(내용 없음)"}
리뷰 상태: ${review.state}
`;

    const response = await ai.generateCommentResponse({
      prNumber,
      commentId: review.id,
      commentBody: review.body || "",
      author: review.user.login,
      replyTo: review.user.login,
      conversationHistory: [
        {
          author: review.user.login,
          content: review.body || "",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    // 응답 코멘트 추가 (리뷰 ID 포함)
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `@${review.user.login}님의 리뷰에 대한 응답입니다.\n\n${response}\n\n<!-- 리뷰 ID: ${review.id} -->`,
    });

    log.info(
      `PR #${prNumber}의 리뷰 ID ${review.id}에 대한 응답을 생성했습니다.`,
    );
  } catch (error) {
    log.error(`PR 리뷰 이벤트 처리 중 오류가 발생했습니다:`, error);
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
        // issue_comment 이벤트가 PR 관련 댓글인지 확인
        if (payload.issue && payload.issue.pull_request) {
          // PR 관련 댓글인 경우에만 처리
          // CommentEvent 인터페이스와 맞지 않을 수 있으므로 필요한 필드 매핑
          const commentEvent: CommentEvent = {
            action: payload.action,
            comment: payload.comment,
            pull_request: {
              number: payload.issue.number,
              title: payload.issue.title,
              body: payload.issue.body || "",
            },
            repository: payload.repository,
          };
          await handleCommentEvent(commentEvent, octokit);
        } else {
          log.debug("PR 관련 댓글이 아니므로 무시합니다.");
        }
        break;
      case "pull_request_review_comment":
        await handlePRReviewCommentEvent(
          payload as PRReviewCommentEvent,
          octokit,
        );
        break;
      case "pull_request_review":
        await handlePRReviewEvent(payload as PRReviewEvent, octokit);
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
