import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  createPullRequest,
  addReviewers,
  updatePullRequest,
  getOctokit,
  checkDraftPRAvailability,
  createPullRequestReview,
  getPullRequestFileDiff,
} from "../../core/github.js";
import { getCurrentRepoInfo } from "../../utils/git.js";
import { log } from "../../utils/logger.js";
import { AIFeatures } from "../../core/ai-features.js";
import { exec } from "child_process";
import { promisify } from "util";
import {
  findMatchingPattern,
  generatePRTitle,
  generatePRBody,
} from "../../core/branch-pattern.js";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import { createReadStream } from "fs";

const execAsync = promisify(exec);

// 파일 크기 제한 (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// 브랜치를 원격 저장소에 push하는 함수 추가
async function pushToRemote(branch: string): Promise<void> {
  try {
    await execAsync(`git push -u origin ${branch}`);
    log.info(t("commands.new.success.branch_pushed", { branch }));
  } catch (error) {
    log.error(t("commands.new.error.push_failed", { error: String(error) }));
    throw error;
  }
}

async function getDiffContent(baseBranch: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff origin/${baseBranch}...HEAD`);
    return stdout;
  } catch (error) {
    log.error(t("commands.new.error.diff_failed"));
    return "";
  }
}

async function getChangedFiles(baseBranch: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git diff --name-only origin/${baseBranch}...HEAD`,
    );
    return stdout.split("\n").filter(Boolean);
  } catch (error) {
    log.error(t("commands.new.error.files_failed"));
    return [];
  }
}

// 변경된 파일의 내용을 가져오는 함수 개선
async function getFileContents(
  files: string[],
): Promise<Array<{ path: string; content: string }>> {
  const result: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    try {
      // 파일 크기 확인
      const stats = await stat(file);
      if (stats.size > MAX_FILE_SIZE) {
        log.warn(
          t("commands.new.warning.file_too_large", {
            file,
            size: Math.round(stats.size / 1024 / 1024),
          }),
        );
        continue;
      }

      const content = await readFile(file, "utf-8");
      result.push({ path: file, content });
    } catch (error) {
      log.warn(t("commands.new.warning.file_read_failed", { file }));
    }
  }

  return result;
}

