import { Octokit } from "@octokit/rest";
import { log } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

/**
 * PR 이벤트 인터페이스
 */
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

  // diff에서 각 파일별 패치 정보 추출을 위한 변수들
  let successCount = 0;

  try {
    // 전체 PR diff를 한 번만 가져옵니다
    const diffResponse = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: "diff",
      },
    });

    const diffContent = String(diffResponse.data);
    log.debug(`가져온 diff 길이: ${diffContent.length} 문자`);

    // diff 내용을 파일별로 분리하고 position 정보 매핑
    const filePatches = parseDiff(diffContent);

    // 각 파일별 헤더와 청크 정보 추출
    const diffHunks: Record<string, Record<number, string>> = {};
    const lines = diffContent.split("\n");
    let currentFile = "";
    let currentHunk = "";
    let hunkStartPosition = 0;
    let inHunk = false;
    let patchPos = 0;

    // 파일별 hunk 정보 추출
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("diff --git")) {
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = match[2];
          if (!diffHunks[currentFile]) {
            diffHunks[currentFile] = {};
          }
          inHunk = false;
          patchPos = 0;
        }
      } else if (line.startsWith("@@")) {
        inHunk = true;
        currentHunk = line;
        hunkStartPosition = i;
        // 새 hunk 시작 시 patchPos 유지 (GitHub API는 전체 diff에서의 상대적 위치를 사용)
      } else if (inHunk) {
        patchPos++;

        // 각 라인의 위치에 해당 hunk 정보 저장
        // diff_hunk는 시작 라인(@@...)부터 최소 3줄 이상을 포함해야 함
        const hunkEndLine = Math.min(i + 3, lines.length);
        const hunkLines = lines
          .slice(hunkStartPosition, hunkEndLine)
          .join("\n");

        if (!diffHunks[currentFile][patchPos]) {
          diffHunks[currentFile][patchPos] = hunkLines;
        }
      }
    }

    for (const comment of comments) {
      try {
        // 해당 파일의 diff 구간 찾기
        const filePatch = filePatches[comment.path];
        if (!filePatch) {
          log.debug(
            `파일 ${comment.path}의 diff 패치 정보를 찾을 수 없습니다.`,
          );
          continue;
        }

        // 해당 파일에서 올바른 위치 (relative position) 찾기
        const patchPosition = findPatchPosition(filePatch, comment.position);

        if (!patchPosition) {
          log.debug(
            `파일 ${comment.path}의 position ${comment.position}에 해당하는 patch 위치를 찾을 수 없습니다.`,
          );
          continue;
        }

        // diff_hunk 정보 가져오기
        const diffHunk = diffHunks[comment.path]?.[patchPosition.position];
        if (!diffHunk) {
          log.debug(
            `파일 ${comment.path}의 position ${patchPosition.position}에 해당하는 diff_hunk를 찾을 수 없습니다.`,
          );
        }

        log.debug(
          `코멘트 추가 시도: ${comment.path}:${comment.line || patchPosition.lineNumber}, patch position: ${patchPosition.position}`,
        );

        // GitHub API 호출하여 코멘트 추가
        await octokit.pulls.createReviewComment({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: commitSha,
          path: comment.path,
          position: patchPosition.position,
          body: comment.body,
          line: comment.line || patchPosition.lineNumber, // 정확한 라인 번호 사용
          ...(diffHunk ? { diff_hunk: diffHunk } : {}), // diff_hunk가 있는 경우에만 추가
        });

        successCount++;
        log.debug(
          `성공적으로 추가된 라인 코멘트: ${comment.path}:${comment.line || patchPosition.lineNumber}`,
        );
      } catch (commentError) {
        log.debug(`개별 코멘트 추가 실패: ${commentError}`);
        log.debug(`실패 상세 정보: ${JSON.stringify(commentError)}`);
      }
    }
  } catch (error) {
    log.error(`PR diff 가져오기 실패: ${error}`);
  }

  log.info(
    `${successCount}/${comments.length}개의 라인별 코멘트가 PR에 추가되었습니다.`,
  );

  return successCount;
}

/**
 * diff 내용을 파일별로 파싱하여 패치 정보를 추출합니다.
 */
function parseDiff(diffContent: string): Record<
  string,
  {
    content: string;
    positions: Array<{
      globalPos: number;
      patchPos: number;
      lineNumber?: number;
    }>;
  }
