import inquirer from "inquirer";
import { t } from "../../i18n/index.js";
import { loadConfig } from "../../core/config.js";
import {
  createPullRequest,
  addReviewers,
  updatePullRequest,
  getOctokit,
  checkDraftPRAvailability,
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

const execAsync = promisify(exec);

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

// 변경된 파일의 내용을 가져오는 함수 추가
async function getFileContents(
  files: string[],
): Promise<Array<{ path: string; content: string }>> {
  const result: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      result.push({ path: file, content });
    } catch (error) {
      log.warn(t("commands.new.warning.file_read_failed", { file }));
    }
  }

  return result;
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
    let codeReview = "";
    let lineByLineComments: Array<{
      file: string;
      line: number;
      comment: string;
      severity?: "info" | "warning" | "error";
    }> = [];
    let shouldRunCodeReview = false;
    let shouldRunLineByLineReview = false;

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

      // AI 코드 리뷰 설정 질문
      const reviewSettings = await inquirer.prompt([
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
      ]);

      shouldRunCodeReview = reviewSettings.runCodeReview;
      shouldRunLineByLineReview = reviewSettings.runLineByLineReview;
    } catch (error) {
      log.warn(t("commands.new.warning.ai_initialization_failed"));
      ai = null;
    }

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

    // 코드 리뷰 실행
    if (ai && (shouldRunCodeReview || shouldRunLineByLineReview)) {
      const fileContents = await getFileContents(changedFiles);

      if (fileContents.length > 0) {
        // 전반적인 코드 리뷰
        if (shouldRunCodeReview) {
          log.info(t("commands.new.info.running_code_review"));
          try {
            codeReview = await ai.reviewCode(fileContents);
            log.section(t("commands.new.info.code_review_result"));
            log.section("-------------------");
            log.verbose(codeReview);
            log.section("-------------------");
          } catch (error) {
            log.warn(t("commands.new.warning.code_review_failed"), error);
          }
        }

        // 라인별 코드 리뷰
        if (shouldRunLineByLineReview) {
          log.info(t("commands.new.info.running_line_by_line_review"));
          try {
            lineByLineComments = await ai.lineByLineCodeReview(fileContents);
            log.section(t("commands.new.info.line_by_line_review_result"));
            log.section("-------------------");

            if (lineByLineComments.length > 0) {
              lineByLineComments.forEach((comment) => {
                const severity = comment.severity
                  ? `[${comment.severity.toUpperCase()}]`
                  : "";
                log.verbose(
                  `${comment.file}:${comment.line} ${severity} - ${comment.comment}`,
                );
              });
            } else {
              log.verbose(t("commands.new.info.no_line_comments"));
            }

            log.section("-------------------");
          } catch (error) {
            log.warn(t("commands.new.warning.line_review_failed"), error);
          }
        }
      } else {
        log.warn(t("commands.new.warning.no_files_for_review"));
      }
    }

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

      // PR 본문에 코드 리뷰 내용 추가
      let finalBody = answers.useAIDescription
        ? generatedDescription
        : answers.body || "";

      // 전체 코드 리뷰 내용 추가
      if (codeReview) {
        finalBody += `\n\n## 전체 코드 리뷰\n\n${codeReview}`;
      }

      // 라인별 코드 리뷰 내용 추가
      if (lineByLineComments.length > 0) {
        finalBody += "\n\n## 라인별 코드 리뷰\n\n";
        // 파일별로 그룹화
        const fileGroups = lineByLineComments.reduce(
          (acc, comment) => {
            if (!acc[comment.file]) {
              acc[comment.file] = [];
            }
            acc[comment.file].push(comment);
            return acc;
          },
          {} as Record<string, typeof lineByLineComments>,
        );

        // 파일별로 코멘트 출력
        for (const [file, comments] of Object.entries(fileGroups)) {
          finalBody += `### ${file}\n\n`;
          comments
            .sort((a, b) => a.line - b.line)
            .forEach((comment) => {
              const severity = comment.severity
                ? `[${comment.severity.toUpperCase()}]`
                : "";
              finalBody += `- **${file}:${comment.line}** ${severity} - ${comment.comment}\n`;
            });
          finalBody += "\n";
        }
      }

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
          return;
        } else {
          log.info(t("commands.new.success.cancelled"));
          return;
        }
      }

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
    log.error(t("common.error.unknown"), String(error));
    process.exit(1);
  }
}