// 코드 리뷰를 실행하고 PR에 리뷰 코멘트를 추가하는 함수
async function runCodeReviewAndAddComments(params: {
  owner: string;
  repo: string;
  pull_number: number;
  files: Array<{ path: string; content: string }>;
  ai: AIFeatures;
  shouldRunOverallReview: boolean;
  shouldRunLineByLineReview: boolean;
  shouldRunPRReview?: boolean; // PR 리뷰 실행 여부
  prTitle?: string; // PR 제목
  prDescription?: string; // PR 설명
  diffContent?: string; // PR diff 내용
}): Promise<void> {
  try {
    // 파일이 없는 경우 빠르게 종료
    if (params.files.length === 0) {
      log.warn(t("commands.new.warning.no_files_for_review"));
      return;
    }

    let overallReview = "";
    let prReview = "";
    let lineComments: Array<{
      file: string;
      line: number;
      comment: string;
      severity?: "info" | "warning" | "error";
    }> = [];

    // PR 리뷰 실행
    if (params.shouldRunPRReview && params.prTitle && params.diffContent) {
      log.info(t("commands.new.info.running_pr_review"));

      try {
        // PR 컨텍스트 구성
        const prContext = {
          prNumber: params.pull_number,
          title: params.prTitle,
          changedFiles: params.files.map((file) => ({
            path: file.path,
            content: file.content,
          })),
          diffContent: params.diffContent,
          // 선택적 GitHub API 연동 정보
          repoOwner: params.owner,
          repoName: params.repo,
        };

        prReview = await params.ai.reviewPR(prContext);
        log.info(t("commands.new.info.pr_review_completed"));
      } catch (error) {
        // 오류 메시지를 더 자세하게 출력
        log.warn(
          t("commands.new.warning.code_review_failed"),
          JSON.stringify(error, null, 2),
        );
      }
    }

    // 전체 코드 리뷰 실행
    if (params.shouldRunOverallReview) {
      log.info(t("commands.new.info.running_code_review"));
      try {
        overallReview = await params.ai.reviewCode(params.files);
        log.info(t("commands.new.info.code_review_completed"));
      } catch (error) {
        log.warn(t("commands.new.warning.code_review_failed"), error);
        overallReview = ""; // 에러 발생 시 리뷰 결과 초기화
      }
    }

    // 라인별 코드 리뷰 실행
    if (params.shouldRunLineByLineReview) {
      log.info(t("commands.new.info.running_line_by_line_review"));

      // PR 컨텍스트 정보를 활용하여 변경된 라인만 분석한다는 안내 추가
      log.info(
        "PR의 변경된 라인만 분석하여 코멘트를 생성합니다. PR에 포함되지 않은 코드에는 코멘트가 생성되지 않습니다.",
      );

      try {
        // PR 컨텍스트 정보 전달
        lineComments = await params.ai.lineByLineCodeReview(
          params.files,
          {
            owner: params.owner,
            repo: params.repo,
            pull_number: params.pull_number,
          },
          // 한국어로 설정 (국제화가 필요한 경우 config에서 가져오도록 수정)
          "ko",
        );

        if (lineComments.length > 0) {
          log.info(t("commands.new.info.line_by_line_review_completed"));
        } else {
          log.info(t("commands.new.info.no_line_comments"));
        }
      } catch (error) {
        log.warn(t("commands.new.warning.line_review_failed"), error);
        lineComments = []; // 에러 발생 시 라인 코멘트 초기화
      }
    }

    // 코드 리뷰, PR 리뷰, 라인별 코멘트가 있는 경우에만 PR 리뷰 생성
    if (overallReview || prReview || lineComments.length > 0) {
      log.info(t("commands.new.info.adding_code_review"));

      // 리뷰 코멘트 준비
      const reviewComments = [];

      // 라인별 코멘트가 있는 경우 GitHub API에 맞게 변환
      if (lineComments.length > 0) {
        for (const comment of lineComments) {
          try {
            // 파일의 diff 정보를 가져와 정확한 라인 번호 매핑
            const diffInfo = await getPullRequestFileDiff({
              owner: params.owner,
              repo: params.repo,
              pull_number: params.pull_number,
              file_path: comment.file,
            });

            // 코멘트를 달 라인 찾기 (추가된 라인이나 변경되지 않은 라인에만 코멘트 가능)
            // 파일의 전체 내용 라인 번호와 diff에서의 라인 번호가 일치하는지 확인
            const lineInfo = diffInfo.changes.find(
              (change) =>
                change.newLineNumber === comment.line &&
                (change.type === "added" || change.type === "unchanged"),
            );

            if (lineInfo && lineInfo.newLineNumber) {
              // 심각도에 따라 이모지 추가
              let prefix = "";
              if (comment.severity === "error") {
                prefix = "🔴 ";
              } else if (comment.severity === "warning") {
                prefix = "⚠️ ";
              } else if (comment.severity === "info") {
                prefix = "ℹ️ ";
              }

              reviewComments.push({
                path: comment.file,
                line: lineInfo.newLineNumber,
                side: "RIGHT" as const,
                body: `${prefix}${comment.comment}`,
              });
            } else {
              // diff에서 해당 라인을 찾지 못한 경우 (PR에 포함되지 않은 파일의 라인)
              log.warn(
                `코멘트를 추가할 수 없습니다: ${comment.file}:${comment.line} - PR diff에서 해당 라인을 찾을 수 없습니다.`,
              );
            }
          } catch (error: any) {
            log.warn(
              `라인 코멘트 매핑 실패 (${comment.file}:${comment.line}):`,
              error,
            );
          }
        }
      }

      // 코드 리뷰 결과를 PR에 코멘트로 추가
      try {
        let finalReviewBody = "";

        // PR 리뷰가 있으면 추가
        if (prReview) {
          finalReviewBody += `## PR 리뷰\n\n${prReview}\n\n`;
        }

        // 코드 리뷰가 있으면 추가
        if (overallReview) {
          finalReviewBody += `## 코드 리뷰\n\n${overallReview}`;
        }

        // 아무 리뷰도 없으면 기본 메시지
        if (!finalReviewBody) {
          finalReviewBody = "코드 리뷰가 완료되었습니다.";
        }

        await createPullRequestReview({
          owner: params.owner,
          repo: params.repo,
          pull_number: params.pull_number,
          body: finalReviewBody,
          event: "COMMENT",
          comments: reviewComments,
        });

        log.info(t("commands.new.success.code_review_added"));
      } catch (error) {
        log.warn(t("commands.new.warning.code_review_add_failed"), error);
      }
    } else {
      log.info(t("commands.new.info.no_review_comments"));
    }
  } catch (error) {
    log.warn(t("commands.new.warning.code_review_add_failed"), error);
  }
}