> {
  const result: Record<
    string,
    {
      content: string;
      positions: Array<{
        globalPos: number;
        patchPos: number;
        lineNumber?: number;
      }>;
    }
  > = {};

  if (!diffContent) return result;

  const lines = diffContent.split("\n");
  let currentFile = "";
  let fileStartIndex = -1;
  let patchPos = 0;
  let inHunk = false;
  let currentLineNumber = 0;
  let hunkStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 새 파일 시작
    if (line.startsWith("diff --git")) {
      // 이전 파일 정보 저장
      if (currentFile && fileStartIndex >= 0) {
        const fileContent = lines.slice(fileStartIndex, i).join("\n");
        result[currentFile].content = fileContent;
      }

      // 새 파일 정보 초기화
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        currentFile = match[2]; // b/의 파일명 사용
        result[currentFile] = { content: "", positions: [] };
        fileStartIndex = i;
        patchPos = 0; // 새 파일 시작 시 patch position 리셋
        inHunk = false;
        currentLineNumber = 0;
      }
    }
    // hunk 시작
    else if (line.startsWith("@@")) {
      inHunk = true;

      // 라인 번호 추출 (예: @@ -1,5 +2,8 @@)
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLineNumber = parseInt(hunkMatch[1], 10) - 1; // 다음 라인부터 시작하므로 -1
        hunkStartLine = currentLineNumber;
      }
    }
    // 청크 내에서만 position 계산
    else if (inHunk) {
      patchPos++; // hunk 내 모든 라인에 대해 patchPos 증가

      // 추가된 라인인 경우 ('+' 로 시작하고, '+++' 아님)
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLineNumber++;
        // 전역 position과 패치 내 position 매핑 및 정확한 라인 번호 저장
        result[currentFile].positions.push({
          globalPos: i,
          patchPos: patchPos,
          lineNumber: currentLineNumber, // 정확한 라인 번호 추적
        });
      }
      // 유지된 라인인 경우 (' ' 로 시작)
      else if (line.startsWith(" ")) {
        currentLineNumber++;
      }
      // 삭제된 라인('-'로 시작하지만 '---'는 아님)은 카운트하지 않음
    }
  }

  // 마지막 파일 처리
  if (currentFile && fileStartIndex >= 0) {
    const fileContent = lines.slice(fileStartIndex).join("\n");
    result[currentFile].content = fileContent;
  }

  // 디버깅용 로그
  for (const file in result) {
    log.debug(
      `파일 ${file}의 패치 정보: ${result[file].positions.length}개 위치`,
    );
    if (result[file].positions.length > 0) {
      log.debug(
        `첫 번째 위치: 라인 ${result[file].positions[0].lineNumber}, 패치 위치 ${result[file].positions[0].patchPos}`,
      );
    }
  }

  return result;
}

/**
 * 글로벌 position에 해당하는 패치 내 position 찾기
 */
function findPatchPosition(
  filePatch: {
    content: string;
    positions: Array<{
      globalPos: number;
      patchPos: number;
      lineNumber?: number;
    }>;
  },
  globalPosition: number,
): { position: number; lineNumber?: number } | null {
  // 정확한 매칭 시도
  const exactMatch = filePatch.positions.find(
    (pos) => pos.globalPos === globalPosition,
  );
  if (exactMatch) {
    return {
      position: exactMatch.patchPos,
      lineNumber: exactMatch.lineNumber,
    };
  }

  // 정확한 매칭이 없는 경우, 가장 가까운 position 찾기
  let closestPos = null;
  let minDistance = Number.MAX_SAFE_INTEGER;

  for (const pos of filePatch.positions) {
    const distance = Math.abs(pos.globalPos - globalPosition);
    if (distance < minDistance) {
      minDistance = distance;
      closestPos = pos;
    }
  }

  // 5라인 이내의 오차 허용 (GitHub API는 약간의 오차를 용인함)
  if (closestPos && minDistance <= 5) {
    return {
      position: closestPos.patchPos,
      lineNumber: closestPos.lineNumber,
    };
  }

  return null;
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

/**
 * PR 리뷰 봇 명령어 핸들러
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

    // 이벤트 타입에 따라 처리
    if (event === "pull_request") {
      // PR 이벤트만 처리
      await handlePREvent(payload as PREvent, octokit);
    } else {
      // 지원하지 않는 이벤트
      log.warn(t("commands.review_bot.warning.unsupported_event", { event }));
    }
  } catch (error) {
    log.error(t("commands.review_bot.error.execution_failed"), error);
    process.exit(1);
  }
}
