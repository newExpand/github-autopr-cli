import { Octokit } from "@octokit/rest";
import { log } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

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

// 이 부분은 GitHub Actions에서 직접 처리하므로 처리 로직은 제거하지만,
// 타입 인터페이스는 남겨둡니다 (이후에 참조할 수 있도록)
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
    id: number;
  };
}

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
 * 라인별 코멘트 처리 및 추가를 위한 도우미 함수
 */
async function addLineComments(
  owner: string,
  repo: string,
  prNumber: number,
  comments: Array<{
    path: string;
    position: number;
    body: string;
    line?: number;
  }>,
  commitSha: string,
  octokit: Octokit,
): Promise<number> {
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

  return successCount;
}

/**
 * 라인별 코멘트 실패 시 일반 코멘트로 변환하는 도우미 함수
 */
async function addFallbackComment(
  owner: string,
  repo: string,
  prNumber: number,
  comments: Array<{
    path: string;
    position: number;
    body: string;
    line?: number;
  }>,
  octokit: Octokit,
): Promise<void> {
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

    // AIFeatures 동적 import로 변경
    const { AIFeatures } = await import("../../core/ai-features.js");
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
          // 라인별 코멘트 추가
          const successCount = await addLineComments(
            owner,
            repo,
            prNumber,
            comments,
            commitSha,
            octokit,
          );

          // 모든 코멘트 추가 실패 시 대체 방법 사용
          if (successCount === 0 && comments.length > 0) {
            await addFallbackComment(owner, repo, prNumber, comments, octokit);
          }
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

          // 오류 발생 시 대체 방법으로 일반 코멘트 사용
          await addFallbackComment(owner, repo, prNumber, comments, octokit);
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

// 중요: 이 명령어 핸들러는 이제 PR 이벤트만 처리합니다.
// 다른 이벤트 타입(코멘트, 리뷰 등)은 GitHub Actions에서 직접 처리합니다.
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

    // 내부 로그는 디버그 로그로 남기고 (GitHub Actions 로그에만 표시)
    log.debug(
      `이벤트 타입: ${event} - GitHub Actions 워크플로우에서 처리됩니다.`,
    );

    // 이벤트 타입에 따라 처리
    if (event === "pull_request") {
      // PR 이벤트는 기존대로 처리
      await handlePREvent(payload as PREvent, octokit);
    } else if (
      event === "issue_comment" &&
      payload.issue &&
      payload.issue.pull_request
    ) {
      // 이슈 코멘트 처리 (PR 관련 코멘트)
      await generateAIResponse(event, payload);
    } else if (event === "pull_request_review_comment") {
      // PR 리뷰 코멘트 처리
      await generateAIResponse(event, payload);
    } else if (event === "pull_request_review") {
      // PR 리뷰 처리
      await generateAIResponse(event, payload);
    } else {
      // 지원하지 않는 이벤트
      log.warn(t("commands.review_bot.warning.unsupported_event", { event }));
      console.log(""); // 빈 응답
    }
  } catch (error) {
    log.error(t("commands.review_bot.error.execution_failed"), error);
    process.exit(1);
  }
}

/**
 * 이벤트 타입과 페이로드에 따라 적절한 AI 응답을 생성합니다.
 */
async function generateAIResponse(
  eventType: string,
  payload: any,
): Promise<void> {
  try {
    // AIFeatures 동적 import
    const { AIFeatures } = await import("../../core/ai-features.js");
    const ai = new AIFeatures();
    await ai.initialize();

    // 응답 컨텍스트 준비
    let prNumber = 0;
    let commentId = 0;
    let commentBody = "";
    let author = "";

    if (eventType === "issue_comment") {
      prNumber = payload.issue.number;
      commentId = payload.comment.id;
      commentBody = payload.comment.body;
      author = payload.comment.user.login;

      // AI 응답 생성
      const response = await ai.generateCommentResponse({
        prNumber,
        commentId,
        commentBody,
        author,
        conversationHistory: [
          {
            author,
            content: commentBody,
            timestamp: new Date(payload.comment.created_at).toLocaleString(),
          },
        ],
      });

      // 응답 출력 (디버그 로그 없이)
      console.log(`@${author}님의 질문에 대한 답변입니다:\n\n${response}`);
    } else if (eventType === "pull_request_review_comment") {
      prNumber = payload.pull_request.number;
      commentId = payload.comment.id;
      commentBody = payload.comment.body;
      author = payload.comment.user.login;

      // 코드 컨텍스트 추가
      const codeContext = `파일: ${payload.comment.path}\n라인: ${payload.comment.line}`;

      // AI 응답 생성
      const response = await ai.generateCommentResponse({
        prNumber,
        commentId,
        commentBody,
        author,
        codeContext,
        conversationHistory: [
          {
            author,
            content: commentBody,
            timestamp: new Date(payload.comment.created_at).toLocaleString(),
          },
        ],
      });

      // 응답 출력 (디버그 로그 없이)
      console.log(`${response}`);
    } else if (eventType === "pull_request_review") {
      prNumber = payload.pull_request.number;
      commentId = payload.review.id;
      commentBody = payload.review.body || "";
      author = payload.review.user.login;

      // AI 응답 생성
      const response = await ai.generateCommentResponse({
        prNumber,
        commentId,
        commentBody,
        author,
        conversationHistory: [
          {
            author,
            content: commentBody,
            timestamp: new Date().toLocaleString(),
          },
        ],
      });

      // 응답 출력 (디버그 로그 없이)
      console.log(`${response}`);
    }
  } catch (error) {
    // 오류 시에도 로그만 남기고 응답에는 디버그 정보 제외
    log.error("AI 응답 생성 중 오류 발생:", error);
    console.log("AI 응답을 생성할 수 없습니다. 다시 시도해 주세요.");
  }
}