export async function newCommand(): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config) {
      log.error(t("common.error.github_token"));
      process.exit(1);
    }

    const repoInfo = await getCurrentRepoInfo();
    if (!repoInfo) {
      log.error(t("common.error.not_git_repo"));
      process.exit(1);
    }

    // main/master 브랜치 체크
    if (
      repoInfo.currentBranch === config.defaultBranch ||
      repoInfo.currentBranch === config.developmentBranch
    ) {
      log.error(
        t("commands.new.error.protected_branch", {
          branch: repoInfo.currentBranch,
          development: config.developmentBranch,
          production: config.defaultBranch,
        }),
      );
      process.exit(1);
    }

    // 브랜치 패턴 매칭
    const pattern = await findMatchingPattern(repoInfo.currentBranch);
    if (!pattern) return;

    // release/* 브랜치인 경우 자동으로 원격 저장소에 push
    if (pattern.type === "release") {
      try {
        await pushToRemote(repoInfo.currentBranch);
      } catch (error) {
        log.error(
          t("commands.new.error.push_failed", { error: String(error) }),
        );
        process.exit(1);
      }
    }

    let defaultTitle = repoInfo.currentBranch;
    let defaultBody = "";
    let generatedTitle = "";

    if (pattern) {
      defaultTitle = await generatePRTitle(repoInfo.currentBranch, pattern);
      defaultBody = await generatePRBody(pattern);
    }

    // 브랜치 전략에 따라 base 브랜치 결정
    const baseBranch =
      pattern?.type === "release"
        ? config.defaultBranch
        : config.developmentBranch || config.defaultBranch;

    // 변경사항 수집
    const changedFiles = await getChangedFiles(baseBranch);
    const diffContent = await getDiffContent(baseBranch);

    let generatedDescription = "";
    let ai: AIFeatures | null = null;
    let shouldRunCodeReview = false;
    let shouldRunLineByLineReview = false;
    let shouldRunPRReview = false;

    // AI 인스턴스 생성
    try {
      ai = new AIFeatures();
      log.info(t("commands.new.info.ai_initialized"));

      // AI로 PR 제목 생성
      try {
        log.info(t("commands.new.info.generating_title"));
        generatedTitle = await ai.generatePRTitle(
          changedFiles,
          diffContent,
          pattern,
        );
        log.section(t("commands.new.info.generated_title", { title: "" }));
        log.verbose(generatedTitle);
        defaultTitle = generatedTitle || defaultTitle;
      } catch (error) {
        log.warn(t("commands.new.warning.ai_title_failed"), error);
        log.debug("AI 제목 생성 에러:", error);
      }

      log.info(t("commands.new.info.generating_description"));
      // AI에게 템플릿을 함께 전달
      generatedDescription = await ai.generatePRDescription(
        changedFiles,
        diffContent,
        pattern ? { template: defaultBody } : undefined,
      );

      // AI가 생성한 설명 표시
      log.section(t("commands.new.info.generated_description"));
      log.section("-------------------");
      log.verbose(generatedDescription);
      log.section("-------------------");
    } catch (error) {
      log.warn(t("commands.new.warning.ai_initialization_failed"), error);
      ai = null;
    }

    // 코드 리뷰 실행 여부 물어보기
    const reviewSettings = ai
      ? await inquirer.prompt([
          {
            type: "confirm",
            name: "runCodeReview",
            message: t("commands.new.prompts.run_code_review"),
            default: true,
          },
          {
            type: "confirm",
            name: "runLineByLineReview",
            message: t("commands.new.prompts.run_line_by_line_review"),
            default: true,
          },
        ])
      : { runCodeReview: false, runLineByLineReview: false };

    shouldRunCodeReview = reviewSettings.runCodeReview;
    shouldRunLineByLineReview = reviewSettings.runLineByLineReview;
    shouldRunPRReview = await inquirer
      .prompt([
        {
          type: "confirm",
          name: "runPRReview",
          message: t("commands.new.prompts.run_pr_review"),
          default: false,
        },
      ])
      .then((answers) => answers.runPRReview);

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "title",
        message: t("commands.new.prompts.title"),
        default: defaultTitle,
        validate: (value: string) => value.length > 0,
      },
      {
        type: "confirm",
        name: "useAIDescription",
        message: t("commands.new.prompts.use_ai_description"),
        default: true,
        when: () => !!ai && !!generatedDescription,
      },
      {
        type: "confirm",
        name: "editAIDescription",
        message: t("commands.new.prompts.edit_ai_description"),
        default: false,
        when: (answers) =>
          !!ai && !!generatedDescription && answers.useAIDescription,
      },
      {
        type: "editor",
        name: "body",
        message: t("commands.new.prompts.body"),
        default: (answers) => {
          if (ai && generatedDescription && answers.useAIDescription) {
            return answers.editAIDescription ? generatedDescription : undefined;
          }
          return defaultBody;
        },
        when: (answers) =>
          !ai ||
          !generatedDescription ||
          !answers.useAIDescription ||
          answers.editAIDescription,
      },
      {
        type: "input",
        name: "reviewers",
        message: t("commands.new.prompts.reviewers"),
        default: pattern?.autoAssignReviewers
          ? [
              ...new Set([
                ...config.defaultReviewers,
                ...(pattern.reviewers || []),
              ]),
            ].join(", ")
          : config.defaultReviewers.join(", "),
        filter: (value: string) =>
          value
            .split(",")
            .map((reviewer) => reviewer.trim())
            .filter(Boolean),
      },
    ]);

    // PR 생성 시작을 알림
    log.info(t("commands.new.info.creating"));

    try {
      // head 브랜치 참조 형식 수정
      const headBranch = repoInfo.currentBranch;

      // draft PR 사용 가능 여부 확인
      const draftAvailable = await checkDraftPRAvailability({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      });

      // pattern에서 draft 설정을 가져오되, draft PR 사용 불가능한 경우 false로 설정
      let isDraft = pattern?.draft ?? false;

      // draft PR 사용 가능한 경우 선택권 제공
      if (draftAvailable) {
        const { shouldBeDraft } = await inquirer.prompt([
          {
            type: "confirm",
            name: "shouldBeDraft",
            message: t("commands.new.prompts.create_as_draft"),
            default: pattern?.draft ?? false,
          },
        ]);
        isDraft = shouldBeDraft;
      } else {
        // draft PR 사용 불가능한 경우 강제로 false
        isDraft = false;
        if (pattern?.draft) {
          log.warn(t("commands.new.warning.draft_not_available"));
        }
      }

      // PR이 이미 존재하는지 확인
      const client = await getOctokit();
      const existingPRs = await client.rest.pulls.list({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        head: `${repoInfo.owner}:${headBranch}`,
        state: "open",
      });

      // PR 본문 설정 (AI 생성 또는 사용자 입력)
      const finalBody = answers.useAIDescription
        ? generatedDescription
        : answers.body || "";

      if (existingPRs.data.length > 0) {
        const existingPR = existingPRs.data[0];
        log.info(
          t("commands.new.info.pr_exists", { number: existingPR.number }),
        );

        // 기존 PR 업데이트 여부 확인
        const { updateExisting } = await inquirer.prompt([
          {
            type: "confirm",
            name: "updateExisting",
            message: t("commands.new.prompts.update_existing"),
            default: true,
          },
        ]);

        if (updateExisting) {
          // 기존 PR 업데이트
          const newBody = `
# 이전 내용
${existingPR.body || "(내용 없음)"}

---
# 업데이트된 내용
${finalBody}
`;

          await updatePullRequest({
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            pull_number: existingPR.number,
            title: answers.title,
            body: newBody,
          });

          // 리뷰어 업데이트
          if (answers.reviewers.length > 0) {
            await addReviewers({
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              pull_number: existingPR.number,
              reviewers: answers.reviewers,
            });
          }

          log.info(
            t("commands.new.success.pr_updated", { number: existingPR.number }),
          );
          log.info(`PR URL: ${existingPR.html_url}`);

          // 기존 PR에 코드 리뷰 추가 여부 확인
          if (ai && (shouldRunCodeReview || shouldRunLineByLineReview)) {
            const fileContents = await getFileContents(changedFiles);

            if (fileContents.length > 0) {
              const { addReviewComments } = await inquirer.prompt([
                {
                  type: "confirm",
                  name: "addReviewComments",
                  message: t("commands.new.prompts.add_review_comments"),
                  default: true,
                },
              ]);

              if (addReviewComments) {
                await runCodeReviewAndAddComments({
                  owner: repoInfo.owner,
                  repo: repoInfo.repo,
                  pull_number: existingPR.number,
                  files: fileContents,
                  ai,
                  shouldRunOverallReview: shouldRunCodeReview,
                  shouldRunLineByLineReview,
                  shouldRunPRReview: true,
                  prTitle: answers.title,
                  prDescription: finalBody,
                  diffContent: diffContent,
                });
              }
            } else {
              log.warn(t("commands.new.warning.no_files_for_review"));
            }
          }

          return;
        } else {
          log.info(t("commands.new.success.cancelled"));
          return;
        }
      }

      // 새 PR 생성
      const pr = await createPullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title: answers.title,
        body: finalBody,
        head: headBranch,
        base: baseBranch,
        draft: isDraft,
      });

      // 리뷰어 추가 시도
      if (answers.reviewers.length > 0) {
        log.debug(t("commands.new.info.adding_reviewers"));
        await addReviewers({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          pull_number: pr.number,
          reviewers: answers.reviewers,
        });
        log.verbose(
          t("commands.new.info.reviewers_added", {
            reviewers: answers.reviewers.join(", "),
          }),
        );
      }

      log.info(t("common.success.pr_created"));
      log.info(`PR URL: ${pr.html_url}`);

      // PR이 생성된 후 코드 리뷰를 실행하고 코멘트 추가 여부 확인
      if (ai && (shouldRunCodeReview || shouldRunLineByLineReview)) {
        const fileContents = await getFileContents(changedFiles);

        if (fileContents.length > 0) {
          const { addReviewComments } = await inquirer.prompt([
            {
              type: "confirm",
              name: "addReviewComments",
              message: t("commands.new.prompts.add_review_comments"),
              default: true,
            },
          ]);

          if (addReviewComments) {
            await runCodeReviewAndAddComments({
              owner: repoInfo.owner,
              repo: repoInfo.repo,
              pull_number: pr.number,
              files: fileContents,
              ai,
              shouldRunOverallReview: shouldRunCodeReview,
              shouldRunLineByLineReview,
              shouldRunPRReview: shouldRunPRReview,
              prTitle: answers.title,
              prDescription: finalBody,
              diffContent: diffContent,
            });
          }
        } else {
          log.warn(t("commands.new.warning.no_files_for_review"));
        }
      }
    } catch (error: any) {
      if (error.message?.includes("No commits between")) {
        log.error(t("common.error.no_commits"));
      } else if (error.message?.includes("A pull request already exists")) {
        log.error(t("common.error.pr_exists"));
      } else if (error.message?.includes("Base branch was modified")) {
        log.error(t("common.error.base_modified"));
      } else {
        log.error(
          t("commands.new.error.create_failed", { error: String(error) }),
        );
      }
      process.exit(1);
    }
  } catch (error) {
    log.error(t("common.error.unknown"), error);
    process.exit(1);
  }
}
